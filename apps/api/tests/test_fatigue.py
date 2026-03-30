"""Tests for FatigueScoringService — heuristic path (no ML model required)."""

from datetime import date, datetime, timezone

import pytest

from app.services.fatigue_scoring import FatigueScoringService, HIGH_FATIGUE_THRESHOLD


def _make_shift(start: datetime, end: datetime, shift_type: str = "day") -> dict:
    return {"employee_id": 1, "start_utc": start, "end_utc": end, "shift_type": shift_type}


def _dt(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


@pytest.fixture
def service():
    return FatigueScoringService(system_config={})


# ---------------------------------------------------------------------------
# TC-FS-01  No shift history → baseline fatigue
# ---------------------------------------------------------------------------

def test_heuristic_no_history_returns_baseline(service):
    score = service._heuristic_fatigue(shifts=[], current_date=date(2026, 3, 10))
    assert score == pytest.approx(0.05)


# ---------------------------------------------------------------------------
# TC-FS-02  Insufficient rest (<12 h) inflates rest penalty
# ---------------------------------------------------------------------------

def test_heuristic_short_rest_raises_score(service):
    # Shift ended only 4 h before current_date midnight → rest_hours ≈ 4
    shift = _make_shift(_dt(2026, 3, 9, 16), _dt(2026, 3, 9, 20))
    score = service._heuristic_fatigue(shifts=[shift], current_date=date(2026, 3, 10))
    # rest_penalty = (12 - 4) / 12 * 0.40 = 0.267, baseline 0.05 → ~0.317
    assert score > HIGH_FATIGUE_THRESHOLD * 0.5
    assert score > 0.25


# ---------------------------------------------------------------------------
# TC-FS-03  Consecutive days worked accumulates penalty
# ---------------------------------------------------------------------------

def test_heuristic_consecutive_days_raises_score(service):
    # 5 consecutive days before 2026-03-10
    shifts = [
        _make_shift(_dt(2026, 3, d, 8), _dt(2026, 3, d, 16)) for d in range(5, 10)
    ]
    score = service._heuristic_fatigue(shifts=shifts, current_date=date(2026, 3, 10))
    # consec=5, penalty = (5-3)/4 * 0.25 = 0.125; rest_hours large (~16h) → no rest penalty
    assert score > 0.15


# ---------------------------------------------------------------------------
# TC-FS-04  Night shifts in last 14 days add night penalty
# ---------------------------------------------------------------------------

def test_heuristic_night_shifts_add_penalty(service):
    night_shifts = [
        _make_shift(_dt(2026, 3, d, 22), _dt(2026, 3, d + 1, 6), shift_type="night")
        for d in range(1, 6)  # 5 night shifts
    ]
    score_night = service._heuristic_fatigue(shifts=night_shifts, current_date=date(2026, 3, 10))

    day_shifts = [
        _make_shift(_dt(2026, 3, d, 8), _dt(2026, 3, d, 16), shift_type="day")
        for d in range(1, 6)
    ]
    score_day = service._heuristic_fatigue(shifts=day_shifts, current_date=date(2026, 3, 10))

    assert score_night > score_day


# ---------------------------------------------------------------------------
# TC-FS-05  score_team_fatigue returns one score per day per employee
# ---------------------------------------------------------------------------

def test_score_team_fatigue_shape(service):
    employees = [
        {"employee_id": 1, "region": "Canada", "employee_name": "Alice"},
        {"employee_id": 2, "region": "Serbia", "employee_name": "Bob"},
    ]
    result = service.score_team_fatigue(
        employees=employees,
        start_date=date(2026, 3, 10),
        num_days=7,
        recent_shifts=[],
        prefer_model=False,
    )
    assert set(result.keys()) == {1, 2}
    assert all(len(scores) == 7 for scores in result.values())


# ---------------------------------------------------------------------------
# TC-FS-06  score_team_fatigue scores are clamped [0, 1]
# ---------------------------------------------------------------------------

def test_score_team_fatigue_scores_clamped(service):
    employees = [{"employee_id": 1, "region": "Canada", "employee_name": "Alice"}]
    # Saturate with many consecutive night shifts
    heavy_shifts = [
        {"employee_id": 1, **_make_shift(_dt(2026, 3, d, 22), _dt(2026, 3, d + 1, 6), "night")}
        for d in range(1, 20)
    ]
    result = service.score_team_fatigue(
        employees=employees,
        start_date=date(2026, 3, 10),
        num_days=3,
        recent_shifts=heavy_shifts,
        prefer_model=False,
    )
    for scores in result.values():
        assert all(0.0 <= s <= 1.0 for s in scores)


# ---------------------------------------------------------------------------
# TC-FS-07  get_fatigue_trajectory_for_employee convenience wrapper
# ---------------------------------------------------------------------------

def test_get_fatigue_trajectory_for_employee_length(service):
    trajectory = service.get_fatigue_trajectory_for_employee(
        employee_id=42,
        shifts=[],
        start_date=date(2026, 3, 10),
        num_days=5,
        prefer_model=False,
    )
    assert len(trajectory) == 5
    assert all(isinstance(s, float) for s in trajectory)
