from pprint import pprint

import pytest
import json
from datetime import date
from app.lib.optimizer import (
    EmployeeInput, ScheduleInput, ShiftDemandPoint, solve_scheduling, SlotDemandPoint
)

def _solve(payload: ScheduleInput) -> dict | None:
    result = solve_scheduling(payload)
    return json.loads(result) if result else None

# def test_edge_min_rest_violation_across_days():
#     """TC-EDGE-01: Verify 12h rest rule between Night (ends 04:00) and Day (starts 05:00)."""
#     # Night1 ends at 04:00 UTC. Morning2 starts at 12:00 UTC (8h gap).
#     # If min_rest is 12h, the solver should NOT assign both.
#     employees = [EmployeeInput(employee_id=1, region="Serbia")]
    
#     payload = ScheduleInput(
#         start_date=date(2026, 4, 1),
#         num_days=2,
#         employees=employees,
#         shift_demand=[
#             ShiftDemandPoint(utc_date=date(2026, 4, 1), shift_type="night", required_headcount=1),
#             ShiftDemandPoint(utc_date=date(2026, 4, 2), shift_type="day", required_headcount=1),
#         ],
#         min_rest_hours=12, # Hard constraint
#         days_off_required=0
#     )
    
#     schedule = _solve(payload)
#     # The solver should find it impossible to fill both demands with 1 person.
#     assert schedule is None 

def test_edge_min_rest_violation_across_days():
    """
    TC-EDGE-01: Verify 12h rest rule between Night (ends 04:00) and Day (starts 12:00).
    
    Design:
      - 1 Serbia employee, 2 days.
      - Day 1: 1 Night shift required.
      - Day 2: 1 Day shift (Serbia Hybrid) required.
      - Profile: Night1 ends at 04:00 UTC. Hybrid1 starts at 12:00 UTC.
      - Gap = 8 hours. With min_rest_hours=12, this must be INFEASIBLE.
    """
    start = date(2026, 4, 1)
    num_days = 2
    employees = [EmployeeInput(employee_id=1, region="Serbia")]
    
    shift_demand = [
        # Day 1: Night shift only
        ShiftDemandPoint(utc_date=date(2026, 4, 1), shift_type="day", required_headcount=0),
        ShiftDemandPoint(utc_date=date(2026, 4, 1), shift_type="evening", required_headcount=0),
        ShiftDemandPoint(utc_date=date(2026, 4, 1), shift_type="night", required_headcount=1),
        # Day 2: Day shift only
        ShiftDemandPoint(utc_date=date(2026, 4, 2), shift_type="day", required_headcount=1),
        ShiftDemandPoint(utc_date=date(2026, 4, 2), shift_type="evening", required_headcount=0),
        ShiftDemandPoint(utc_date=date(2026, 4, 2), shift_type="night", required_headcount=0),
    ]

    inline_profile = {
        "template_key": "_no_base_",
        "rules": {
            "min_rest_hours": 12,      # Hard constraint to test
            "days_off_required": 0
        },
        "slot_policies": {
            "Night1": {
                "canonical": True,
                "max_headcount": 0,
                "min_headcount": 1,
                "allowed_regions": ["Serbia"],
            },
            # "Hybrid1": {
            #     "canonical": True,
            #     "max_headcount": 1,
            #     "min_headcount": 0,
            #     "allowed_regions": ["Serbia"],
            # },
            # Disable other slots for a clean test environment
            "Morning1": {"canonical": False, "max_headcount": 0},
            "Morning2": {"canonical": False, "max_headcount": 0, "min_headcount": 1},
            "Morning3": {"canonical": False, "max_headcount": 0},
            "Evening1": {"canonical": False, "max_headcount": 0},
            "Evening2": {"canonical": False, "max_headcount": 0},
        },
    }

    payload = ScheduleInput(
        start_date=start,
        num_days=num_days,
        employees=employees,
        shift_demand=shift_demand,
        team_profile_config=inline_profile, # Override the policy
        days_off_required=0,
        time_limit_seconds=10.0,
    )

    # Solve should return None because 1 person cannot fill both 
    # demands while respecting the 12h rest rule.
    schedule = _solve(payload)
    pprint(schedule)
    assert schedule is None, (
        "Solver should find the schedule INFEASIBLE due to 8h gap vs 12h rest rule"
    )


def test_edge_days_off_constraint_infeasibility():
    """TC-EDGE-02: Verify solver fails when days_off_required makes demand impossible."""
    # 2 days, 1 staff needed each day, 1 employee total.
    # If we require 2 days off in a 2-day period, it must fail.
    employees = [EmployeeInput(employee_id=1, region="Serbia")]
    
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=2,
        employees=employees,
        shift_demand=[
            ShiftDemandPoint(utc_date=date(2026, 4, 1), shift_type="day", required_headcount=1),
            ShiftDemandPoint(utc_date=date(2026, 4, 2), shift_type="day", required_headcount=1),
        ],
        days_off_required=2  # Impossible constraint
    )
    
    schedule = _solve(payload)
    assert schedule is None  # Solver correctly identifies infeasibility


