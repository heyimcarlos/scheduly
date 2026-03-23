import json
from datetime import date, datetime, timedelta
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.lib.optimizer import (
    EmployeeInput,
    ScheduleInput,
    ShiftDemandPoint,
    solve_scheduling,
)  # noqa: E402


def _solve_once(*, employees, day=0, evening=0, night=0):
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=1,
        employees=employees,
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="day", required_headcount=day
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1),
                shift_type="evening",
                required_headcount=evening,
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="night", required_headcount=night
            ),
        ],
        team_profile_id="follow_the_sun_support",
        days_off_required=0,
        time_limit_seconds=10.0,
    )
    result = solve_scheduling(payload)
    assert result is not None
    return json.loads(result)


def _solve(payload: ScheduleInput) -> dict | None:
    result = solve_scheduling(payload)
    return json.loads(result) if result else None


def _slot_for_employee(schedule: dict, employee_id: int) -> str | None:
    row = next(
        item
        for item in schedule["staff_schedules"]
        if item["employee_id"] == employee_id
    )
    return row["days"][0]["shift"]["slot_name"] if row["days"][0]["shift"] else None


def _assigned_hours_for_employee(schedule: dict, employee_id: int) -> float:
    row = next(
        item
        for item in schedule["staff_schedules"]
        if item["employee_id"] == employee_id
    )
    total_hours = 0.0
    for day_entry in row["days"]:
        shift = day_entry.get("shift")
        if not shift:
            continue
        start_at = datetime.fromisoformat(shift["utc_start_at"].replace("Z", "+00:00"))
        end_at = datetime.fromisoformat(shift["utc_end_at"].replace("Z", "+00:00"))
        total_hours += (end_at - start_at).total_seconds() / 3600.0
    return total_hours


def test_serbia_employee_uses_hybrid_slot_for_day_coverage():
    schedule = _solve_once(
        employees=[EmployeeInput(employee_id=2, region="Serbia", employee_name="Ana")],
        day=1,
    )

    assert schedule["metadata"]["team_profile_id"] == "follow_the_sun_support"
    assert _slot_for_employee(schedule, 2) == "Hybrid1"


def test_evening_coverage_is_reserved_for_canada():
    schedule = _solve_once(
        employees=[
            EmployeeInput(employee_id=1, region="Canada", employee_name="Alice"),
            EmployeeInput(employee_id=2, region="Serbia", employee_name="Ana"),
        ],
        evening=1,
    )

    assert _slot_for_employee(schedule, 1) == "Evening2"
    assert _slot_for_employee(schedule, 2) is None


def test_overnight_exception_prefers_serbia_over_canada():
    schedule = _solve_once(
        employees=[
            EmployeeInput(employee_id=1, region="Canada", employee_name="Alice"),
            EmployeeInput(employee_id=2, region="Serbia", employee_name="Ana"),
        ],
        night=1,
    )

    shift = next(
        item["days"][0]["shift"]
        for item in schedule["staff_schedules"]
        if item["employee_id"] == 2
    )
    assert shift["slot_name"] == "Night1"
    assert shift["coverage_role"] == "overnight_exception"
    assert _slot_for_employee(schedule, 1) is None


def test_inline_team_profile_config_can_override_slot_policy():
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=1,
        employees=[
            EmployeeInput(employee_id=1, region="Canada", employee_name="Alice"),
            EmployeeInput(employee_id=2, region="Serbia", employee_name="Ana"),
        ],
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="day", required_headcount=0
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="evening", required_headcount=1
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="night", required_headcount=0
            ),
        ],
        team_profile_id="custom_inline_profile",
        team_profile_config={
            "schema_version": 1,
            "template_key": "follow_the_sun_support",
            "service_timezone": "America/Toronto",
            "rules": {
                "min_rest_hours": 12,
                "days_off_required": 0,
                "min_weekly_hours_required": 0,
                "overtime_threshold_hours": 40,
                "enforce_senior_per_shift": True,
            },
            "slot_policies": {
                "Evening2": {
                    "allowed_regions": ["Serbia"],
                    "preferred_regions": ["Serbia"],
                    "canonical": True,
                }
            },
        },
        days_off_required=0,
        time_limit_seconds=10.0,
    )

    schedule = _solve(payload)

    assert schedule is not None
    assert schedule["metadata"]["team_profile_id"] == "custom_inline_profile"
    assert _slot_for_employee(schedule, 2) == "Evening2"
    assert _slot_for_employee(schedule, 1) is None


