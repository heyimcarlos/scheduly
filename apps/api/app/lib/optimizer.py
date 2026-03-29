"""CP-SAT two-pass shift scheduler driven by shared JSON config."""

from __future__ import annotations

import copy
import json
import logging
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ortools.sat.python import cp_model

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(funcName)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

# Resolve path to workspace root (apps/api/app/lib -> apps/api/app -> apps/api -> apps -> workspace)
_WORKSPACE_ROOT = Path(__file__).resolve().parents[4]
_CONFIG_PATH = _WORKSPACE_ROOT / "packages" / "shared" / "system_config.json"


def load_system_config() -> dict:
    with open(_CONFIG_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Data-transfer types (mirror backend schemas without Pydantic dependency)
# ---------------------------------------------------------------------------


@dataclass
class ShiftDemandPoint:
    """One row of shift-type demand with a minimum floor and ideal target."""

    utc_date: date
    shift_type: str  # "day" | "evening" | "night"
    required_headcount: Optional[int] = None
    minimum_headcount: Optional[int] = None
    ideal_headcount: Optional[int] = None
    priority_weight: int = 1
    source: str = "forecast"

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
        if minimum is None and ideal is None:
            minimum = 0
            ideal = 0
        elif minimum is None:
            minimum = ideal
        elif ideal is None:
            ideal = minimum

        self.minimum_headcount = max(0, int(minimum or 0))
        self.ideal_headcount = max(self.minimum_headcount, int(ideal or 0))
        self.required_headcount = self.ideal_headcount
        self.priority_weight = max(1, int(self.priority_weight or 1))


@dataclass
class SlotDemandPoint:
    """One row of slot-level demand with a minimum floor and ideal target."""

    utc_date: date
    slot_name: str
    required_headcount: Optional[int] = None
    minimum_headcount: Optional[int] = None
    ideal_headcount: Optional[int] = None
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

        if minimum is None and ideal is None:
            minimum = 0
            ideal = 0
        elif minimum is None:
            minimum = ideal
        elif ideal is None:
            ideal = minimum

        self.minimum_headcount = max(0, int(minimum or 0))
        self.ideal_headcount = max(self.minimum_headcount, int(ideal or 0))
        self.required_headcount = self.ideal_headcount
        self.priority_weight = max(1, int(self.priority_weight or 1))


@dataclass
class EmployeeInput:
    employee_id: int
    region: str
    employee_name: Optional[str] = None
    timezone: Optional[str] = None  # IANA timezone, e.g. "Asia/Kolkata"


@dataclass
class AbsenceEvent:
    employee_id: int
    day_offset: int  # 0-based offset from start_date


@dataclass
class PreferenceEvent:
    employee_id: int
    day_offset: int  # 0-based offset from start_date
    slot_name: Optional[str]  # None / "" means "wants day off"
    weight: int = 10


@dataclass
class ScheduleInput:
    """All inputs required to run the two-pass solver."""

    start_date: date
    num_days: int
    employees: List[EmployeeInput]
    shift_demand: List[ShiftDemandPoint]  # one row per (utc_date, shift_type)
    slot_demand: List[SlotDemandPoint] = field(default_factory=list)
    absences: List[AbsenceEvent] = field(default_factory=list)
    preferences: List[PreferenceEvent] = field(default_factory=list)
    team_profile_id: Optional[str] = None
    team_profile_config: Optional[Dict[str, Any]] = None
    # History: employee_id → [worked_day_minus_2, worked_day_minus_1]  (1/0)
    history: Dict[int, Tuple[int, int]] = field(default_factory=dict)
    days_off_required: int = 4
    min_rest_hours: int = 12
    min_weekly_hours_required: int = 0
    overtime_threshold_hours: int = 40
    # Maximum wall-clock seconds allowed per solver pass (None = unlimited)
    time_limit_seconds: Optional[float] = 120.0
    # Pre-computed fatigue trajectories: employee_id -> [score per day]
    fatigue_trajectories: Dict[int, List[float]] = field(default_factory=dict)
    # Fatigue-aware scheduling parameters
    fatigue_weight: float = 0.0  # Weight of fatigue penalty in objective (0 = disabled)
    fatigue_threshold: float = 0.6  # Employees above this fatigue are deprioritized for extra shifts


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _time_to_minutes(t: str) -> int:
    """Convert 'HH:MM' to integer minutes since midnight. '00:00' → 0."""
    h, m = map(int, t.split(":"))
    return h * 60 + m


def _slots_for_pass(shift_slots: List[dict], canonical: bool) -> List[dict]:
    return [s for s in shift_slots if s["canonical"] is canonical]


def _demand_index(
    shift_demand: List[ShiftDemandPoint],
) -> Dict[Tuple[date, str], ShiftDemandPoint]:
    """Build a fast lookup: (utc_date, shift_type) → demand point."""
    return {(dp.utc_date, dp.shift_type): dp for dp in shift_demand}


def _slot_demand_index(
    slot_demand: List[SlotDemandPoint],
) -> Dict[Tuple[date, str], SlotDemandPoint]:
    """Build a fast lookup: (utc_date, slot_name) -> demand point."""
    return {(dp.utc_date, dp.slot_name): dp for dp in slot_demand}


def _date_for_offset(start_date: date, offset: int) -> date:
    return start_date + timedelta(days=offset)


def _merge_inline_team_profile(
    system_config: Dict[str, Any],
    profile_id: Optional[str],
    team_profile_config: Optional[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Optional[str]]:
    if not team_profile_config:
        return system_config, profile_id

    merged_config = copy.deepcopy(system_config)
    profiles = dict(merged_config.get("team_profiles") or {})
    template_key = team_profile_config.get("template_key")
    resolved_id = (
        profile_id
        or template_key
        or merged_config.get("default_team_profile_id")
        or "inline_team_profile"
    )

    base_profile = copy.deepcopy(
        profiles.get(template_key) or profiles.get(resolved_id) or {}
    )
    base_slot_policies = dict(base_profile.get("slot_policies") or {})
    inline_slot_policies = team_profile_config.get("slot_policies") or {}

    merged_slot_policies = {
        slot_name: {**base_slot_policies.get(slot_name, {}), **slot_policy}
        for slot_name, slot_policy in inline_slot_policies.items()
    }
    for slot_name, slot_policy in base_slot_policies.items():
        merged_slot_policies.setdefault(slot_name, slot_policy)

    merged_profile = {
        **base_profile,
        **team_profile_config,
        "name": team_profile_config.get("name")
        or base_profile.get("name")
        or template_key
        or resolved_id,
        "service_timezone": team_profile_config.get("service_timezone")
        or base_profile.get("service_timezone")
        or merged_config.get("raw_data_timezone"),
        "slot_policies": merged_slot_policies,
    }

    # To verify: Add this debug temporarily in solve_scheduling after the merge:
    logger.info("Merged slot policies: %s", {
      k: v.get("allowed_regions") for k, v in merged_slot_policies.items()
    })

    profiles[resolved_id] = merged_profile
    merged_config["team_profiles"] = profiles
    return merged_config, resolved_id


def _resolve_team_profile(
    system_config: Dict[str, Any], profile_id: Optional[str]
) -> Tuple[str, Dict[str, Any]]:
    profiles = system_config.get("team_profiles") or {}
    resolved_id = (
        profile_id or system_config.get("default_team_profile_id") or "default"
    )
    profile = profiles.get(resolved_id)

    if profile:
        return resolved_id, profile

    if profile_id:
        logger.warning(
            "Unknown team_profile_id=%s; falling back to legacy slot behavior.",
            profile_id,
        )

    return resolved_id, {
        "name": "Legacy Default",
        "service_timezone": system_config.get("raw_data_timezone"),
        "slot_policies": {},
    }


def _materialize_shift_slots(
    system_config: Dict[str, Any], profile_id: Optional[str]
) -> Tuple[List[dict], str, Dict[str, Any]]:
    resolved_profile_id, team_profile = _resolve_team_profile(system_config, profile_id)
    regions = list(system_config.get("regions", {}).keys())
    slot_policies = team_profile.get("slot_policies") or {}
    raw_slots = system_config.get("shift_slots", [])
    known_slot_names = {slot["name"] for slot in raw_slots}

    for slot_name in slot_policies:
        if slot_name not in known_slot_names:
            logger.warning(
                "Team profile %s defines policy for unknown slot %s.",
                resolved_profile_id,
                slot_name,
            )

    materialized_slots: List[dict] = []
    for slot in raw_slots:
        policy = slot_policies.get(slot["name"], {})
        allowed_regions = policy.get("allowed_regions") or regions
        preferred_regions = policy.get("preferred_regions") or allowed_regions
        patch_regions = policy.get("patch_regions") or []
        materialized_slot = dict(slot)
        materialized_slot.update(
            {
                "allowed_regions": allowed_regions,
                "preferred_regions": preferred_regions,
                "patch_regions": patch_regions,
                "fallback_penalty": int(policy.get("fallback_penalty", 0)),
                "patch_penalty": int(
                    policy.get("patch_penalty", policy.get("fallback_penalty", 0))
                ),
                "region_penalties": {
                    key: int(value)
                    for key, value in (policy.get("region_penalties") or {}).items()
                },
                "coverage_label": policy.get("coverage_label", slot["name"]),
                "coverage_role": policy.get("coverage_role", slot["shift_type"]),
                "canonical": bool(policy.get("canonical", slot["canonical"])),
                "max_headcount": policy.get("max_headcount"),  # None = no cap
                "min_headcount": int(policy.get("min_headcount", 0)),  # 0 = no floor
            }
        )
        materialized_slots.append(materialized_slot)

    return materialized_slots, resolved_profile_id, team_profile


def _resolve_zoneinfo(timezone_name: Optional[str]) -> Optional[ZoneInfo]:
    if not timezone_name:
        return None

    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        logger.warning(
            "Timezone data not found for %s; falling back to static UTC slot config.",
            timezone_name,
        )
        return None


def _build_slot_occurrence(
    slot: dict,
    slot_date: date,
    schedule_zone: Optional[ZoneInfo],
) -> dict:
    occurrence = dict(slot)
    local_start = slot.get("local_start_time")
    local_end = slot.get("local_end_time")

    if schedule_zone and local_start and local_end:
        start_hour, start_minute = map(int, local_start.split(":"))
        end_hour, end_minute = map(int, local_end.split(":"))

        start_local = datetime.combine(
            slot_date,
            time(hour=start_hour, minute=start_minute),
            tzinfo=schedule_zone,
        )
        end_local_date = slot_date + timedelta(
            days=int(_time_to_minutes(local_end) <= _time_to_minutes(local_start))
        )
        end_local = datetime.combine(
            end_local_date,
            time(hour=end_hour, minute=end_minute),
            tzinfo=schedule_zone,
        )

        start_utc = start_local.astimezone(timezone.utc)
        end_utc = end_local.astimezone(timezone.utc)

        occurrence["utc_start"] = start_utc.strftime("%H:%M")
        occurrence["utc_end"] = end_utc.strftime("%H:%M")
        occurrence["utc_start_at"] = start_utc
        occurrence["utc_end_at"] = end_utc
        occurrence["local_start_time"] = local_start
        occurrence["local_end_time"] = local_end
        return occurrence

    utc_start = slot["utc_start"]
    utc_end = slot["utc_end"]
    start_hour, start_minute = map(int, utc_start.split(":"))
    end_hour, end_minute = map(int, utc_end.split(":"))
    start_utc = datetime.combine(
        slot_date,
        time(hour=start_hour, minute=start_minute),
        tzinfo=timezone.utc,
    )
    end_utc_date = slot_date + timedelta(
        days=int(_time_to_minutes(utc_end) <= _time_to_minutes(utc_start))
    )
    end_utc = datetime.combine(
        end_utc_date,
        time(hour=end_hour, minute=end_minute),
        tzinfo=timezone.utc,
    )
    occurrence["utc_start_at"] = start_utc
    occurrence["utc_end_at"] = end_utc
    occurrence["local_start_time"] = local_start
    occurrence["local_end_time"] = local_end
    return occurrence


def _build_slot_occurrences_by_day(
    shift_slots: List[dict],
    start_date: date,
    num_days: int,
    schedule_timezone: Optional[str],
) -> Dict[int, Dict[str, dict]]:
    schedule_zone = _resolve_zoneinfo(schedule_timezone)
    occurrences: Dict[int, Dict[str, dict]] = {}

    for day_offset in range(num_days):
        current_date = _date_for_offset(start_date, day_offset)
        occurrences[day_offset] = {
            slot["name"]: _build_slot_occurrence(slot, current_date, schedule_zone)
            for slot in shift_slots
        }

    return occurrences


# ---------------------------------------------------------------------------
# Variable creation
# ---------------------------------------------------------------------------


def _create_shift_vars(
    model: cp_model.CpModel,
    num_employees: int,
    num_days: int,
    slot_names: List[str],
) -> Tuple[Dict, Dict]:
    """
    shifts[(e, d, slot_name)] = BoolVar  — is employee e working slot on day d?
    is_working[(e, d)]         = BoolVar  — is employee e working *at all* on day d?
    """
    shifts: Dict = {}
    is_working: Dict = {}

    for e in range(num_employees):
        for d in range(num_days):
            for slot in slot_names:
                shifts[(e, d, slot)] = model.new_bool_var(f"e{e}_d{d}_{slot}")

    for e in range(num_employees):
        for d in range(num_days):
            is_working[(e, d)] = model.new_bool_var(f"working_e{e}_d{d}")
            day_slot_vars = [shifts[(e, d, slot)] for slot in slot_names]
            model.add_max_equality(is_working[(e, d)], day_slot_vars)

    return shifts, is_working


# ---------------------------------------------------------------------------
# Constraint factories
# ---------------------------------------------------------------------------


def _add_per_slot_headcount_constraints(
    model: cp_model.CpModel,
    shifts: Dict,
    employees: List[EmployeeInput],
    slots: List[dict],
    num_days: int,
) -> None:
    """Enforce per-slot headcount bounds (min_headcount and max_headcount).

    min_headcount is only enforced when the employee pool has enough eligible
    members to satisfy all per-slot minimums simultaneously (one slot per day
    per employee).  This prevents infeasibility in small/test setups while still
    locking in the constraint for production-sized teams.
    """
    n_emp = len(employees)

    # Determine which slots have a meaningful min_headcount and at least one
    # eligible employee.
    constrained_slots: List[dict] = []
    for slot in slots:
        min_hc = int(slot.get("min_headcount") or 0)
        if min_hc <= 0:
            continue
        allowed_regions = set(slot.get("allowed_regions") or [])
        if any(
            not allowed_regions or emp.region in allowed_regions for emp in employees
        ):
            constrained_slots.append(slot)

    # Guard: enforce minimums only if we have enough eligible employees to fill
    # all constrained slots simultaneously (each employee works ≤1 slot/day).
    total_min_hc = sum(int(s.get("min_headcount") or 0) for s in constrained_slots)
    eligible_for_any: set = set()
    for slot in constrained_slots:
        allowed_regions = set(slot.get("allowed_regions") or [])
        for e_idx, emp in enumerate(employees):
            if not allowed_regions or emp.region in allowed_regions:
                eligible_for_any.add(e_idx)
    enforce_mins = len(eligible_for_any) >= total_min_hc
    constrained_slot_names = {s["name"] for s in constrained_slots}

    for slot in slots:
        slot_name = slot["name"]
        min_hc = int(slot.get("min_headcount") or 0)
        max_hc = slot.get("max_headcount")
        for d in range(num_days):
            slot_sum = sum(
                shifts[(e, d, slot_name)]
                for e in range(n_emp)
                if (e, d, slot_name) in shifts
            )
            if min_hc > 0 and enforce_mins and slot_name in constrained_slot_names:
                model.add(slot_sum >= min_hc)
            if max_hc is not None:
                model.add(slot_sum <= int(max_hc))


def _add_demand_constraints(
    model: cp_model.CpModel,
    shifts: Dict,
    employees: List[EmployeeInput],
    active_slots: List[dict],
    demand_index: Dict[Tuple[date, str], ShiftDemandPoint],
    start_date: date,
    num_days: int,
) -> List[cp_model.LinearExpr]:
    """
    For each (day, shift_type) enforce:
        Σ employees assigned to any active slot of that shift_type >= minimum_headcount

    Then penalize shortfall versus ideal_headcount (soft penalty; no hard upper cap).

    'active_slots' is either canonical-only (Pass 1) or all slots (Pass 2).
    """
    # Group active slot names by shift_type
    slots_by_type: Dict[str, List[str]] = {}
    for slot in active_slots:
        slots_by_type.setdefault(slot["shift_type"], []).append(slot["name"])

    penalties: List[cp_model.LinearExpr] = []

    for d in range(num_days):
        cur_date = _date_for_offset(start_date, d)
        for shift_type, slot_names in slots_by_type.items():
            demand_point = demand_index.get((cur_date, shift_type))
            minimum = int(demand_point.minimum_headcount or 0) if demand_point else 0
            ideal = (
                int(demand_point.ideal_headcount or minimum)
                if demand_point
                else minimum
            )
            priority_weight = (
                int(demand_point.priority_weight or 1) if demand_point else 1
            )
            assigned = [
                shifts[(e_idx, d, slot)]
                for e_idx in range(len(employees))
                for slot in slot_names
                if (e_idx, d, slot) in shifts
            ]
            assigned_sum = sum(assigned)
            model.add(assigned_sum >= minimum)

            shortfall = model.new_int_var(
                0,
                ideal,
                f"ideal_shortfall_{shift_type}_{d}",
            )
            model.add(shortfall >= ideal - assigned_sum)
            penalties.append(shortfall * priority_weight)

    return penalties


def _add_slot_demand_constraints(
    model: cp_model.CpModel,
    shifts: Dict,
    employees: List[EmployeeInput],
    active_slots: List[dict],
    slot_demand_index: Dict[Tuple[date, str], SlotDemandPoint],
    start_date: date,
    num_days: int,
) -> List[cp_model.LinearExpr]:
    """Enforce known workload directly on slot names when slot demand is supplied."""
    slot_names = {slot["name"] for slot in active_slots}
    penalties: List[cp_model.LinearExpr] = []

    for d in range(num_days):
        cur_date = _date_for_offset(start_date, d)
        for slot_name in slot_names:
            demand_point = slot_demand_index.get((cur_date, slot_name))
            if demand_point is None:
                continue

            minimum = int(demand_point.minimum_headcount or 0)
            ideal = int(demand_point.ideal_headcount or minimum)
            priority_weight = int(demand_point.priority_weight or 1)
            assigned = [
                shifts[(e_idx, d, slot_name)]
                for e_idx in range(len(employees))
                if (e_idx, d, slot_name) in shifts
            ]
            assigned_sum = sum(assigned)
            model.add(assigned_sum >= minimum)

            shortfall = model.new_int_var(
                0,
                ideal,
                f"ideal_shortfall_{slot_name}_{d}",
            )
            model.add(shortfall >= ideal - assigned_sum)
            penalties.append(shortfall * priority_weight)

    return penalties


def _add_one_slot_per_day(
    model: cp_model.CpModel,
    shifts: Dict,
    num_employees: int,
    num_days: int,
    slot_names: List[str],
) -> None:
    """Each employee works at most one slot per day."""
    for e in range(num_employees):
        for d in range(num_days):
            model.add(sum(shifts[(e, d, slot)] for slot in slot_names) <= 1)


def _add_overlap_constraints(
    model: cp_model.CpModel,
    shifts: Dict,
    num_employees: int,
    num_days: int,
    slot_names: List[str],
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
) -> None:
    """Prevent employees from being assigned two overlapping slots on the same day."""
    for d in range(num_days):
        overlap_pairs: List[Tuple[str, str]] = []
        day_slots = slot_occurrences_by_day[d]

        for i, slot_name_1 in enumerate(slot_names):
            s1 = day_slots[slot_name_1]
            start1 = _time_to_minutes(s1["utc_start"])
            end1 = _time_to_minutes(s1["utc_end"])
            if end1 <= start1:  # crosses midnight
                end1 += 1440

            for slot_name_2 in slot_names[i + 1 :]:
                s2 = day_slots[slot_name_2]
                start2 = _time_to_minutes(s2["utc_start"])
                end2 = _time_to_minutes(s2["utc_end"])
                if end2 <= start2:
                    end2 += 1440
                if start1 < end2 and start2 < end1:
                    overlap_pairs.append((slot_name_1, slot_name_2))

        for e in range(num_employees):
            for n1, n2 in overlap_pairs:
                if (e, d, n1) in shifts and (e, d, n2) in shifts:
                    model.add(shifts[(e, d, n1)] + shifts[(e, d, n2)] <= 1)


def _add_min_rest_constraints(
    model: cp_model.CpModel,
    shifts: Dict,
    num_employees: int,
    num_days: int,
    slot_names: List[str],
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
    min_rest_hours: int,
) -> None:
    """Forbid shift pairs across consecutive days that violate min_rest_hours."""
    min_rest_min = min_rest_hours * 60
    for e in range(num_employees):
        for d in range(num_days - 1):
            forbidden: List[Tuple[str, str]] = []
            today_slots = slot_occurrences_by_day[d]
            tomorrow_slots = slot_occurrences_by_day[d + 1]

            for s1_name in slot_names:
                s1 = today_slots[s1_name]
                end1 = _time_to_minutes(s1["utc_end"])
                if end1 == 0:
                    end1 = 1440  # midnight end → treat as end of day
                elif end1 < _time_to_minutes(s1["utc_start"]):
                    end1 += 1440  # crosses midnight

                for s2_name in slot_names:
                    s2 = tomorrow_slots[s2_name]
                    start2 = _time_to_minutes(s2["utc_start"])
                    gap = (1440 - end1) + start2
                    if gap < min_rest_min:
                        forbidden.append((s1_name, s2_name))

            for s1n, s2n in forbidden:
                if (e, d, s1n) in shifts and (e, d + 1, s2n) in shifts:
                    model.add(shifts[(e, d, s1n)] + shifts[(e, d + 1, s2n)] <= 1)


def _week_buckets(start_date: date, num_days: int) -> List[List[int]]:
    """Group day offsets into calendar-week buckets anchored on Monday."""
    buckets: List[List[int]] = []
    current_bucket: List[int] = []

    for day_offset in range(num_days):
        current_date = _date_for_offset(start_date, day_offset)
        if current_bucket and current_date.weekday() == 0:
            buckets.append(current_bucket)
            current_bucket = []
        current_bucket.append(day_offset)

    if current_bucket:
        buckets.append(current_bucket)
    return buckets


def _slot_duration_hours(slot_occurrence: dict) -> int:
    start_at = slot_occurrence.get("utc_start_at")
    end_at = slot_occurrence.get("utc_end_at")
    if start_at and end_at:
        return max(1, round((end_at - start_at).total_seconds() / 3600.0))

    start_min = _time_to_minutes(slot_occurrence["utc_start"])
    end_min = _time_to_minutes(slot_occurrence["utc_end"])
    if end_min <= start_min:
        end_min += 1440
    return max(1, round((end_min - start_min) / 60.0))


def _employee_max_achievable_hours(
    emp: EmployeeInput,
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
    day_offsets: List[int],
) -> int:
    total_hours = 0
    for day_offset in day_offsets:
        eligible_slot_hours = [
            _slot_duration_hours(slot)
            for slot in slot_occurrences_by_day[day_offset].values()
            if emp.region in (slot.get("allowed_regions") or [])
            or emp.region in (slot.get("patch_regions") or [])
        ]
        if eligible_slot_hours:
            total_hours += max(eligible_slot_hours)
    return total_hours


def _add_workload_constraints(
    model: cp_model.CpModel,
    is_working: Dict,
    shifts: Dict,
    employees: List[EmployeeInput],
    num_days: int,
    days_off_required: int,
    history: Dict[int, Tuple[int, int]],
    slot_names: List[str],
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
    start_date: date,
    min_weekly_hours_required: int = 0,
    overtime_threshold_hours: int = 40,
) -> List[cp_model.LinearExpr]:
    """Enforce day ceilings plus hour-based weekly floors and overtime penalties."""
    working_days_limit = max(0, num_days - days_off_required)
    overtime_penalties: List[cp_model.LinearExpr] = []
    week_buckets = _week_buckets(start_date, num_days)

    for e_idx, emp in enumerate(employees):
        model.add(
            sum(is_working[(e_idx, d)] for d in range(num_days)) <= working_days_limit
        )
        # History-aware: forbid 1-0-1 pattern (isolated single day off)
        h1, h2 = history.get(emp.employee_id, (1, 1))
        for d in range(num_days):
            if d == 0:
                p2, p1 = h1, h2
            elif d == 1:
                p2, p1 = h2, is_working[(e_idx, 0)]
            else:
                p2, p1 = is_working[(e_idx, d - 2)], is_working[(e_idx, d - 1)]
            # (constraint commented out by default — uncomment to enforce)
            # model.add(p2 + (1 - p1) + is_working[(e_idx, d)] <= 2)

        for week_index, day_offsets in enumerate(week_buckets):
            assigned_hours = sum(
                _slot_duration_hours(slot_occurrences_by_day[day_offset][slot_name])
                * shifts[(e_idx, day_offset, slot_name)]
                for day_offset in day_offsets
                for slot_name in slot_names
                if (e_idx, day_offset, slot_name) in shifts
            )

            if min_weekly_hours_required > 0:
                target_floor = round(len(day_offsets) * min_weekly_hours_required / 7)
                max_achievable_hours = _employee_max_achievable_hours(
                    emp,
                    slot_occurrences_by_day,
                    day_offsets,
                )
                effective_floor = min(target_floor, max_achievable_hours)
                if effective_floor > 0:
                    model.add(assigned_hours >= effective_floor)

            overtime_cap = sum(
                _slot_duration_hours(slot_occurrences_by_day[day_offset][slot_name])
                for day_offset in day_offsets
                for slot_name in slot_names
            )
            overtime_hours = model.new_int_var(
                0,
                overtime_cap,
                f"overtime_hours_e{e_idx}_w{week_index}",
            )
            model.add(overtime_hours >= assigned_hours - overtime_threshold_hours)
            overtime_penalties.append(overtime_hours)

    return overtime_penalties


def _add_absence_constraints(
    model: cp_model.CpModel,
    is_working: Dict,
    employees: List[EmployeeInput],
    absences: List[AbsenceEvent],
    num_days: int,
) -> None:
    """Force is_working = 0 for absent employees on absent days."""
    emp_id_to_idx = {emp.employee_id: i for i, emp in enumerate(employees)}
    for absence in absences:
        e_idx = emp_id_to_idx.get(absence.employee_id)
        if e_idx is None:
            logger.warning(
                "Absence for unknown employee_id=%s — skipped", absence.employee_id
            )
            continue
        if 0 <= absence.day_offset < num_days:
            model.add(is_working[(e_idx, absence.day_offset)] == 0)


# ---------------------------------------------------------------------------
# Objective builders
# ---------------------------------------------------------------------------


def _fairness_penalties(
    model: cp_model.CpModel,
    is_working: Dict,
    num_employees: int,
    num_days: int,
    weight: int = 5,
) -> List:
    target = num_days // 2
    penalties = []
    for e in range(num_employees):
        total = sum(is_working[(e, d)] for d in range(num_days))
        diff = model.new_int_var(0, num_days, f"fair_diff_e{e}")
        model.add(diff >= total - target)
        model.add(diff >= target - total)
        penalties.append(diff * weight)
    return penalties


def _preference_scores(
    model: cp_model.CpModel,
    shifts: Dict,
    is_working: Dict,
    employees: List[EmployeeInput],
    preferences: List[PreferenceEvent],
) -> List:
    emp_id_to_idx = {emp.employee_id: i for i, emp in enumerate(employees)}
    scores = []
    for pref in preferences:
        e_idx = emp_id_to_idx.get(pref.employee_id)
        if e_idx is None:
            continue
        d = pref.day_offset
        if pref.slot_name:
            key = (e_idx, d, pref.slot_name)
            if key in shifts:
                scores.append(shifts[key] * pref.weight)
        else:
            # preference is for a day OFF
            scores.append((1 - is_working[(e_idx, d)]) * pref.weight)
    return scores


def _add_region_eligibility_constraints(
    model: cp_model.CpModel,
    shifts: Dict,
    employees: List[EmployeeInput],
    slots: List[dict],
    num_days: int,
) -> None:
    for slot in slots:
        allowed_regions = set(slot.get("allowed_regions") or [])
        if not allowed_regions:
            continue

        for e_idx, employee in enumerate(employees):
            emp_region_lower = employee.region.lower()
            allowed_lower = {r.lower() for r in allowed_regions}
            if emp_region_lower in allowed_lower:
                continue

            for d in range(num_days):
                key = (e_idx, d, slot["name"])
                if key in shifts:
                    model.add(shifts[key] == 0)


def _assignment_region_penalties(
    shifts: Dict,
    employees: List[EmployeeInput],
    slots: List[dict],
    num_days: int,
) -> List:
    penalties = []

    for slot in slots:
        slot_name = slot["name"]
        preferred_regions = set(slot.get("preferred_regions") or [])
        patch_regions = set(slot.get("patch_regions") or [])
        region_penalties = slot.get("region_penalties") or {}
        fallback_penalty = int(slot.get("fallback_penalty", 0))
        patch_penalty = int(slot.get("patch_penalty", fallback_penalty))

        for e_idx, employee in enumerate(employees):
            penalty = int(region_penalties.get(employee.region, 0))
            if employee.region in patch_regions:
                penalty = max(penalty, patch_penalty)
            elif preferred_regions and employee.region not in preferred_regions:
                penalty = max(penalty, fallback_penalty)

            if penalty <= 0:
                continue

            for d in range(num_days):
                key = (e_idx, d, slot_name)
                if key in shifts:
                    penalties.append(shifts[key] * penalty)

    return penalties


def _consecutive_work_penalties(
    model: cp_model.CpModel,
    is_working: Dict,
    num_employees: int,
    num_days: int,
    max_consecutive: int = 6,
    weight: int = 50,
) -> List:
    penalties = []
    for e in range(num_employees):
        for d in range(num_days - max_consecutive):
            v = model.new_bool_var(f"consec_e{e}_d{d}")
            window = [is_working[(e, d + i)] for i in range(max_consecutive + 1)]
            model.add(sum(window) <= max_consecutive + v)
            penalties.append(v * weight)
    return penalties


def _consecutive_off_rewards(
    model: cp_model.CpModel,
    is_working: Dict,
    num_employees: int,
    num_days: int,
    weight: int = 15,
) -> List:
    rewards = []
    for e in range(num_employees):
        for d in range(num_days - 1):
            pair = model.new_bool_var(f"off_pair_e{e}_d{d}")
            model.add(pair <= 1 - is_working[(e, d)])
            model.add(pair <= 1 - is_working[(e, d + 1)])
            rewards.append(pair * weight)
    return rewards


def _fatigue_penalties(
    model: cp_model.CpModel,
    shifts: Dict,
    is_working: Dict,
    employees: List[EmployeeInput],
    fatigue_trajectories: Dict[int, List[float]],
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
    num_days: int,
    fatigue_weight: float = 0.0,
    fatigue_threshold: float = 0.6,
) -> List[cp_model.LinearExpr]:
    """Add fatigue cost for employees working while already elevated.

    For each (employee, day) where fatigue > fatigue_threshold and they are assigned
    to a slot, adds a penalty = (fatigue_score - threshold) * fatigue_weight.
    This discourages the solver from stacking shifts on already-fatigued employees.
    """
    if fatigue_weight <= 0 or not fatigue_trajectories:
        return []

    penalties: List[cp_model.LinearExpr] = []

    for e_idx, emp in enumerate(employees):
        trajectory = fatigue_trajectories.get(emp.employee_id, [])
        for d in range(num_days):
            fatigue_score = trajectory[d] if d < len(trajectory) else 0.0
            if fatigue_score <= fatigue_threshold:
                continue

            # This employee is working today and has elevated fatigue
            # Check if assigned to any slot
            for slot_name, slot_occ in slot_occurrences_by_day[d].items():
                key = (e_idx, d, slot_name)
                if key not in shifts:
                    continue
                # Penalize proportional to how far above threshold
                excess = fatigue_score - fatigue_threshold
                penalty = excess * fatigue_weight * 10  # scale up for CP-SAT integer solver
                penalties.append(shifts[key] * int(penalty))

    return penalties


# ---------------------------------------------------------------------------
# Capacity pre-check
# ---------------------------------------------------------------------------


def validate_capacity(
    inp: ScheduleInput, num_employees: int, shift_slots: List[dict]
) -> bool:
    """Warn if gross or per-shift-type supply is obviously insufficient."""
    max_work_days = inp.num_days - inp.days_off_required
    total_supply = num_employees * max_work_days

    demand_index = _demand_index(inp.shift_demand)
    slot_demand_index = _slot_demand_index(inp.slot_demand)
    total_minimum_demand = 0
    total_ideal_demand = 0
    if inp.slot_demand:
        for point in inp.slot_demand:
            total_minimum_demand += int(point.minimum_headcount or 0)
            total_ideal_demand += int(point.ideal_headcount or 0)
    else:
        for d in range(inp.num_days):
            cur_date = _date_for_offset(inp.start_date, d)
            for stype in ("day", "evening", "night"):
                demand_point = demand_index.get((cur_date, stype))
                if demand_point:
                    total_minimum_demand += int(demand_point.minimum_headcount or 0)
                    total_ideal_demand += int(demand_point.ideal_headcount or 0)

    logger.info(
        "Capacity check: supply=%d minimum_demand=%d ideal_demand=%d",
        total_supply,
        total_minimum_demand,
        total_ideal_demand,
    )
    capacity_ok = True

    if total_minimum_demand > total_supply:
        logger.warning(
            "CAPACITY WARNING: total minimum demand (%d) exceeds supply (%d). "
            "The solver may return INFEASIBLE.",
            total_minimum_demand,
            total_supply,
        )
        capacity_ok = False
    elif total_ideal_demand > total_supply:
        logger.warning(
            "CAPACITY WARNING: total ideal demand (%d) exceeds supply (%d). "
            "The solver can still succeed by missing some ideal coverage.",
            total_ideal_demand,
            total_supply,
        )

    if inp.slot_demand:
        slots_by_name = {slot["name"]: slot for slot in shift_slots}
        for (cur_date, slot_name), demand_point in slot_demand_index.items():
            slot = slots_by_name.get(slot_name)
            if slot is None:
                logger.warning(
                    "CAPACITY WARNING: slot demand references unknown slot %s on %s.",
                    slot_name,
                    cur_date,
                )
                capacity_ok = False
                continue
            eligible_regions = set(slot.get("allowed_regions") or [])
            minimum = int(demand_point.minimum_headcount or 0)
            ideal = int(demand_point.ideal_headcount or 0)
            eligible_employee_count = sum(
                1 for employee in inp.employees if employee.region in eligible_regions
            )
            if minimum > eligible_employee_count:
                logger.warning(
                    "CAPACITY WARNING: %s minimum demand=%d exceeds eligible staff=%d on %s. Allowed regions=%s.",
                    slot_name,
                    minimum,
                    eligible_employee_count,
                    cur_date,
                    sorted(eligible_regions),
                )
                capacity_ok = False
            elif ideal > eligible_employee_count:
                logger.warning(
                    "CAPACITY WARNING: %s ideal demand=%d exceeds eligible staff=%d on %s.",
                    slot_name,
                    ideal,
                    eligible_employee_count,
                    cur_date,
                )
    else:
        eligible_regions_by_type: Dict[str, set[str]] = {}
        for slot in shift_slots:
            eligible_regions_by_type.setdefault(slot["shift_type"], set()).update(
                slot.get("allowed_regions") or []
            )

        for d in range(inp.num_days):
            cur_date = _date_for_offset(inp.start_date, d)
            for shift_type, eligible_regions in eligible_regions_by_type.items():
                demand_point = demand_index.get((cur_date, shift_type))
                minimum = (
                    int(demand_point.minimum_headcount or 0) if demand_point else 0
                )
                ideal = int(demand_point.ideal_headcount or 0) if demand_point else 0
                if ideal <= 0 and minimum <= 0:
                    continue

                eligible_employee_count = sum(
                    1
                    for employee in inp.employees
                    if employee.region in eligible_regions
                )
                if minimum > eligible_employee_count:
                    logger.warning(
                        "CAPACITY WARNING: %s minimum demand=%d exceeds eligible staff=%d on %s. "
                        "Allowed regions=%s.",
                        shift_type,
                        minimum,
                        eligible_employee_count,
                        cur_date,
                        sorted(eligible_regions),
                    )
                    capacity_ok = False
                elif ideal > eligible_employee_count:
                    logger.warning(
                        "CAPACITY WARNING: %s ideal demand=%d exceeds eligible staff=%d on %s. "
                        "Minimum demand can still be feasible.",
                        shift_type,
                        ideal,
                        eligible_employee_count,
                        cur_date,
                    )

    return capacity_ok


# ---------------------------------------------------------------------------
# Pass 1 — canonical slots
# ---------------------------------------------------------------------------


def _run_pass1(
    inp: ScheduleInput,
    canonical_slots: List[dict],
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
    demand_index: Dict[Tuple[date, str], ShiftDemandPoint],
    slot_demand_index: Dict[Tuple[date, str], SlotDemandPoint],
) -> Optional[Tuple]:
    """
    Fill canonical coverage windows to meet minimum demand and reduce ideal shortfall.
    Returns the solved CpSolver if OPTIMAL or FEASIBLE, else None.
    """
    model = cp_model.CpModel()
    n_emp = len(inp.employees)
    slot_names = [s["name"] for s in canonical_slots]

    shifts, is_working = _create_shift_vars(model, n_emp, inp.num_days, slot_names)

    _add_region_eligibility_constraints(
        model, shifts, inp.employees, canonical_slots, inp.num_days
    )
    _add_per_slot_headcount_constraints(
        model, shifts, inp.employees, canonical_slots, inp.num_days
    )
    if inp.slot_demand:
        demand_penalties = _add_slot_demand_constraints(
            model,
            shifts,
            inp.employees,
            canonical_slots,
            slot_demand_index,
            inp.start_date,
            inp.num_days,
        )
    else:
        demand_penalties = _add_demand_constraints(
            model,
            shifts,
            inp.employees,
            canonical_slots,
            demand_index,
            inp.start_date,
            inp.num_days,
        )
    _add_one_slot_per_day(model, shifts, n_emp, inp.num_days, slot_names)
    _add_overlap_constraints(
        model,
        shifts,
        n_emp,
        inp.num_days,
        slot_names,
        slot_occurrences_by_day,
    )
    _add_min_rest_constraints(
        model,
        shifts,
        n_emp,
        inp.num_days,
        slot_names,
        slot_occurrences_by_day,
        inp.min_rest_hours,
    )
    workload_penalties = _add_workload_constraints(
        model,
        is_working,
        shifts,
        inp.employees,
        inp.num_days,
        inp.days_off_required,
        inp.history,
        slot_names,
        slot_occurrences_by_day,
        inp.start_date,
        inp.min_weekly_hours_required,
        inp.overtime_threshold_hours,
    )
    _add_absence_constraints(
        model, is_working, inp.employees, inp.absences, inp.num_days
    )

    fatigue_pt = _fatigue_penalties(
        model,
        shifts,
        is_working,
        inp.employees,
        inp.fatigue_trajectories,
        slot_occurrences_by_day,
        inp.num_days,
        fatigue_weight=inp.fatigue_weight,
        fatigue_threshold=inp.fatigue_threshold,
    )
    penalties = (
        demand_penalties
        + workload_penalties
        + fatigue_pt
        + _fairness_penalties(model, is_working, n_emp, inp.num_days)
        + _consecutive_work_penalties(model, is_working, n_emp, inp.num_days)
        + _assignment_region_penalties(
            shifts, inp.employees, canonical_slots, inp.num_days
        )
    )
    rewards = _preference_scores(
        model, shifts, is_working, inp.employees, inp.preferences
    ) + _consecutive_off_rewards(model, is_working, n_emp, inp.num_days)

    model.minimize(sum(penalties) - sum(rewards))

    solver = cp_model.CpSolver()
    if inp.time_limit_seconds is not None:
        solver.parameters.max_time_in_seconds = inp.time_limit_seconds
    status = solver.solve(model)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        logger.info("Pass 1 solved (status=%s)", solver.status_name(status))
        return solver, shifts, is_working, slot_names
    else:
        logger.error("Pass 1 INFEASIBLE — status=%s", solver.status_name(status))
        return None


# ---------------------------------------------------------------------------
# Pass 2 — non-canonical patching
# ---------------------------------------------------------------------------


def _compute_residual_demand(
    pass1_solver: cp_model.CpSolver,
    pass1_shifts: Dict,
    pass1_slot_names: List[str],
    inp: ScheduleInput,
    demand_index: Dict[Tuple[date, str], ShiftDemandPoint],
    slot_demand_index: Dict[Tuple[date, str], SlotDemandPoint],
    canonical_slots: List[dict],
) -> Dict[Tuple[int, str], Tuple[int, int]]:
    """
    Compute per-(day_offset, shift_type) residual ideal demand not covered by Pass 1.
    Returns {(d, shift_type): (remaining_ideal_headcount, priority_weight)}.
    """
    # Slots by shift_type
    type_by_slot = {s["name"]: s["shift_type"] for s in canonical_slots}
    n_emp = len(inp.employees)

    residual: Dict[Tuple[int, str], Tuple[int, int]] = {}
    if inp.slot_demand:
        for d in range(inp.num_days):
            cur_date = _date_for_offset(inp.start_date, d)
            per_shift_remaining: Dict[str, Tuple[int, int]] = {}
            for slot_name in pass1_slot_names:
                demand_point = slot_demand_index.get((cur_date, slot_name))
                if demand_point is None:
                    continue
                assigned = sum(
                    pass1_solver.value(pass1_shifts[(e, d, slot_name)])
                    for e in range(n_emp)
                    if (e, d, slot_name) in pass1_shifts
                )
                remaining = int(demand_point.ideal_headcount or 0) - assigned
                if remaining <= 0:
                    continue
                shift_type = type_by_slot.get(slot_name)
                if shift_type is None:
                    continue
                previous_remaining, previous_weight = per_shift_remaining.get(
                    shift_type,
                    (0, 1),
                )
                per_shift_remaining[shift_type] = (
                    previous_remaining + remaining,
                    max(previous_weight, int(demand_point.priority_weight or 1)),
                )
            for shift_type, value in per_shift_remaining.items():
                residual[(d, shift_type)] = value
        return residual

    for d in range(inp.num_days):
        cur_date = _date_for_offset(inp.start_date, d)
        for stype in ("day", "evening", "night"):
            demand_point = demand_index.get((cur_date, stype))
            ideal = int(demand_point.ideal_headcount or 0) if demand_point else 0
            priority_weight = (
                int(demand_point.priority_weight or 1) if demand_point else 1
            )
            assigned = sum(
                pass1_solver.value(pass1_shifts[(e, d, slot)])
                for e in range(n_emp)
                for slot in pass1_slot_names
                if type_by_slot.get(slot) == stype and (e, d, slot) in pass1_shifts
            )
            remaining = ideal - assigned
            if remaining > 0:
                residual[(d, stype)] = (remaining, priority_weight)
    return residual


def _run_pass2(
    inp: ScheduleInput,
    all_slots: List[dict],
    canonical_slots: List[dict],
    non_canonical_slots: List[dict],
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
    pass1_solver: cp_model.CpSolver,
    pass1_shifts: Dict,
    pass1_is_working: Dict,
    pass1_slot_names: List[str],
    demand_index: Dict[Tuple[date, str], ShiftDemandPoint],
    slot_demand_index: Dict[Tuple[date, str], SlotDemandPoint],
) -> Optional[Tuple]:
    """
    Patch gaps using non-canonical slots.
    Also respects Pass 1 assignments as fixed warm-start hints.
    Returns (solver, shifts, is_working, all_slot_names) or None.
    """
    if not non_canonical_slots:
        logger.info("No non-canonical slots defined; Pass 2 skipped.")
        return pass1_solver, pass1_shifts, pass1_is_working, pass1_slot_names

    residual = _compute_residual_demand(
        pass1_solver,
        pass1_shifts,
        pass1_slot_names,
        inp,
        demand_index,
        slot_demand_index,
        canonical_slots,
    )

    if not residual:
        logger.info("Pass 1 fully satisfied demand; Pass 2 skipped.")
        return pass1_solver, pass1_shifts, pass1_is_working, pass1_slot_names

    logger.info("Pass 2 patching residual ideal slots: %s", residual)

    model = cp_model.CpModel()
    n_emp = len(inp.employees)
    all_slot_names = [s["name"] for s in all_slots]
    nc_slot_names = [s["name"] for s in non_canonical_slots]

    shifts, is_working = _create_shift_vars(model, n_emp, inp.num_days, all_slot_names)
    _add_region_eligibility_constraints(
        model, shifts, inp.employees, all_slots, inp.num_days
    )

    # Fix Pass 1 assignments
    for e in range(n_emp):
        for d in range(inp.num_days):
            for slot in pass1_slot_names:
                if (e, d, slot) in pass1_shifts and (e, d, slot) in shifts:
                    val = pass1_solver.value(pass1_shifts[(e, d, slot)])
                    model.add(shifts[(e, d, slot)] == val)

    _add_per_slot_headcount_constraints(
        model, shifts, inp.employees, non_canonical_slots, inp.num_days
    )

    # Demand for non-canonical slots: only the residual ideal gap.
    type_by_slot = {s["name"]: s["shift_type"] for s in all_slots}
    demand_penalties: List[cp_model.LinearExpr] = []
    for (d, stype), (remaining, priority_weight) in residual.items():
        nc_assigned = [
            shifts[(e, d, slot)]
            for e in range(n_emp)
            for slot in nc_slot_names
            if type_by_slot.get(slot) == stype and (e, d, slot) in shifts
        ]
        nc_assigned_sum = sum(nc_assigned) if nc_assigned else 0
        if nc_assigned:
            model.add(nc_assigned_sum <= remaining)
        shortfall = model.new_int_var(
            0,
            remaining,
            f"patch_shortfall_{stype}_{d}",
        )
        model.add(shortfall >= remaining - nc_assigned_sum)
        demand_penalties.append(shortfall * priority_weight)

    _add_one_slot_per_day(model, shifts, n_emp, inp.num_days, all_slot_names)
    _add_overlap_constraints(
        model,
        shifts,
        n_emp,
        inp.num_days,
        all_slot_names,
        slot_occurrences_by_day,
    )
    _add_min_rest_constraints(
        model,
        shifts,
        n_emp,
        inp.num_days,
        all_slot_names,
        slot_occurrences_by_day,
        inp.min_rest_hours,
    )
    workload_penalties = _add_workload_constraints(
        model,
        is_working,
        shifts,
        inp.employees,
        inp.num_days,
        inp.days_off_required,
        inp.history,
        all_slot_names,
        slot_occurrences_by_day,
        inp.start_date,
        inp.min_weekly_hours_required,
        inp.overtime_threshold_hours,
    )
    _add_absence_constraints(
        model, is_working, inp.employees, inp.absences, inp.num_days
    )

    fatigue_pt = _fatigue_penalties(
        model,
        shifts,
        is_working,
        inp.employees,
        inp.fatigue_trajectories,
        slot_occurrences_by_day,
        inp.num_days,
        fatigue_weight=inp.fatigue_weight,
        fatigue_threshold=inp.fatigue_threshold,
    )
    penalties = (
        demand_penalties
        + workload_penalties
        + fatigue_pt
        + _fairness_penalties(model, is_working, n_emp, inp.num_days)
        + _consecutive_work_penalties(model, is_working, n_emp, inp.num_days)
        + _assignment_region_penalties(shifts, inp.employees, all_slots, inp.num_days)
    )
    rewards = _preference_scores(
        model, shifts, is_working, inp.employees, inp.preferences
    ) + _consecutive_off_rewards(model, is_working, n_emp, inp.num_days)

    model.minimize(sum(penalties) - sum(rewards))

    solver = cp_model.CpSolver()
    if inp.time_limit_seconds is not None:
        solver.parameters.max_time_in_seconds = inp.time_limit_seconds
    status = solver.solve(model)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        logger.info("Pass 2 solved (status=%s)", solver.status_name(status))
        return solver, shifts, is_working, all_slot_names
    else:
        logger.warning(
            "Pass 2 INFEASIBLE — returning Pass 1 result. Status=%s",
            solver.status_name(status),
        )
        return pass1_solver, pass1_shifts, pass1_is_working, pass1_slot_names


# ---------------------------------------------------------------------------
# Output formatter
# ---------------------------------------------------------------------------


def export_schedule_to_json(
    solver: cp_model.CpSolver,
    shifts: Dict,
    is_working: Dict,
    employees: List[EmployeeInput],
    slot_names: List[str],
    slot_occurrences_by_day: Dict[int, Dict[str, dict]],
    start_date: date,
    num_days: int,
    team_profile_id: str,
    service_timezone: Optional[str],
    fatigue_trajectories: Dict[int, List[float]] = {},
) -> str:
    """Serialize final schedule to JSON string."""
    schedule_data = {
        "metadata": {
            "start_date": start_date.isoformat(),
            "num_days": num_days,
            "num_staff": len(employees),
            "team_profile_id": team_profile_id,
            "service_timezone": service_timezone,
        },
        "staff_schedules": [],
    }

    for e_idx, emp in enumerate(employees):
        emp_schedule = {
            "employee_id": emp.employee_id,
            "employee_name": emp.employee_name,
            "region": emp.region,
            "days": [],
        }

        for d in range(num_days):
            current_date = _date_for_offset(start_date, d)
            day_entry = {
                "date": current_date.isoformat(),
                "is_working": bool(solver.value(is_working[(e_idx, d)])),
                "shift": None,
            }

            # Add per-day fatigue data
            traj = fatigue_trajectories.get(emp.employee_id, [])
            day_entry["fatigue_score"] = round(traj[d], 3) if d < len(traj) else 0.0
            day_entry["cumulative_fatigue"] = round(sum(traj[: d + 1]), 3) if d < len(traj) else 0.0

            if day_entry["is_working"]:
                for slot_name in slot_names:
                    if (e_idx, d, slot_name) in shifts and solver.value(
                        shifts[(e_idx, d, slot_name)]
                    ):
                        info = slot_occurrences_by_day[d][slot_name]
                        utc_start = info["utc_start_at"]
                        utc_end = info["utc_end_at"]

                        # Compute per-employee local times from UTC using the employee's
                        # region timezone (not the service timezone). This ensures that when
                        # the shift is displayed, the local time matches what the employee
                        # actually works in their home timezone.
                        emp_tz = _resolve_zoneinfo(emp.timezone)
                        if emp_tz is not None:
                            start_local = utc_start.astimezone(emp_tz)
                            end_local = utc_end.astimezone(emp_tz)
                            local_start = start_local.strftime("%H:%M")
                            local_end = end_local.strftime("%H:%M")
                        else:
                            local_start = info.get("local_start_time")
                            local_end = info.get("local_end_time")

                        day_entry["shift"] = {
                            "slot_name": slot_name,
                            "shift_type": info["shift_type"],
                            "coverage_label": info.get("coverage_label"),
                            "coverage_role": info.get("coverage_role"),
                            "utc_start": info["utc_start"],
                            "utc_end": info["utc_end"],
                            "utc_start_at": utc_start.isoformat(),
                            "utc_end_at": utc_end.isoformat(),
                            "local_start_time": local_start,
                            "local_end_time": local_end,
                            "canonical": info["canonical"],
                        }
                        break

            emp_schedule["days"].append(day_entry)

        schedule_data["staff_schedules"].append(emp_schedule)

    return json.dumps(schedule_data, indent=2)


# ---------------------------------------------------------------------------
# Print helpers (console / debug)
# ---------------------------------------------------------------------------


def print_schedule(
    solver: cp_model.CpSolver,
    shifts: Dict,
    is_working: Dict,
    employees: List[EmployeeInput],
    slot_names: List[str],
    start_date: date,
    num_days: int,
) -> None:
    # print(
    #     f"\nFinal Schedule: {start_date} to "
    #     f"{_date_for_offset(start_date, num_days - 1)}"
    # )
    header = "Staff".ljust(16) + "".join(
        f"| {_date_for_offset(start_date, d).strftime('%m/%d')} "
        for d in range(num_days)
    )
    # print(header + "\n" + "-" * len(header))

    for e_idx, emp in enumerate(employees):
        row = f"E{emp.employee_id}({emp.region[:2].upper()})".ljust(16)
        for d in range(num_days):
            if solver.value(is_working[(e_idx, d)]) == 0:
                row += "|  ---  "
            else:
                assigned = "???"
                for slot in slot_names:
                    if (e_idx, d, slot) in shifts and solver.value(
                        shifts[(e_idx, d, slot)]
                    ):
                        assigned = slot[:5]
                        break
                row += f"| {assigned:<5} "
        # print(row)

    # print("\nWork Summary:")
    for e_idx, emp in enumerate(employees):
        total = sum(solver.value(is_working[(e_idx, d)]) for d in range(num_days))
        # print(f"  Employee {emp.employee_id} ({emp.region}): {total} days worked")


# ---------------------------------------------------------------------------
# Main solver entry point
# ---------------------------------------------------------------------------


def solve_scheduling(inp: ScheduleInput) -> Optional[str]:
    """
    Run the two-pass CP-SAT solver.

    Returns JSON string of the final schedule, or None if no solution found.
    """
    sys_cfg = load_system_config()
    sys_cfg, requested_profile_id = _merge_inline_team_profile(
        sys_cfg, inp.team_profile_id, inp.team_profile_config
    )
    shift_slots, resolved_profile_id, team_profile = _materialize_shift_slots(
        sys_cfg, requested_profile_id
    )
    profile_rules = team_profile.get("rules") or {}
    effective_inp = replace(
        inp,
        team_profile_id=resolved_profile_id,
        days_off_required=int(
            profile_rules.get("days_off_required", inp.days_off_required)
        ),
        min_rest_hours=int(profile_rules.get("min_rest_hours", inp.min_rest_hours)),
        min_weekly_hours_required=int(
            profile_rules.get(
                "min_weekly_hours_required",
                inp.min_weekly_hours_required,
            )
        ),
        overtime_threshold_hours=int(
            profile_rules.get(
                "overtime_threshold_hours",
                inp.overtime_threshold_hours,
            )
        ),
    )
    service_timezone = team_profile.get("service_timezone") or sys_cfg.get(
        "raw_data_timezone"
    )
    slot_occurrences_by_day = _build_slot_occurrences_by_day(
        shift_slots,
        inp.start_date,
        inp.num_days,
        service_timezone,
    )

    canonical_slots = _slots_for_pass(shift_slots, canonical=True)
    non_canonical_slots = _slots_for_pass(shift_slots, canonical=False)

    if not canonical_slots:
        raise ValueError(
            "No canonical shift slots found in system_config.json. "
            "At least one slot must have 'canonical': true."
        )

    n_emp = len(effective_inp.employees)
    if n_emp == 0:
        raise ValueError("ScheduleInput.employees must not be empty.")

    demand_index = _demand_index(effective_inp.shift_demand)
    slot_demand_index = _slot_demand_index(effective_inp.slot_demand)
    validate_capacity(effective_inp, n_emp, shift_slots)

    # --- Pass 1: canonical slots ---
    result1 = _run_pass1(
        effective_inp,
        canonical_slots,
        slot_occurrences_by_day,
        demand_index,
        slot_demand_index,
    )
    if result1 is None:
        logger.error("Scheduling failed at Pass 1.")
        return None

    solver1, shifts1, is_working1, slot_names1 = result1

    # --- Pass 2: non-canonical patching ---
    result2 = _run_pass2(
        effective_inp,
        all_slots=shift_slots,
        canonical_slots=canonical_slots,
        non_canonical_slots=non_canonical_slots,
        slot_occurrences_by_day=slot_occurrences_by_day,
        pass1_solver=solver1,
        pass1_shifts=shifts1,
        pass1_is_working=is_working1,
        pass1_slot_names=slot_names1,
        demand_index=demand_index,
        slot_demand_index=slot_demand_index,
    )

    if result2 is None:
        logger.error("Scheduling failed at Pass 2.")
        return None

    final_solver, final_shifts, final_is_working, final_slot_names = result2

    # Console output
    # print_schedule(
    #     final_solver,
    #     final_shifts,
    #     final_is_working,
    #     effective_inp.employees,
    #     final_slot_names,
    #     effective_inp.start_date,
    #     effective_inp.num_days,
    # )


    return export_schedule_to_json(
        final_solver,
        final_shifts,
        final_is_working,
        effective_inp.employees,
        final_slot_names,
        slot_occurrences_by_day,
        effective_inp.start_date,
        effective_inp.num_days,
        resolved_profile_id,
        service_timezone,
        fatigue_trajectories=inp.fatigue_trajectories,
    )


# ---------------------------------------------------------------------------
# Convenience entry point for direct execution / testing
# ---------------------------------------------------------------------------


def optimizer(inp: Optional[ScheduleInput] = None) -> Optional[str]:
    """
    Main entry point.

    If `inp` is None, builds a minimal test scenario from system_config.json
    defaults (Canada + Serbia staff, 14-day window, synthetic demand).
    """
    if inp is None:
        sys_cfg = load_system_config()
        regions = sys_cfg.get("regions", {})

        # Build a simple employee list: 9 Canada + 5 Serbia (legacy IDs)
        employees: List[EmployeeInput] = [
            EmployeeInput(employee_id=i, region="Canada") for i in range(9)
        ] + [EmployeeInput(employee_id=i, region="Serbia") for i in range(9, 14)]

        start = date(2026, 3, 1)
        num_days = 14

        # Synthetic demand: weekday 5 day / 2 evening / 3 night, weekend 1/1/1
        shift_demand: List[ShiftDemandPoint] = []
        for offset in range(num_days):
            cur = _date_for_offset(start, offset)
            is_weekend = cur.weekday() >= 5
            shift_demand += [
                ShiftDemandPoint(
                    utc_date=cur,
                    shift_type="day",
                    required_headcount=1 if is_weekend else 5,
                ),
                ShiftDemandPoint(
                    utc_date=cur,
                    shift_type="evening",
                    required_headcount=1 if is_weekend else 2,
                ),
                ShiftDemandPoint(
                    utc_date=cur,
                    shift_type="night",
                    required_headcount=1 if is_weekend else 3,
                ),
            ]

        inp = ScheduleInput(
            start_date=start,
            num_days=num_days,
            employees=employees,
            shift_demand=shift_demand,
            absences=[AbsenceEvent(employee_id=2, day_offset=4)],
            history={e: (1, 1) for e in range(14)},
        )

    result = solve_scheduling(inp)
    if result:
        logger.debug("Schedule JSON length: %d chars", len(result))
    return result


if __name__ == "__main__":
    optimizer()