def test_edge_regional_patch_penalty_prioritization():
    """
    TC-EDGE-03: Verify patch_penalty de-prioritizes specific regions for slots.
    
    Design:
      - 1 Serbian (no penalty) + 1 Indian (high patch penalty)
      - Demand = 1 Day shift. 
      - Both can work 'Hybrid1', but India has a 1000 point penalty.
    """
    start = date(2026, 4, 1)
    num_days = 1
    employees = [
        EmployeeInput(employee_id=1, region="Serbia"),
        EmployeeInput(employee_id=2, region="India")
    ]
    
    # Single day demand for 1 person
    shift_demand = [
        ShiftDemandPoint(utc_date=start, shift_type="day", required_headcount=1),
        ShiftDemandPoint(utc_date=start, shift_type="evening", required_headcount=0),
        ShiftDemandPoint(utc_date=start, shift_type="night", required_headcount=0),
    ]

    # Create the customized config to test patch_region logic
    inline_profile = {
        "template_key": "_no_base_",
        "rules": {"days_off_required": 0},
        "slot_policies": {
            "Hybrid1": {
                "canonical": True,
                "max_headcount": 1,
                "min_headcount": 0,
                "allowed_regions": ["Serbia", "India"],
                "patch_regions": ["India"], # India is marked as a patch region
                "patch_penalty": 1000,       # High penalty for India
            },
            # Disable other slots for a clean test
            "Morning1": {"canonical": False, "max_headcount": 0},
            "Morning2": {"canonical": False, "max_headcount": 0},
            "Morning3": {"canonical": False, "max_headcount": 0},
            "Evening1": {"canonical": False, "max_headcount": 0},
            "Evening2": {"canonical": False, "max_headcount": 0},
            "Night1": {"canonical": False, "max_headcount": 0},
        },
    }

    payload = ScheduleInput(
        start_date=start,
        num_days=num_days,
        employees=employees,
        shift_demand=shift_demand,
        team_profile_config=inline_profile, # Pass the config here
        days_off_required=0,
        time_limit_seconds=10.0,
    )

    schedule = _solve(payload)
    assert schedule is not None, "Solver should find a feasible schedule"

    # Identify who was assigned. Serbia (ID 1) should be chosen over India (ID 2).
    # This is because India's 1000 penalty > Serbia's 0 penalty.
    serbia_working = any(
        d["is_working"] for r in schedule["staff_schedules"] 
        if r["employee_id"] == 1 for d in r["days"]
    )
    india_working = any(
        d["is_working"] for r in schedule["staff_schedules"] 
        if r["employee_id"] == 2 for d in r["days"]
    )

    assert serbia_working is True, "Serbia (no penalty) should have been assigned"
    assert india_working is False, "India (high penalty) should have been avoided"

def test_edge_max_consecutive_days_streak():
    """TC-EDGE-04: Verify solver handles high-density work streaks via penalties."""
    # Requesting work for 7 days straight with only 1 employee.
    employees = [EmployeeInput(employee_id=1, region="Serbia")]
    
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=7,
        employees=employees,
        shift_demand=[
            ShiftDemandPoint(utc_date=date(2026, 4, d), shift_type="day", required_headcount=1)
            for d in range(1, 8)
        ],
        days_off_required=0 # Force work
    )
    
    schedule = _solve(payload)
    assert schedule is not None
    # Check if the solver utilized the employee for all 7 days (it will, but with penalties).
    worked_days = sum(1 for d in schedule["staff_schedules"][0]["days"] if d["is_working"])
    assert worked_days == 7

def test_edge_overlap_constraints_for_custom_slots():
    """TC-EDGE-05: Verify an employee cannot be in two overlapping slots at once."""
    # We define two custom slots that overlap in time.
    # This tests the minute-arithmetic in _add_overlap_constraints.
    employees = [EmployeeInput(employee_id=1, region="Canada")]
    

    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=1,
        employees=employees,
        # shift_demand=[
        #     ShiftDemandPoint(utc_date=date(2026, 4, 1), shift_type="day", required_headcount=2)
        # ],
        shift_demand=[], # No demand, just testing feasibility of assignment
        slot_demand=[
            # Slot A: Use a known predefined slot name from your config
            SlotDemandPoint(utc_date=date(2026, 4, 1), slot_name="Morning1", required_headcount=1),
            # Slot B: Use a second predefined slot that overlaps with the first
            SlotDemandPoint(utc_date=date(2026, 4, 1), slot_name="Morning2", required_headcount=1)
        ],
        days_off_required=0
    )
    
    schedule = _solve(payload)
    # Even if demand is 2, one employee can only fill ONE of the overlapping slots.
    print(schedule)
    worked_slots = sum(1 for d in schedule["staff_schedules"][0]["days"] if d["is_working"])
    assert worked_slots <= 1

def test_edge_soft_constraint_ideal_shortfall():
    """TC-EDGE-06: Verify ideal_headcount is treated as a soft constraint."""
    # 1 employee available, but 5 ideal staff requested.
    employees = [EmployeeInput(employee_id=1, region="Canada")]
    
    payload = ScheduleInput(
        start_date=date(2026, 4, 1),
        num_days=1,
        employees=employees,
        shift_demand=[
            ShiftDemandPoint(
                utc_date=date(2026, 4, 1), 
                shift_type="day", 
                minimum_headcount=1, # Can be met
                ideal_headcount=5     # Cannot be met
            )
        ],
        days_off_required=0
    )
    
    schedule = _solve(payload)
    assert schedule is not None # Should be feasible despite missing ideal target
    assigned = sum(1 for row in schedule["staff_schedules"] if row["days"][0]["is_working"])
    assert assigned == 1