def test_inline_team_profile_rules_override_solver_constraints():
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=2,
        employees=[EmployeeInput(employee_id=2, region="Serbia", employee_name="Ana")],
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="day", required_headcount=1
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="evening", required_headcount=0
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="night", required_headcount=0
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 2), shift_type="day", required_headcount=1
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 2), shift_type="evening", required_headcount=0
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 2), shift_type="night", required_headcount=0
            ),
        ],
        team_profile_id="inline_rules_profile",
        team_profile_config={
            "schema_version": 1,
            "template_key": "follow_the_sun_support",
            "service_timezone": "America/Toronto",
            "rules": {
                "min_rest_hours": 12,
                "days_off_required": 1,
                "min_weekly_hours_required": 0,
                "overtime_threshold_hours": 40,
                "enforce_senior_per_shift": True,
            },
            "slot_policies": {
                "Hybrid1": {
                    "allowed_regions": ["Serbia"],
                    "preferred_regions": ["Serbia"],
                    "canonical": True,
                }
            },
        },
        days_off_required=0,
        min_rest_hours=0,
        time_limit_seconds=10.0,
    )

    assert _solve(payload) is None


def test_solver_can_miss_ideal_when_minimum_is_feasible():
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=1,
        employees=[EmployeeInput(employee_id=2, region="Serbia", employee_name="Ana")],
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1),
                shift_type="day",
                minimum_headcount=1,
                ideal_headcount=2,
                priority_weight=3,
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1),
                shift_type="evening",
                minimum_headcount=0,
                ideal_headcount=0,
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1),
                shift_type="night",
                minimum_headcount=0,
                ideal_headcount=0,
            ),
        ],
        team_profile_id="follow_the_sun_support",
        days_off_required=0,
        time_limit_seconds=10.0,
    )

    schedule = _solve(payload)

    assert schedule is not None
    assert _slot_for_employee(schedule, 2) == "Hybrid1"


def test_solver_fails_when_minimum_is_unreachable():
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=1,
        employees=[EmployeeInput(employee_id=2, region="Serbia", employee_name="Ana")],
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1),
                shift_type="day",
                minimum_headcount=2,
                ideal_headcount=2,
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1),
                shift_type="evening",
                minimum_headcount=0,
                ideal_headcount=0,
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1),
                shift_type="night",
                minimum_headcount=0,
                ideal_headcount=0,
            ),
        ],
        team_profile_id="follow_the_sun_support",
        days_off_required=0,
        time_limit_seconds=10.0,
    )

    assert _solve(payload) is None


def test_hybrid1_slot_is_capped_at_one_per_day():
    """With max_headcount=1 on Hybrid1, no day should have >1 employee there."""
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=3,
        employees=[
            EmployeeInput(employee_id=1, region="Serbia", employee_name="Ana"),
            EmployeeInput(employee_id=2, region="Serbia", employee_name="Bojan"),
            EmployeeInput(employee_id=3, region="Serbia", employee_name="Cara"),
            EmployeeInput(employee_id=4, region="Serbia", employee_name="Dragan"),
        ],
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, d), shift_type="day", required_headcount=2
            )
            for d in range(1, 4)
        ]
        + [
            ShiftDemandPoint(
                utc_date=date(2026, 4, d), shift_type="evening", required_headcount=0
            )
            for d in range(1, 4)
        ]
        + [
            ShiftDemandPoint(
                utc_date=date(2026, 4, d), shift_type="night", required_headcount=0
            )
            for d in range(1, 4)
        ],
        team_profile_id="follow_the_sun_support",
        days_off_required=0,
        min_rest_hours=0,
        time_limit_seconds=15.0,
    )

    schedule = _solve(payload)
    assert schedule is not None, "Solver should find a feasible schedule"

    num_days = 3
    for d in range(num_days):
        hybrid1_count = sum(
            1
            for row in schedule["staff_schedules"]
            if row["days"][d]["shift"]
            and row["days"][d]["shift"]["slot_name"] == "Hybrid1"
        )
        assert hybrid1_count <= 1, (
            f"Day {d}: {hybrid1_count} employees on Hybrid1, expected <= 1"
        )


