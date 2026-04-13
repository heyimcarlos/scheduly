"""Unavailability plan service — multi-day replacement recommendations with cascade detection."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from supabase import Client

from app.models.schemas import (
    UnavailabilityDayRecommendation,
    UnavailabilityDayResponse,
    UnavailabilityPlanCreate,
    UnavailabilityPlanResponse,
)
from app.services.recommendations import FatigueAwareRecommendationService

_logger = logging.getLogger(__name__)


class UnavailabilityRecommendationService:
    """Create and manage unavailability plans with fatigue-aware replacement recommendations."""

    def __init__(self, *, client: Client, system_config: dict[str, Any]) -> None:
        self.client = client
        self.system_config = system_config
        self.recommendation_service = FatigueAwareRecommendationService(
            system_config=system_config,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_plan(self, request: UnavailabilityPlanCreate) -> UnavailabilityPlanResponse:
        """Create an unavailability plan, detect gaps, and compute recommendations."""
        # 1. Insert plan row
        plan_row = (
            self.client.table("unavailability_plans")
            .insert(
                {
                    "team_profile_id": request.team_profile_id,
                    "absent_member_id": request.absent_member_id,
                    "start_date": request.start_date.isoformat(),
                    "end_date": request.end_date.isoformat(),
                    "status": "in_progress",
                }
            )
            .execute()
        )
        plan_id = plan_row.data[0]["id"]
        team_profile_id = request.team_profile_id

        # 2. Query shifts and team members
        start_iso = request.start_date.isoformat()
        end_iso = request.end_date.isoformat()
        context_start = (request.start_date - timedelta(days=7)).isoformat()
        context_end = (request.end_date + timedelta(days=7)).isoformat()

        # Get absent member's shifts in the date range
        absent_shifts = (
            self.client.table("shifts")
            .select("*")
            .eq("member_id", request.absent_member_id)
            .eq("status", "active")
            .gte("start_time", f"{start_iso}T00:00:00Z")
            .lte("start_time", f"{end_iso}T23:59:59Z")
            .execute()
        )

        # Get all team members for this profile
        team_members = (
            self.client.table("team_members")
            .select("*")
            .eq("team_profile_id", team_profile_id)
            .execute()
        )

        # Get all shifts for the team in the wider context window
        member_ids = [m["id"] for m in team_members.data]
        all_shifts = (
            self.client.table("shifts")
            .select("*")
            .in_("member_id", member_ids)
            .eq("status", "active")
            .gte("start_time", f"{context_start}T00:00:00Z")
            .lte("start_time", f"{context_end}T23:59:59Z")
            .execute()
        )

        # Build absent member shift dates for quick lookup
        absent_shift_dates: dict[str, dict[str, Any]] = {}
        for shift in absent_shifts.data:
            shift_date = shift["start_time"][:10]
            absent_shift_dates[shift_date] = shift

        # Get team profile config for demand/coverage rules
        team_profile = (
            self.client.table("team_profiles")
            .select("config")
            .eq("id", team_profile_id)
            .single()
            .execute()
        )
        profile_config = team_profile.data.get("config", {}) if team_profile.data else {}
        slot_minimums = self._build_slot_minimums(profile_config)

        # 3. For each day in the range, detect gaps and rank candidates
        current = request.start_date
        while current <= request.end_date:
            date_str = current.isoformat()
            absent_shift = absent_shift_dates.get(date_str)

            if absent_shift is None:
                # No shift for the absent member on this day — no gap
                self.client.table("unavailability_days").insert(
                    {
                        "plan_id": plan_id,
                        "date": date_str,
                        "status": "no_gap",
                        "cascade_depth": 0,
                        "recommendations": [],
                    }
                ).execute()
                current += timedelta(days=1)
                continue

            # Check if removing this shift creates a coverage gap
            is_gap = self._is_coverage_gap_from_shift(
                absent_shift, all_shifts.data, slot_minimums
            )

            if not is_gap:
                self.client.table("unavailability_days").insert(
                    {
                        "plan_id": plan_id,
                        "date": date_str,
                        "original_shift_id": absent_shift["id"],
                        "status": "no_gap",
                        "cascade_depth": 0,
                        "recommendations": [],
                    }
                ).execute()
                current += timedelta(days=1)
                continue

            # Gap detected — rank replacement candidates
            recommendations = self._rank_candidates(
                absent_shift=absent_shift,
                absent_member_id=request.absent_member_id,
                team_members=team_members.data,
                all_shifts=all_shifts.data,
                plan_start=request.start_date,
                plan_end=request.end_date,
            )

            self.client.table("unavailability_days").insert(
                {
                    "plan_id": plan_id,
                    "date": date_str,
                    "original_shift_id": absent_shift["id"],
                    "status": "pending",
                    "cascade_depth": 0,
                    "recommendations": [r.model_dump() for r in recommendations],
                }
            ).execute()

            current += timedelta(days=1)

        return self._build_plan_response(plan_id)

    def get_plan(self, plan_id: str) -> UnavailabilityPlanResponse:
        """Retrieve an existing unavailability plan with all days."""
        return self._build_plan_response(plan_id)

    def approve_day(
        self, plan_id: str, day_id: str, approved_member_id: str
    ) -> UnavailabilityPlanResponse:
        """Approve a day — create coverage shift and mark original as unavailable."""
        # 1. Get day record
        day = (
            self.client.table("unavailability_days")
            .select("*")
            .eq("id", day_id)
            .eq("plan_id", plan_id)
            .single()
            .execute()
        )
        day_data = day.data

        if day_data["status"] != "pending":
            raise ValueError(
                f"Day {day_id} is not pending (status: {day_data['status']})"
            )

        # 2. Get original shift
        original_shift = (
            self.client.table("shifts")
            .select("*")
            .eq("id", day_data["original_shift_id"])
            .single()
            .execute()
        )

        # 3. Create coverage shift
        coverage = (
            self.client.table("shifts")
            .insert(
                {
                    "member_id": approved_member_id,
                    "team_profile_id": original_shift.data["team_profile_id"],
                    "start_time": original_shift.data["start_time"],
                    "end_time": original_shift.data["end_time"],
                    "shift_type": original_shift.data["shift_type"],
                    "title": original_shift.data["title"],
                    "status": "active",
                    "is_pending": False,
                    "is_conflict": False,
                    "is_efficient": True,
                    "is_high_fatigue": False,
                    "has_rest_violation": False,
                }
            )
            .execute()
        )

        # 4. Mark original shift unavailable
        (
            self.client.table("shifts")
            .update({"status": "unavailable"})
            .eq("id", day_data["original_shift_id"])
            .execute()
        )

        # 5. Update day record
        (
            self.client.table("unavailability_days")
            .update(
                {
                    "status": "approved",
                    "approved_member_id": approved_member_id,
                    "coverage_shift_id": coverage.data[0]["id"],
                }
            )
            .eq("id", day_id)
            .execute()
        )

        # 6. Cascade detection
        self._detect_cascades(
            plan_id=plan_id,
            approved_member_id=approved_member_id,
            current_depth=day_data["cascade_depth"],
            coverage_date=day_data["date"],
        )

        # 7. Check plan completion
        self._check_plan_completion(plan_id)

        return self._build_plan_response(plan_id)

    def skip_day(self, plan_id: str, day_id: str) -> UnavailabilityPlanResponse:
        """Skip a day — no replacement needed."""
        day = (
            self.client.table("unavailability_days")
            .select("status")
            .eq("id", day_id)
            .eq("plan_id", plan_id)
            .single()
            .execute()
        )
        if day.data["status"] != "pending":
            raise ValueError(f"Day {day_id} is not pending")

        (
            self.client.table("unavailability_days")
            .update({"status": "skipped"})
            .eq("id", day_id)
            .execute()
        )

        self._check_plan_completion(plan_id)
        return self._build_plan_response(plan_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_plan_response(self, plan_id: str) -> UnavailabilityPlanResponse:
        """Query plan + days and build response model."""
        plan = (
            self.client.table("unavailability_plans")
            .select("*")
            .eq("id", plan_id)
            .single()
            .execute()
        )
        days = (
            self.client.table("unavailability_days")
            .select("*")
            .eq("plan_id", plan_id)
            .order("date")
            .order("cascade_depth")
            .execute()
        )

        day_responses = []
        for d in days.data:
            recs_raw = d.get("recommendations") or []
            recommendations = [
                UnavailabilityDayRecommendation(**r) for r in recs_raw
            ]
            day_responses.append(
                UnavailabilityDayResponse(
                    id=d["id"],
                    plan_id=d["plan_id"],
                    date=d["date"],
                    original_shift_id=d.get("original_shift_id"),
                    coverage_shift_id=d.get("coverage_shift_id"),
                    approved_member_id=d.get("approved_member_id"),
                    status=d["status"],
                    cascade_depth=d.get("cascade_depth", 0),
                    recommendations=recommendations,
                )
            )

        p = plan.data
        return UnavailabilityPlanResponse(
            id=p["id"],
            team_profile_id=p["team_profile_id"],
            absent_member_id=p["absent_member_id"],
            start_date=p["start_date"],
            end_date=p["end_date"],
            status=p["status"],
            cascade_depth_limit=p.get("cascade_depth_limit", 3),
            days=day_responses,
        )

    def _check_plan_completion(self, plan_id: str) -> None:
        """If all days are resolved, mark plan as completed."""
        days = (
            self.client.table("unavailability_days")
            .select("status")
            .eq("plan_id", plan_id)
            .execute()
        )
        all_resolved = all(
            d["status"] in ("approved", "skipped", "no_gap") for d in days.data
        )
        if all_resolved and days.data:
            (
                self.client.table("unavailability_plans")
                .update({"status": "completed"})
                .eq("id", plan_id)
                .execute()
            )

    @staticmethod
    def _build_slot_minimums(profile_config: dict[str, Any]) -> dict[str, int]:
        """Build a map of slot_name → minimum headcount from both slot_policies and workload_template."""
        minimums: dict[str, int] = {}

        # Source 1: slot_policies (raw config from DB)
        slot_policies = profile_config.get("slot_policies", {})
        for slot_name, policy in slot_policies.items():
            min_hc = int(policy.get("min_headcount", 0) or 0)
            if min_hc > 0:
                minimums[slot_name] = max(minimums.get(slot_name, 0), min_hc)

        # Source 2: workload_template (if present — has minimum_headcount per slot)
        workload_template = profile_config.get("workload_template", [])
        for row in workload_template:
            slot_name = row.get("slot_name")
            if not slot_name:
                continue
            min_hc = int(row.get("minimum_headcount", 0) or 0)
            if min_hc > 0:
                minimums[slot_name] = max(minimums.get(slot_name, 0), min_hc)

        return minimums

    def _is_coverage_gap_from_shift(
        self,
        target_shift: dict[str, Any],
        all_shifts: list[dict[str, Any]],
        slot_minimums: dict[str, int],
    ) -> bool:
        """Check if removing target_shift drops coverage below minimum headcount."""
        shift_date = target_shift["start_time"][:10]
        shift_type = target_shift.get("shift_type", "day")
        slot_name = target_shift.get("title")

        # Count headcount for this slot/shift_type on this day (excluding the target shift)
        remaining = sum(
            1
            for s in all_shifts
            if s["start_time"][:10] == shift_date
            and s["id"] != target_shift["id"]
            and s.get("status", "active") == "active"
            and (
                (slot_name and s.get("title") == slot_name)
                or (not slot_name and s.get("shift_type") == shift_type)
            )
        )

        # Look up minimum from pre-built map
        minimum = 0
        if slot_name and slot_name in slot_minimums:
            minimum = slot_minimums[slot_name]

        # Fallback: if no explicit minimum is configured but this shift exists,
        # assume the scheduler placed it for a reason — treat as gap if no one
        # else covers the same slot on this day
        if minimum == 0:
            minimum = 1

        return remaining < minimum

    def _rank_candidates(
        self,
        *,
        absent_shift: dict[str, Any],
        absent_member_id: str,
        team_members: list[dict[str, Any]],
        all_shifts: list[dict[str, Any]],
        plan_start: date,
        plan_end: date,
        top_n: int = 5,
    ) -> list[UnavailabilityDayRecommendation]:
        """Rank replacement candidates for a specific shift using fatigue-aware scoring."""
        shift_date_str = absent_shift["start_time"][:10]
        shift_date = date.fromisoformat(shift_date_str)
        shift_start = _parse_datetime(absent_shift["start_time"])
        shift_type = absent_shift.get("shift_type", "day")
        absent_region = None

        # Find absent member's region
        for m in team_members:
            if m["id"] == absent_member_id:
                absent_region = m.get("region", "Unknown")
                break
        absent_region = absent_region or "Unknown"

        candidates: list[UnavailabilityDayRecommendation] = []

        for member in team_members:
            if member["id"] == absent_member_id:
                continue

            member_id = member["id"]
            member_region = member.get("region", "Unknown")

            # Check if member already has a shift on this day
            has_shift_on_day = any(
                s["start_time"][:10] == shift_date_str
                and s["member_id"] == member_id
                and s.get("status", "active") == "active"
                for s in all_shifts
            )
            if has_shift_on_day:
                continue

            # Gather member's shift history for fatigue scoring
            member_shifts = [
                s for s in all_shifts if s["member_id"] == member_id
            ]

            # Compute fatigue metrics using static methods from FatigueAwareRecommendationService
            history = _shifts_to_history(member_shifts)
            rest_hours = FatigueAwareRecommendationService._rest_hours_since_last_shift(
                history, shift_start
            )
            consecutive_days = FatigueAwareRecommendationService._consecutive_days_worked(
                history, shift_date
            )
            overtime_hours = _hours_worked_last_week(history, shift_start)

            # Heuristic fatigue score
            rest_penalty = (
                0.0 if rest_hours is None else max(0.0, (12.0 - rest_hours) / 12.0) * 0.45
            )
            streak_penalty = max(0.0, consecutive_days - 3) / 4.0 * 0.25
            weekly_penalty = max(0.0, overtime_hours - 40.0) / 20.0 * 0.20
            fatigue_score = min(1.0, rest_penalty + streak_penalty + weekly_penalty)

            # Region distance
            region_priority = FatigueAwareRecommendationService._region_distance(
                absent_region, member_region
            )

            # Cascade cost: count how many of this candidate's other shifts in the
            # plan date range would leave coverage below minimum if they're pulled
            cascade_cost = self._compute_cascade_cost(
                member_id=member_id,
                all_shifts=all_shifts,
                plan_start=plan_start,
                plan_end=plan_end,
                exclude_date=shift_date_str,
            )

            # Ranking formula (lower = better)
            ranking_score = round(
                (region_priority * 100.0)
                + (overtime_hours * 12.0)
                + (fatigue_score * 75.0)
                + (cascade_cost * 50.0),
                3,
            )

            rationale = FatigueAwareRecommendationService._build_rationale(
                absent_region=absent_region,
                replacement_region=member_region,
                overtime_hours=0.0,
                fatigue_score=fatigue_score,
                rest_hours=rest_hours,
            )

            candidates.append(
                UnavailabilityDayRecommendation(
                    member_id=member_id,
                    member_name=member.get("name", "Unknown"),
                    region=member_region,
                    ranking_score=ranking_score,
                    fatigue_score=round(fatigue_score, 3),
                    rest_hours=round(rest_hours or 0.0, 2),
                    consecutive_days=consecutive_days,
                    overtime_hours=round(overtime_hours, 2),
                    cascade_cost=cascade_cost,
                    rationale=rationale,
                )
            )

        # Sort by ranking_score ascending (lower = better)
        candidates.sort(key=lambda c: (c.ranking_score, c.member_name))
        return candidates[:top_n]

    def _compute_cascade_cost(
        self,
        *,
        member_id: str,
        all_shifts: list[dict[str, Any]],
        plan_start: date,
        plan_end: date,
        exclude_date: str,
    ) -> int:
        """Count how many of this member's shifts in the plan range would create a gap if pulled."""
        start_iso = plan_start.isoformat()
        end_iso = plan_end.isoformat()
        member_plan_shifts = [
            s
            for s in all_shifts
            if s["member_id"] == member_id
            and s.get("status", "active") == "active"
            and start_iso <= s["start_time"][:10] <= end_iso
            and s["start_time"][:10] != exclude_date
        ]
        # For now, just count the number of shifts this member has in the plan range
        # (simplified cascade cost — a full gap check per shift would be more accurate)
        return len(member_plan_shifts)

    def _detect_cascades(
        self,
        *,
        plan_id: str,
        approved_member_id: str,
        current_depth: int,
        coverage_date: str,
    ) -> None:
        """After approving a replacement, check if the replacement's other shifts create new gaps."""
        plan = (
            self.client.table("unavailability_plans")
            .select("*")
            .eq("id", plan_id)
            .single()
            .execute()
        )
        plan_data = plan.data
        depth_limit = plan_data.get("cascade_depth_limit", 3)

        if current_depth + 1 > depth_limit:
            return

        # Get team profile config for gap detection
        team_profile = (
            self.client.table("team_profiles")
            .select("config")
            .eq("id", plan_data["team_profile_id"])
            .single()
            .execute()
        )
        profile_config = team_profile.data.get("config", {}) if team_profile.data else {}
        slot_minimums = self._build_slot_minimums(profile_config)

        # Get all team members
        team_members = (
            self.client.table("team_members")
            .select("*")
            .eq("team_profile_id", plan_data["team_profile_id"])
            .execute()
        )
        member_ids = [m["id"] for m in team_members.data]

        # Get replacement's other active shifts in the plan date range
        replacement_shifts = (
            self.client.table("shifts")
            .select("*")
            .eq("member_id", approved_member_id)
            .eq("status", "active")
            .gte("start_time", f"{plan_data['start_date']}T00:00:00Z")
            .lte("start_time", f"{plan_data['end_date']}T23:59:59Z")
            .execute()
        )

        # Get all active shifts for gap checking
        context_start = (date.fromisoformat(plan_data["start_date"]) - timedelta(days=7)).isoformat()
        context_end = (date.fromisoformat(plan_data["end_date"]) + timedelta(days=7)).isoformat()
        all_shifts = (
            self.client.table("shifts")
            .select("*")
            .in_("member_id", member_ids)
            .eq("status", "active")
            .gte("start_time", f"{context_start}T00:00:00Z")
            .lte("start_time", f"{context_end}T23:59:59Z")
            .execute()
        )

        for shift in replacement_shifts.data:
            shift_date = shift["start_time"][:10]
            # Skip the day we just created coverage for
            if shift_date == coverage_date:
                continue

            # Check if removing this employee creates a gap
            if self._is_coverage_gap_from_shift(shift, all_shifts.data, slot_minimums):
                new_depth = current_depth + 1
                if new_depth <= depth_limit:
                    # Create cascade day with recommendations
                    recommendations = self._rank_candidates(
                        absent_shift=shift,
                        absent_member_id=approved_member_id,
                        team_members=team_members.data,
                        all_shifts=all_shifts.data,
                        plan_start=date.fromisoformat(plan_data["start_date"]),
                        plan_end=date.fromisoformat(plan_data["end_date"]),
                    )
                    self.client.table("unavailability_days").insert(
                        {
                            "plan_id": plan_id,
                            "date": shift_date,
                            "original_shift_id": shift["id"],
                            "status": "pending" if recommendations else "needs_manual",
                            "cascade_depth": new_depth,
                            "recommendations": [r.model_dump() for r in recommendations],
                        }
                    ).execute()
                else:
                    # Flag as needs_manual
                    self.client.table("unavailability_days").insert(
                        {
                            "plan_id": plan_id,
                            "date": shift_date,
                            "original_shift_id": shift["id"],
                            "status": "needs_manual",
                            "cascade_depth": new_depth,
                            "recommendations": [],
                        }
                    ).execute()


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------

def _parse_datetime(value: str) -> datetime:
    """Parse an ISO datetime string to a timezone-aware datetime."""
    normalized = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _shifts_to_history(shifts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert shift rows to the history format expected by FatigueAwareRecommendationService."""
    history = []
    for s in shifts:
        history.append(
            {
                "employee_id": s.get("member_id"),
                "start_utc": _parse_datetime(s["start_time"]),
                "end_utc": _parse_datetime(s["end_time"]),
                "shift_type": s.get("shift_type", "day"),
            }
        )
    history.sort(key=lambda h: h["start_utc"])
    return history


def _hours_worked_last_week(
    history: list[dict[str, Any]], target_start: datetime
) -> float:
    """Total hours worked in the 7 days before target_start."""
    window_start = target_start - timedelta(days=7)
    total = 0.0
    for item in history:
        if item["end_utc"] <= window_start or item["start_utc"] >= target_start:
            continue
        total += (item["end_utc"] - item["start_utc"]).total_seconds() / 3600.0
    return round(total, 2)
