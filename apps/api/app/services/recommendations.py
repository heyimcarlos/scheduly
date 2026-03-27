"""Fatigue-aware emergency replacement recommendations."""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.services.availability import AvailabilityService, AvailabilityWindow

_logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[4]
_ML_SRC = _REPO_ROOT / "packages" / "ml" / "src" / "fatigue"
if str(_ML_SRC) not in sys.path:
    sys.path.insert(0, str(_ML_SRC))


@dataclass(frozen=True)
class RecommendationCandidate:
    absent_employee_id: int
    replacement_employee_id: int
    replacement_employee_name: str | None
    absent_region: str
    replacement_region: str
    day_offset: int
    utc_start: datetime
    utc_end: datetime
    overtime_hours: float
    region_priority: int
    recommendation_rank: int
    ranking_score: float
    fatigue_score: float
    fatigue_source: str
    rest_hours_since_last_shift: float | None
    consecutive_days_worked: int
    rationale: str
    absentee_fatigue_score: float | None = None


class FatigueAwareRecommendationService:
    """Rank replacement candidates using coverage fit and fatigue risk."""

    FOLLOW_THE_SUN_ORDER = ["India", "Serbia", "Canada"]

    def __init__(self, *, system_config: dict[str, Any]) -> None:
        self.system_config = system_config
        self.availability_service = AvailabilityService(system_config=system_config)

    def build_recommendations(
        self,
        *,
        employees: list[dict[str, Any]],
        start_date: date,
        num_days: int,
        absence_event: dict[str, Any],
        manual_absences: list[dict[str, Any]] | None = None,
        recent_assignments: list[dict[str, Any]] | None = None,
        top_n: int = 5,
        prefer_fatigue_model: bool = False,
        min_fatigue_score: float | None = None,
    ) -> list[RecommendationCandidate]:
        windows = self.availability_service.build_windows(
            employees=employees,
            start_date=start_date,
            num_days=num_days,
            manual_absences=manual_absences or [],
        )
        recent_by_employee = self._group_recent_assignments(recent_assignments or [])

        absent_employee_id = int(absence_event["absent_employee_id"])
        day_offset = int(absence_event["day_offset"])
        target_window = self._resolve_target_window(
            windows, absent_employee_id, day_offset
        )

        absent_history = recent_by_employee.get(absent_employee_id, [])
        absentee_fatigue_score, _ = self._compute_fatigue_score(
            candidate_history=absent_history,
            target_window=target_window,
            prefer_model=prefer_fatigue_model,
            employee_id=absent_employee_id,
        )

        candidates: list[RecommendationCandidate] = []
        for window in windows:
            if (
                window.employee_id == absent_employee_id
                or window.local_date != target_window.local_date
                or window.absent
            ):
                continue

            candidate_history = recent_by_employee.get(window.employee_id, [])
            if self._has_same_day_assignment(candidate_history, target_window):
                continue

            overtime_hours = self._compute_shift_overtime(target_window, window)
            if overtime_hours > 0:
                continue

            region_priority = self._region_distance(target_window.region, window.region)
            fatigue_score, fatigue_source = self._compute_fatigue_score(
                candidate_history=candidate_history,
                target_window=target_window,
                prefer_model=prefer_fatigue_model,
                employee_id=window.employee_id,
            )
            if min_fatigue_score is not None and fatigue_score > min_fatigue_score:
                continue

            rest_hours = self._rest_hours_since_last_shift(
                candidate_history, target_window.utc_start
            )
            consecutive_days = self._consecutive_days_worked(
                candidate_history, target_window.local_date
            )
            absentee_risk = (
                absentee_fatigue_score * 30.0
                if absentee_fatigue_score is not None and absentee_fatigue_score > 0.5
                else 0.0
            )
            ranking_score = round(
                (region_priority * 100.0)
                + (overtime_hours * 12.0)
                + (fatigue_score * 75.0)
                + absentee_risk,
                3,
            )

            candidates.append(
                RecommendationCandidate(
                    absent_employee_id=absent_employee_id,
                    replacement_employee_id=window.employee_id,
                    replacement_employee_name=window.employee_name,
                    absent_region=target_window.region,
                    replacement_region=window.region,
                    day_offset=day_offset,
                    utc_start=target_window.utc_start,
                    utc_end=target_window.utc_end,
                    overtime_hours=overtime_hours,
                    region_priority=region_priority,
                    recommendation_rank=0,
                    ranking_score=ranking_score,
                    fatigue_score=round(fatigue_score, 3),
                    fatigue_source=fatigue_source,
                    rest_hours_since_last_shift=rest_hours,
                    consecutive_days_worked=consecutive_days,
                    rationale=self._build_rationale(
                        absent_region=target_window.region,
                        replacement_region=window.region,
                        overtime_hours=overtime_hours,
                        fatigue_score=fatigue_score,
                        rest_hours=rest_hours,
                    ),
                    absentee_fatigue_score=round(absentee_fatigue_score, 3),
                )
            )

        candidates.sort(
            key=lambda item: (
                item.ranking_score,
                item.overtime_hours,
                item.replacement_employee_id,
            )
        )
        return [
            RecommendationCandidate(
                **{
                    **candidate.__dict__,
                    "recommendation_rank": index,
                }
            )
            for index, candidate in enumerate(candidates[:top_n], start=1)
        ]

    def summarize(
        self, recommendations: list[RecommendationCandidate]
    ) -> dict[str, Any]:
        return {
            "total_recommendations": len(recommendations),
            "best_overtime_hours": recommendations[0].overtime_hours
            if recommendations
            else None,
            "best_fatigue_score": recommendations[0].fatigue_score
            if recommendations
            else None,
            "regions_present": sorted(
                {item.replacement_region for item in recommendations}
            ),
        }

    @classmethod
    def _region_distance(cls, origin: str, candidate: str) -> int:
        if origin == candidate:
            return 0
        try:
            origin_idx = cls.FOLLOW_THE_SUN_ORDER.index(origin)
            candidate_idx = cls.FOLLOW_THE_SUN_ORDER.index(candidate)
        except ValueError:
            return len(cls.FOLLOW_THE_SUN_ORDER)
        forward = (candidate_idx - origin_idx) % len(cls.FOLLOW_THE_SUN_ORDER)
        backward = (origin_idx - candidate_idx) % len(cls.FOLLOW_THE_SUN_ORDER)
        return min(forward, backward)

    @staticmethod
    def _compute_shift_overtime(
        absent_window: AvailabilityWindow, candidate_window: AvailabilityWindow
    ) -> float:
        overlap_start = max(absent_window.utc_start, candidate_window.utc_start)
        overlap_end = min(absent_window.utc_end, candidate_window.utc_end)
        overlap_hours = max(0.0, (overlap_end - overlap_start).total_seconds() / 3600.0)
        shift_hours = (
            absent_window.utc_end - absent_window.utc_start
        ).total_seconds() / 3600.0
        return round(max(0.0, shift_hours - overlap_hours), 2)

    @staticmethod
    def _group_recent_assignments(
        recent_assignments: list[dict[str, Any]],
    ) -> dict[int, list[dict[str, Any]]]:
        grouped: dict[int, list[dict[str, Any]]] = {}
        for assignment in recent_assignments:
            employee_id = int(assignment["employee_id"])
            normalized = {
                **assignment,
                "start_utc": pd_to_datetime_utc(assignment["start_utc"]),
                "end_utc": pd_to_datetime_utc(assignment["end_utc"]),
            }
            grouped.setdefault(employee_id, []).append(normalized)
        for employee_id in grouped:
            grouped[employee_id].sort(key=lambda item: item["start_utc"])
        return grouped

    @staticmethod
    def _resolve_target_window(
        windows: list[AvailabilityWindow], absent_employee_id: int, day_offset: int
    ) -> AvailabilityWindow:
        local_dates = sorted(
            {w.local_date for w in windows if w.employee_id == absent_employee_id}
        )
        if day_offset >= len(local_dates):
            raise ValueError("day_offset is outside the modeled availability horizon")
        target_day = local_dates[day_offset]
        for window in windows:
            if (
                window.employee_id == absent_employee_id
                and window.local_date == target_day
            ):
                return window
        raise ValueError("absent employee window not found for requested day_offset")

    @staticmethod
    def _rest_hours_since_last_shift(
        candidate_history: list[dict[str, Any]], target_start: datetime
    ) -> float | None:
        previous = [
            item for item in candidate_history if item["end_utc"] <= target_start
        ]
        if not previous:
            return None
        last_shift = previous[-1]
        rest_hours = (target_start - last_shift["end_utc"]).total_seconds() / 3600.0
        return round(rest_hours, 2)

    @staticmethod
    def _has_same_day_assignment(
        candidate_history: list[dict[str, Any]], target_window: AvailabilityWindow
    ) -> bool:
        day_start = datetime.combine(
            target_window.utc_start.date(),
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        day_end = day_start + timedelta(days=1)
        return any(
            item["start_utc"] < day_end and item["end_utc"] > day_start
            for item in candidate_history
        )

    @staticmethod
    def _hours_worked_last_week(
        candidate_history: list[dict[str, Any]], target_start: datetime
    ) -> float:
        window_start = target_start - timedelta(days=7)
        total = 0.0
        for item in candidate_history:
            if item["end_utc"] <= window_start or item["start_utc"] >= target_start:
                continue
            total += (item["end_utc"] - item["start_utc"]).total_seconds() / 3600.0
        return round(total, 2)

    @staticmethod
    def _consecutive_days_worked(
        candidate_history: list[dict[str, Any]], target_day: date
    ) -> int:
        worked_days = {
            item["start_utc"].date()
            for item in candidate_history
            if item["start_utc"].date() < target_day
        }
        streak = 0
        cursor = target_day - timedelta(days=1)
        while cursor in worked_days:
            streak += 1
            cursor -= timedelta(days=1)
        return streak

    def _compute_fatigue_score(
        self,
        *,
        candidate_history: list[dict[str, Any]],
        target_window: AvailabilityWindow,
        prefer_model: bool,
        employee_id: int,
    ) -> tuple[float, str]:
        if prefer_model:
            score = self._predict_model_fatigue(
                candidate_history, target_window, employee_id
            )
            if score is not None:
                return score, "model"

        rest_hours = self._rest_hours_since_last_shift(
            candidate_history, target_window.utc_start
        )
        consecutive_days = self._consecutive_days_worked(
            candidate_history, target_window.local_date
        )
        weekly_hours = self._hours_worked_last_week(
            candidate_history, target_window.utc_start
        )
        night_like_recent = sum(
            1
            for item in candidate_history[-3:]
            if str(item.get("shift_type", "")).lower() in {"evening", "night"}
        )

        rest_penalty = (
            0.0 if rest_hours is None else max(0.0, (12.0 - rest_hours) / 12.0) * 0.45
        )
        streak_penalty = max(0.0, consecutive_days - 3) / 4.0 * 0.25
        weekly_penalty = max(0.0, weekly_hours - 40.0) / 20.0 * 0.20
        night_penalty = min(0.10, night_like_recent * 0.05)
        baseline = 0.10 if not candidate_history else 0.0
        fatigue_score = min(
            1.0,
            baseline + rest_penalty + streak_penalty + weekly_penalty + night_penalty,
        )
        return fatigue_score, "heuristic"

    @staticmethod
    def _build_rationale(
        *,
        absent_region: str,
        replacement_region: str,
        overtime_hours: float,
        fatigue_score: float,
        rest_hours: float | None,
    ) -> str:
        region_text = (
            "same-region coverage"
            if absent_region == replacement_region
            else f"follow-the-sun fallback from {replacement_region}"
        )
        rest_text = (
            "no recent shift history"
            if rest_hours is None
            else f"{rest_hours:.1f}h rest before takeover"
        )
        return (
            f"{region_text}; estimated overtime {overtime_hours:.2f}h; "
            f"fatigue score {fatigue_score:.2f}; {rest_text}"
        )

    @staticmethod
    def _predict_model_fatigue(
        candidate_history: list[dict[str, Any]],
        target_window: AvailabilityWindow,
        employee_id: int,
    ) -> float | None:
        if len(candidate_history) < 14:
            return None
        try:
            from fatigue_inference import predict_fatigue  # type: ignore[reportMissingImports]
        except Exception as exc:  # noqa: BLE001
            _logger.info(
                "Fatigue model unavailable; falling back to heuristic scoring: %s", exc
            )
            return None

        payload_shifts = [
            {
                "start_utc": item["start_utc"]
                .astimezone(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "end_utc": item["end_utc"]
                .astimezone(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "shift_type": item.get("shift_type", target_window.shift_type),
            }
            for item in candidate_history[-13:]
        ]
        payload_shifts.append(
            {
                "start_utc": target_window.utc_start.isoformat().replace("+00:00", "Z"),
                "end_utc": target_window.utc_end.isoformat().replace("+00:00", "Z"),
                "shift_type": target_window.shift_type,
            }
        )
        try:
            result = predict_fatigue(
                {"employee_id": str(employee_id), "shifts": payload_shifts}
            )
        except Exception as exc:  # noqa: BLE001
            _logger.info("Fatigue inference failed; using heuristic scoring: %s", exc)
            return None
        return float(result.get("predicted_fatigue", 0.0))


def pd_to_datetime_utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    normalized = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return (
        normalized
        if normalized.tzinfo is not None
        else normalized.replace(tzinfo=timezone.utc)
    )