def test_all_canonical_slots_filled_each_day():
    """With min_headcount=1 on all canonical slots and sufficient staff, every
    canonical slot (Hybrid1, Morning2, Evening2, Night1) must have >= 1 person
    assigned each day."""
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=1,
        employees=[
            EmployeeInput(employee_id=1, region="Canada", employee_name="Alice"),
            EmployeeInput(employee_id=2, region="Canada", employee_name="Bob"),
            EmployeeInput(employee_id=3, region="Serbia", employee_name="Ana"),
            EmployeeInput(employee_id=4, region="Serbia", employee_name="Bojan"),
        ],
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="day", required_headcount=2
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="evening", required_headcount=1
            ),
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), shift_type="night", required_headcount=0
            ),
        ],
        team_profile_id="follow_the_sun_support",
        days_off_required=0,
        time_limit_seconds=15.0,
    )

    schedule = _solve(payload)
    assert schedule is not None, "Solver should find a feasible schedule"

    for slot_name in ("Hybrid1", "Morning2", "Evening2", "Night1"):
        count = sum(
            1
            for row in schedule["staff_schedules"]
            if row["days"][0]["shift"]
            and row["days"][0]["shift"]["slot_name"] == slot_name
        )
        assert count >= 1, f"Canonical slot {slot_name} has 0 assignments on day 0"


def test_india_employees_meet_minimum_weekly_hours():
    """
    With min_weekly_hours_required=40 in the team profile rules, India employees
    must be assigned at least round(14*40/7)=80 hours over a 14-day window,
    even though their only available slot carries a high patch_penalty (500).

    Design:
      - 3 Serbia + 1 India, 14 days, days_off_required=0 (ceiling=14)
      - day demand=3 (Serbia can cover alone), evening=0, night=0
      - Inline profile (_no_base_): Hybrid1 allows Serbia+India (India patch_penalty=500,
        canonical=True), Morning2 allows Serbia only (canonical=True)
      - Without floor: India gets 0 hours (patch_penalty >> shortfall cost)
      - With floor (min_weekly_hours_required=40): India forced into enough Hybrid1 shifts
      - Feasibility: 10 working days x 8h = 80h over the 14-day window
    """
    start = date(2026, 4, 1)
    num_days = 14
    employees = [
        EmployeeInput(employee_id=1, region="Serbia"),
        EmployeeInput(employee_id=2, region="Serbia"),
        EmployeeInput(employee_id=3, region="Serbia"),
        EmployeeInput(employee_id=4, region="India"),
    ]
    shift_demand = []
    from datetime import timedelta

    for d in range(num_days):
        dt = start + timedelta(days=d)
        shift_demand.append(
            ShiftDemandPoint(utc_date=dt, shift_type="day", required_headcount=3)
        )
        shift_demand.append(
            ShiftDemandPoint(utc_date=dt, shift_type="evening", required_headcount=0)
        )
        shift_demand.append(
            ShiftDemandPoint(utc_date=dt, shift_type="night", required_headcount=0)
        )

    inline_profile = {
        "template_key": "_no_base_",
        "rules": {"min_weekly_hours_required": 40, "days_off_required": 0},
        "slot_policies": {
            "Hybrid1": {
                "canonical": True,
                "max_headcount": 4,
                "min_headcount": 0,
                "allowed_regions": ["Serbia", "India"],
                "patch_regions": ["India"],
                "patch_penalty": 500,
            },
            "Morning1": {"canonical": False, "max_headcount": 0},
            "Morning2": {
                "canonical": True,
                "max_headcount": 4,
                "min_headcount": 0,
                "allowed_regions": ["Serbia"],
            },
            "Morning3": {"canonical": False, "max_headcount": 0},
            "Evening1": {"canonical": False, "max_headcount": 0},
            "Evening2": {"canonical": True, "max_headcount": 0, "min_headcount": 0},
            "Night1": {"canonical": True, "max_headcount": 0, "min_headcount": 0},
        },
    }

    payload = ScheduleInput(
        start_date=start,
        num_days=num_days,
        employees=employees,
        shift_demand=shift_demand,
        team_profile_config=inline_profile,
        days_off_required=0,
        time_limit_seconds=30.0,
    )

    schedule = _solve(payload)
    assert schedule is not None, (
        "Solver should find a feasible schedule with floor constraint"
    )

    # Count India's assigned hours
    india_row = next(
        (r for r in schedule["staff_schedules"] if r["employee_id"] == 4), None
    )
    assert india_row is not None, "India employee (id=4) must appear in schedule"

    india_assigned_hours = _assigned_hours_for_employee(schedule, 4)
    expected_min = round(num_days * 40 / 7)  # = 80
    assert india_assigned_hours >= expected_min, (
        f"India employee worked {india_assigned_hours} hours but expected >= {expected_min} "
        f"(min_weekly_hours_required=40 over {num_days} days)"
    )


