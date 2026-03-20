"""Demand helpers for explicit workload-driven schedule generation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Iterable


_SHIFT_ORDER = {"day": 0, "evening": 1, "night": 2}


@dataclass(frozen=True)
class ShiftDemandPoint:
    """Single (utc_date, shift_type) demand requirement."""

    utc_date: date
    shift_type: str
    required_headcount: int | None = None
    minimum_headcount: int | None = None
    ideal_headcount: int | None = None
    priority_weight: int = 1
    source: str = "manual"

    def __post_init__(self) -> None:
        legacy_required = self.required_headcount
        minimum = (
            self.minimum_headcount
            if self.minimum_headcount is not None
            else legacy_required
        )
        ideal = (
            self.ideal_headcount
            if self.ideal_headcount is not None
            else legacy_required
        )
        minimum = max(0, int(minimum or 0))
        ideal = max(minimum, int(ideal or 0))
        object.__setattr__(self, "minimum_headcount", minimum)
        object.__setattr__(self, "ideal_headcount", ideal)
        object.__setattr__(self, "required_headcount", ideal)
        object.__setattr__(
            self, "priority_weight", max(1, int(self.priority_weight or 1))
        )


@dataclass(frozen=True)
class SlotDemandPoint:
    """Single (utc_date, slot_name) workload requirement."""

    utc_date: date
    slot_name: str
    required_headcount: int | None = None
    minimum_headcount: int | None = None
    ideal_headcount: int | None = None
    priority_weight: int = 1
    source: str = "manual"

    def __post_init__(self) -> None:
        legacy_required = self.required_headcount
        minimum = (
            self.minimum_headcount
            if self.minimum_headcount is not None
            else legacy_required
        )
        ideal = (
            self.ideal_headcount
            if self.ideal_headcount is not None
            else legacy_required
        )
        minimum = max(0, int(minimum or 0))
        ideal = max(minimum, int(ideal or 0))
        object.__setattr__(self, "minimum_headcount", minimum)
        object.__setattr__(self, "ideal_headcount", ideal)
        object.__setattr__(self, "required_headcount", ideal)
        object.__setattr__(
            self, "priority_weight", max(1, int(self.priority_weight or 1))
        )


class DemandGenerator:
    """Build explicit demand artifacts from caller input or team-profile defaults."""

    @staticmethod
    def _to_date(value: Any) -> date:
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, datetime):
            return value.date()
        return datetime.fromisoformat(str(value)).date()

    @staticmethod
    def normalize_shift_demand_rows(
        rows: Iterable[dict[str, Any]], *, default_source: str = "manual"
    ) -> list[ShiftDemandPoint]:
        points: list[ShiftDemandPoint] = []
        for row in rows:
            points.append(
                ShiftDemandPoint(
                    utc_date=DemandGenerator._to_date(row["utc_date"]),
                    shift_type=str(row["shift_type"]),
                    required_headcount=row.get("required_headcount"),
                    minimum_headcount=row.get("minimum_headcount"),
                    ideal_headcount=row.get("ideal_headcount"),
                    priority_weight=int(row.get("priority_weight", 1) or 1),
                    source=row.get("source", default_source),
                )
            )
        points.sort(key=lambda p: (p.utc_date, _SHIFT_ORDER.get(p.shift_type, 99)))
        return points

    @staticmethod
    def normalize_slot_demand_rows(
        rows: Iterable[dict[str, Any]], *, default_source: str = "manual"
    ) -> list[SlotDemandPoint]:
        points: list[SlotDemandPoint] = []
        for row in rows:
            points.append(
                SlotDemandPoint(
                    utc_date=DemandGenerator._to_date(row["utc_date"]),
                    slot_name=str(row["slot_name"]),
                    required_headcount=row.get("required_headcount"),
                    minimum_headcount=row.get("minimum_headcount"),
                    ideal_headcount=row.get("ideal_headcount"),
                    priority_weight=int(row.get("priority_weight", 1) or 1),
                    source=row.get("source", default_source),
                )
            )
        points.sort(key=lambda p: (p.utc_date, p.slot_name))
        return points

    @staticmethod
    def expand_workload_template(
        *,
        template_rows: Iterable[dict[str, Any]],
        start_date: date,
        num_days: int,
    ) -> list[SlotDemandPoint]:
        normalized_template = []
        for row in template_rows:
            normalized_template.append(
                {
                    "day_type": str(row.get("day_type", "all")),
                    "slot_name": str(row["slot_name"]),
                    "required_headcount": row.get("required_headcount"),
                    "minimum_headcount": row.get("minimum_headcount"),
                    "ideal_headcount": row.get("ideal_headcount"),
                    "priority_weight": int(row.get("priority_weight", 1) or 1),
                    "source": row.get("source", "template"),
                }
            )

        points: list[SlotDemandPoint] = []
        for offset in range(num_days):
            current_date = start_date + timedelta(days=offset)
            day_type = "weekend" if current_date.weekday() >= 5 else "weekday"
            for row in normalized_template:
                if row["day_type"] not in {"all", day_type}:
                    continue
                points.append(
                    SlotDemandPoint(
                        utc_date=current_date,
                        slot_name=row["slot_name"],
                        required_headcount=row["required_headcount"],
                        minimum_headcount=row["minimum_headcount"],
                        ideal_headcount=row["ideal_headcount"],
                        priority_weight=row["priority_weight"],
                        source=row["source"],
                    )
                )
        points.sort(key=lambda p: (p.utc_date, p.slot_name))
        return points

    @staticmethod
    def derive_slot_demand_from_team_profile(
        *,
        start_date: date,
        num_days: int,
        team_profile_config: dict[str, Any] | None,
    ) -> list[SlotDemandPoint]:
        slot_policies = (team_profile_config or {}).get("slot_policies") or {}
        points: list[SlotDemandPoint] = []
        for offset in range(num_days):
            current_date = start_date + timedelta(days=offset)
            for slot_name, policy in slot_policies.items():
                minimum = int(policy.get("min_headcount", 0) or 0)
                if minimum <= 0 and policy.get("max_headcount") in (None, 0):
                    continue
                points.append(
                    SlotDemandPoint(
                        utc_date=current_date,
                        slot_name=slot_name,
                        minimum_headcount=minimum,
                        ideal_headcount=max(
                            minimum, int(policy.get("min_headcount", 0) or 0)
                        ),
                        priority_weight=1,
                        source="derived",
                    )
                )
        points.sort(key=lambda p: (p.utc_date, p.slot_name))
        return points

    @staticmethod
    def aggregate_slot_demand_to_shift_demand(
        slot_points: Iterable[SlotDemandPoint],
        *,
        system_config: dict[str, Any],
    ) -> list[ShiftDemandPoint]:
        slots_by_name = {
            slot["name"]: slot["shift_type"]
            for slot in system_config.get("shift_slots", [])
        }
        grouped: dict[tuple[date, str], dict[str, int | str]] = {}

        for point in slot_points:
            shift_type = slots_by_name.get(point.slot_name)
            if shift_type is None:
                continue
            key = (point.utc_date, shift_type)
            row = grouped.setdefault(
                key,
                {
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                    "priority_weight": 1,
                    "source": point.source,
                },
            )
            row["minimum_headcount"] = int(row["minimum_headcount"]) + int(
                point.minimum_headcount or 0
            )
            row["ideal_headcount"] = int(row["ideal_headcount"]) + int(
                point.ideal_headcount or 0
            )
            row["priority_weight"] = max(
                int(row["priority_weight"]), int(point.priority_weight or 1)
            )

        aggregated = [
            ShiftDemandPoint(
                utc_date=utc_date,
                shift_type=shift_type,
                minimum_headcount=int(values["minimum_headcount"]),
                ideal_headcount=int(values["ideal_headcount"]),
                priority_weight=int(values["priority_weight"]),
                source=str(values["source"]),
            )
            for (utc_date, shift_type), values in grouped.items()
        ]
        aggregated.sort(key=lambda p: (p.utc_date, _SHIFT_ORDER.get(p.shift_type, 99)))
        return aggregated

    @staticmethod
    def summarize(points: Iterable[ShiftDemandPoint]) -> dict[str, Any]:
        materialized = list(points)
        if not materialized:
            return {
                "total_slots": 0,
                "total_minimum_headcount": 0,
                "total_ideal_headcount": 0,
                "peak_minimum_headcount": 0,
                "peak_ideal_headcount": 0,
                "total_required_headcount": 0,
                "peak_required_headcount": 0,
                "start_utc_date": None,
                "end_utc_date": None,
            }

        return {
            "total_slots": len(materialized),
            "total_minimum_headcount": sum(
                int(p.minimum_headcount or 0) for p in materialized
            ),
            "total_ideal_headcount": sum(
                int(p.ideal_headcount or 0) for p in materialized
            ),
            "peak_minimum_headcount": max(
                int(p.minimum_headcount or 0) for p in materialized
            ),
            "peak_ideal_headcount": max(
                int(p.ideal_headcount or 0) for p in materialized
            ),
            "total_required_headcount": sum(
                int(p.required_headcount or 0) for p in materialized
            ),
            "peak_required_headcount": max(
                int(p.required_headcount or 0) for p in materialized
            ),
            "start_utc_date": materialized[0].utc_date,
            "end_utc_date": materialized[-1].utc_date,
        }