def test_production_scenario_ten_employees_feasible():
    """Regression test for the production payload that previously returned no feasible
    solution due to a hard upper cap on assigned_sum in _add_demand_constraints.

    10 employees (4 Serbia, 5 Canada, 1 India), num_days=14,
    min_weekly_hours_required=40, days_off_required=4.
    Demand: 'day' minimum=6 on weekdays / 1 on weekends; 'evening' minimum=1 every day.

    Expected:
      - solver returns a non-None schedule
      - every employee works >= 80 hours [floor = round(14 * 40/7) = 80]
      - every employee works <= 80 hours because days_off_required=4 leaves exactly 10x8h
    """
    num_days = 14
    days_off = 4
    start = date(2026, 1, 5)  # Monday — weekday pattern is fully predictable

    employees = (
        [EmployeeInput(employee_id=i, region="Serbia") for i in range(1, 5)]
        + [EmployeeInput(employee_id=i, region="Canada") for i in range(5, 10)]
        + [EmployeeInput(employee_id=10, region="India")]
    )

    shift_demand = []
    for d in range(num_days):
        dt = start + timedelta(days=d)
        is_weekday = dt.weekday() < 5
        day_min = 6 if is_weekday else 1
        shift_demand += [
            ShiftDemandPoint(
                utc_date=dt,
                shift_type="day",
                minimum_headcount=day_min,
                ideal_headcount=day_min,
                required_headcount=0,
            ),
            ShiftDemandPoint(
                utc_date=dt,
                shift_type="evening",
                minimum_headcount=1,
                ideal_headcount=1,
                required_headcount=0,
            ),
            ShiftDemandPoint(
                utc_date=dt,
                shift_type="night",
                minimum_headcount=0,
                ideal_headcount=0,
                required_headcount=0,
            ),
        ]

    payload = ScheduleInput(
        start_date=start,
        num_days=num_days,
        employees=employees,
        shift_demand=shift_demand,
        team_profile_id="follow_the_sun_support",
        min_weekly_hours_required=40,
        overtime_threshold_hours=40,
        days_off_required=days_off,
        time_limit_seconds=30.0,
    )

    schedule = _solve(payload)
    assert schedule is not None, (
        "Solver must find a feasible schedule for the production scenario "
        "(10 employees, num_days=14, min_weekly_hours_required=40)"
    )

    floor = round(num_days * 40 / 7)  # 80
    ceiling = (num_days - days_off) * 8  # 80 with 8h slots

    for row in schedule["staff_schedules"]:
        emp_id = row["employee_id"]
        assigned_hours = _assigned_hours_for_employee(schedule, emp_id)
        assert assigned_hours >= floor, (
            f"Employee {emp_id} worked {assigned_hours} hours but floor is {floor}"
        )
        assert assigned_hours <= ceiling, (
            f"Employee {emp_id} worked {assigned_hours} hours but ceiling is {ceiling}"
        )
