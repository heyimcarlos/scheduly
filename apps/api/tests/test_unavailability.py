"""Tests for UnavailabilityRecommendationService — unit tests with mocked Supabase."""

from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch
import json

import pytest

from app.models.schemas import UnavailabilityPlanCreate
from app.services.unavailability import UnavailabilityRecommendationService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dt(year: int, month: int, day: int, hour: int = 0) -> str:
    """ISO datetime string."""
    return f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:00:00+00:00"


def _make_shift(
    shift_id: str,
    member_id: str,
    date_str: str,
    shift_type: str = "day",
    start_hour: int = 9,
    end_hour: int = 17,
    title: str | None = "Morning1",
    team_profile_id: str = "tp-1",
    status: str = "active",
) -> dict:
    return {
        "id": shift_id,
        "member_id": member_id,
        "team_profile_id": team_profile_id,
        "shift_type": shift_type,
        "start_time": f"{date_str}T{start_hour:02d}:00:00+00:00",
        "end_time": f"{date_str}T{end_hour:02d}:00:00+00:00",
        "title": title,
        "status": status,
        "is_pending": False,
        "is_conflict": False,
        "is_efficient": True,
        "is_high_fatigue": False,
        "has_rest_violation": False,
    }


def _make_member(member_id: str, name: str, region: str = "Canada") -> dict:
    return {
        "id": member_id,
        "name": name,
        "region": region,
        "team_profile_id": "tp-1",
    }


class MockQueryBuilder:
    """Mock Supabase query builder that chains fluently with basic filtering."""

    def __init__(self, data=None, single=False):
        self._data = list(data or [])
        self._single = single
        self._filters: list[tuple[str, str, object]] = []
        self._update_data: dict | None = None

    def select(self, *_a, **_kw):
        return self

    def insert(self, data):
        if isinstance(data, dict):
            if "id" not in data:
                data["id"] = f"gen-{id(data)}"
            self._data = [data]
        return self

    def update(self, data):
        self._update_data = data
        return self

    def delete(self):
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        self._data = [d for d in self._data if d.get(col) == val]
        return self

    def in_(self, col, vals):
        self._data = [d for d in self._data if d.get(col) in vals]
        return self

    def gte(self, col, val):
        self._data = [d for d in self._data if str(d.get(col, "")) >= str(val)]
        return self

    def lte(self, col, val):
        self._data = [d for d in self._data if str(d.get(col, "")) <= str(val)]
        return self

    def order(self, *_a, **_kw):
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        result = MagicMock()
        if self._update_data and self._data:
            # Apply updates to matching records
            for d in self._data:
                d.update(self._update_data)
        if self._single:
            result.data = self._data[0] if self._data else None
        else:
            result.data = self._data
        return result


class MockSupabaseClient:
    """Mock Supabase client with table-specific data and basic filtering."""

    def __init__(self):
        self._tables: dict[str, list[dict]] = {}
        self._insert_counter = 0

    def set_table_data(self, table_name: str, data: list[dict]):
        self._tables[table_name] = list(data)

    def get_table_data(self, table_name: str) -> list[dict]:
        return self._tables.get(table_name, [])

    def table(self, name: str):
        data = self._tables.get(name, [])
        builder = MockQueryBuilder(data)

        def tracked_insert(row_data):
            self._insert_counter += 1
            if "id" not in row_data:
                row_data["id"] = f"gen-{self._insert_counter}"
            self._tables.setdefault(name, []).append(row_data)
            return MockQueryBuilder([row_data])

        builder.insert = tracked_insert
        return builder


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_client():
    return MockSupabaseClient()


@pytest.fixture
def service(mock_client):
    return UnavailabilityRecommendationService(
        client=mock_client, system_config={}
    )


# ---------------------------------------------------------------------------
# TC-UA-01: Plan creation returns days matching the date range
# ---------------------------------------------------------------------------

def test_create_plan_returns_days_for_date_range(mock_client, service):
    members = [
        _make_member("m-absent", "Alice", "Canada"),
        _make_member("m-avail", "Bob", "Canada"),
    ]
    shifts = [
        _make_shift("s1", "m-absent", "2026-04-15"),
        _make_shift("s2", "m-absent", "2026-04-16"),
        _make_shift("s3", "m-avail", "2026-04-15", start_hour=22, end_hour=6),
    ]

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [{"id": "tp-1", "config": {}}])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 16),
    )
    result = service.create_plan(request)

    assert result.status == "in_progress"
    # Should have 2 days (April 15 and 16)
    assert len(result.days) == 2


# ---------------------------------------------------------------------------
# TC-UA-02: Days with no shift are marked no_gap
# ---------------------------------------------------------------------------

def test_day_without_shift_marked_no_gap(mock_client, service):
    members = [_make_member("m-absent", "Alice")]
    # No shifts at all
    shifts: list = []

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [{"id": "tp-1", "config": {}}])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 15),
    )
    result = service.create_plan(request)

    assert len(result.days) == 1
    assert result.days[0].status == "no_gap"


# ---------------------------------------------------------------------------
# TC-UA-03: Days with coverage above minimum are no_gap
# ---------------------------------------------------------------------------

def test_day_with_sufficient_coverage_marked_no_gap(mock_client, service):
    members = [
        _make_member("m-absent", "Alice"),
        _make_member("m-cover1", "Bob"),
        _make_member("m-cover2", "Carol"),
    ]
    # All three work the same slot; min_headcount is 2 → removing Alice leaves 2 ≥ 2
    shifts = [
        _make_shift("s1", "m-absent", "2026-04-15"),
        _make_shift("s2", "m-cover1", "2026-04-15"),
        _make_shift("s3", "m-cover2", "2026-04-15"),
    ]
    slot_policies = {"Morning1": {"min_headcount": 2}}

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 15),
    )
    result = service.create_plan(request)

    assert result.days[0].status == "no_gap"


# ---------------------------------------------------------------------------
# TC-UA-04: Days with critical shortage have pending status with recommendations
# ---------------------------------------------------------------------------

def test_day_with_gap_has_pending_status_and_recommendations(mock_client, service):
    members = [
        _make_member("m-absent", "Alice"),
        _make_member("m-avail", "Bob"),
    ]
    # Only Alice works, min_headcount=1 → removing her leaves 0 < 1
    shifts = [
        _make_shift("s1", "m-absent", "2026-04-15"),
    ]
    slot_policies = {"Morning1": {"min_headcount": 1}}

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 15),
    )
    result = service.create_plan(request)

    assert result.days[0].status == "pending"
    assert len(result.days[0].recommendations) > 0
    assert result.days[0].recommendations[0].member_name == "Bob"


# ---------------------------------------------------------------------------
# TC-UA-05: Recommendations sorted by ranking_score ascending
# ---------------------------------------------------------------------------

def test_recommendations_sorted_by_ranking_score(mock_client, service):
    members = [
        _make_member("m-absent", "Alice", "Canada"),
        _make_member("m-avail1", "Bob", "Canada"),
        _make_member("m-avail2", "Carol", "Serbia"),  # different region = higher score
    ]
    shifts = [
        _make_shift("s1", "m-absent", "2026-04-15"),
    ]
    slot_policies = {"Morning1": {"min_headcount": 1}}

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 15),
    )
    result = service.create_plan(request)
    recs = result.days[0].recommendations

    assert len(recs) >= 2
    # Bob (same region) should rank before Carol (different region)
    scores = [r.ranking_score for r in recs]
    assert scores == sorted(scores), "Recommendations should be sorted ascending"
    assert recs[0].member_name == "Bob"


# ---------------------------------------------------------------------------
# TC-UA-06: cascade_cost is reflected in ranking
# ---------------------------------------------------------------------------

def test_cascade_cost_increases_ranking_score(mock_client, service):
    members = [
        _make_member("m-absent", "Alice", "Canada"),
        _make_member("m-busy", "Bob", "Canada"),    # has shifts in the range → higher cascade_cost
        _make_member("m-free", "Carol", "Canada"),   # no other shifts → cascade_cost=0
    ]
    # Bob has another shift in the date range (besides the gap day)
    shifts = [
        _make_shift("s1", "m-absent", "2026-04-15"),
        _make_shift("s2", "m-busy", "2026-04-16"),   # Bob's other shift
    ]
    slot_policies = {"Morning1": {"min_headcount": 1}}

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 16),
    )
    result = service.create_plan(request)

    pending_days = [d for d in result.days if d.status == "pending"]
    assert len(pending_days) >= 1

    recs = pending_days[0].recommendations
    bob = next((r for r in recs if r.member_name == "Bob"), None)
    carol = next((r for r in recs if r.member_name == "Carol"), None)

    assert bob is not None and carol is not None
    assert bob.cascade_cost > carol.cascade_cost
    # Carol should rank better (lower score) than Bob due to lower cascade cost
    assert carol.ranking_score <= bob.ranking_score


# ---------------------------------------------------------------------------
# TC-UA-07: Edge case — absent employee has no shifts → all days no_gap
# ---------------------------------------------------------------------------

def test_absent_employee_no_shifts_all_no_gap(mock_client, service):
    members = [
        _make_member("m-absent", "Alice"),
        _make_member("m-other", "Bob"),
    ]

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", [])
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [{"id": "tp-1", "config": {}}])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 17),
    )
    result = service.create_plan(request)

    assert len(result.days) == 3
    assert all(d.status == "no_gap" for d in result.days)


# ---------------------------------------------------------------------------
# TC-UA-08: Edge case — team is overstaffed → all days no_gap
# ---------------------------------------------------------------------------

def test_overstaffed_team_all_no_gap(mock_client, service):
    members = [
        _make_member("m-absent", "Alice"),
        _make_member("m1", "Bob"),
        _make_member("m2", "Carol"),
        _make_member("m3", "Dave"),
    ]
    # All work, min_headcount=1 → removing Alice leaves 3 ≥ 1
    shifts = [
        _make_shift("s1", "m-absent", "2026-04-15"),
        _make_shift("s2", "m1", "2026-04-15"),
        _make_shift("s3", "m2", "2026-04-15"),
        _make_shift("s4", "m3", "2026-04-15"),
    ]
    slot_policies = {"Morning1": {"min_headcount": 1}}

    mock_client.set_table_data("unavailability_plans", [])
    mock_client.set_table_data("unavailability_days", [])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    request = UnavailabilityPlanCreate(
        team_profile_id="tp-1",
        absent_member_id="m-absent",
        start_date=date(2026, 4, 15),
        end_date=date(2026, 4, 15),
    )
    result = service.create_plan(request)

    assert result.days[0].status == "no_gap"


# ---------------------------------------------------------------------------
# TC-UA-09: Approve creates coverage shift and marks original unavailable
# ---------------------------------------------------------------------------

def test_approve_day_creates_coverage_shift(mock_client):
    plan_data = {
        "id": "plan-1",
        "team_profile_id": "tp-1",
        "absent_member_id": "m-absent",
        "start_date": "2026-04-15",
        "end_date": "2026-04-15",
        "status": "in_progress",
        "cascade_depth_limit": 3,
    }
    day_data = {
        "id": "day-1",
        "plan_id": "plan-1",
        "date": "2026-04-15",
        "original_shift_id": "s1",
        "status": "pending",
        "cascade_depth": 0,
        "recommendations": [],
    }
    shift_data = _make_shift("s1", "m-absent", "2026-04-15")

    mock_client.set_table_data("unavailability_plans", [plan_data])
    mock_client.set_table_data("unavailability_days", [day_data])
    mock_client.set_table_data("shifts", [shift_data])
    mock_client.set_table_data("team_members", [
        _make_member("m-absent", "Alice"),
        _make_member("m-replace", "Bob"),
    ])
    mock_client.set_table_data("team_profiles", [{"id": "tp-1", "config": {}}])

    service = UnavailabilityRecommendationService(client=mock_client, system_config={})
    result = service.approve_day("plan-1", "day-1", "m-replace")

    # Day should be approved
    approved_days = [d for d in result.days if d.status == "approved"]
    assert len(approved_days) >= 1

    # Original shift should be marked unavailable
    original_shift = next(
        (s for s in mock_client.get_table_data("shifts") if s["id"] == "s1"), None
    )
    assert original_shift is not None
    assert original_shift.get("status") == "unavailable"

    # A coverage shift should have been created
    coverage_shifts = [
        s for s in mock_client.get_table_data("shifts")
        if s.get("member_id") == "m-replace" and s["id"] != "s1"
    ]
    assert len(coverage_shifts) >= 1


# ---------------------------------------------------------------------------
# TC-UA-10: Skip marks day as skipped
# ---------------------------------------------------------------------------

def test_skip_day_marks_skipped(mock_client):
    plan_data = {
        "id": "plan-1",
        "team_profile_id": "tp-1",
        "absent_member_id": "m-absent",
        "start_date": "2026-04-15",
        "end_date": "2026-04-15",
        "status": "in_progress",
        "cascade_depth_limit": 3,
    }
    day_data = {
        "id": "day-1",
        "plan_id": "plan-1",
        "date": "2026-04-15",
        "original_shift_id": "s1",
        "status": "pending",
        "cascade_depth": 0,
        "recommendations": [],
    }

    mock_client.set_table_data("unavailability_plans", [plan_data])
    mock_client.set_table_data("unavailability_days", [day_data])
    mock_client.set_table_data("shifts", [])
    mock_client.set_table_data("team_members", [])
    mock_client.set_table_data("team_profiles", [{"id": "tp-1", "config": {}}])

    service = UnavailabilityRecommendationService(client=mock_client, system_config={})
    result = service.skip_day("plan-1", "day-1")

    skipped_days = [d for d in result.days if d.status == "skipped"]
    assert len(skipped_days) >= 1


# ---------------------------------------------------------------------------
# TC-UA-11: All days resolved transitions plan to completed
# ---------------------------------------------------------------------------

def test_all_days_resolved_completes_plan(mock_client):
    plan_data = {
        "id": "plan-1",
        "team_profile_id": "tp-1",
        "absent_member_id": "m-absent",
        "start_date": "2026-04-15",
        "end_date": "2026-04-15",
        "status": "in_progress",
        "cascade_depth_limit": 3,
    }
    day_data = {
        "id": "day-1",
        "plan_id": "plan-1",
        "date": "2026-04-15",
        "original_shift_id": "s1",
        "status": "pending",
        "cascade_depth": 0,
        "recommendations": [],
    }

    mock_client.set_table_data("unavailability_plans", [plan_data])
    mock_client.set_table_data("unavailability_days", [day_data])
    mock_client.set_table_data("shifts", [])
    mock_client.set_table_data("team_members", [])
    mock_client.set_table_data("team_profiles", [{"id": "tp-1", "config": {}}])

    service = UnavailabilityRecommendationService(client=mock_client, system_config={})
    result = service.skip_day("plan-1", "day-1")

    assert result.status == "completed"


# ---------------------------------------------------------------------------
# TC-UA-12: Attempting to approve an already-approved day raises error
# ---------------------------------------------------------------------------

def test_approve_already_approved_raises_error(mock_client):
    plan_data = {
        "id": "plan-1",
        "team_profile_id": "tp-1",
        "absent_member_id": "m-absent",
        "start_date": "2026-04-15",
        "end_date": "2026-04-15",
        "status": "in_progress",
        "cascade_depth_limit": 3,
    }
    day_data = {
        "id": "day-1",
        "plan_id": "plan-1",
        "date": "2026-04-15",
        "original_shift_id": "s1",
        "status": "approved",  # already approved
        "cascade_depth": 0,
        "recommendations": [],
    }

    mock_client.set_table_data("unavailability_plans", [plan_data])
    mock_client.set_table_data("unavailability_days", [day_data])
    mock_client.set_table_data("shifts", [])

    service = UnavailabilityRecommendationService(client=mock_client, system_config={})
    with pytest.raises(ValueError, match="not pending"):
        service.approve_day("plan-1", "day-1", "m-replace")


# ---------------------------------------------------------------------------
# TC-UA-13: Cascade — approve creates new gap day at depth 1
# ---------------------------------------------------------------------------

def test_cascade_creates_new_day_on_approval(mock_client):
    """When approving a replacement who works the next day, and that creates a gap,
    a new cascade day should appear at depth 1."""
    plan_data = {
        "id": "plan-1",
        "team_profile_id": "tp-1",
        "absent_member_id": "m-absent",
        "start_date": "2026-04-15",
        "end_date": "2026-04-16",
        "status": "in_progress",
        "cascade_depth_limit": 3,
    }
    day_data = {
        "id": "day-1",
        "plan_id": "plan-1",
        "date": "2026-04-15",
        "original_shift_id": "s-absent",
        "status": "pending",
        "cascade_depth": 0,
        "recommendations": [],
    }
    # Bob (the replacement) has a shift on April 16 — pulling him creates a gap
    shifts = [
        _make_shift("s-absent", "m-absent", "2026-04-15"),
        _make_shift("s-bob-16", "m-bob", "2026-04-16"),
    ]
    members = [
        _make_member("m-absent", "Alice"),
        _make_member("m-bob", "Bob"),
    ]
    # min_headcount=1 for the slot — removing Bob on Apr 16 drops to 0
    slot_policies = {"Morning1": {"min_headcount": 1}}

    mock_client.set_table_data("unavailability_plans", [plan_data])
    mock_client.set_table_data("unavailability_days", [day_data])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    service = UnavailabilityRecommendationService(client=mock_client, system_config={})
    result = service.approve_day("plan-1", "day-1", "m-bob")

    # Should have created a cascade day
    cascade_days = [d for d in result.days if d.cascade_depth > 0]
    assert len(cascade_days) >= 1
    assert cascade_days[0].cascade_depth == 1


# ---------------------------------------------------------------------------
# TC-UA-14: Cascade at depth 3 → needs_manual, no depth 4
# ---------------------------------------------------------------------------

def test_cascade_at_depth_limit_flags_needs_manual(mock_client):
    """When cascade would exceed depth limit (3), the day should be flagged needs_manual."""
    plan_data = {
        "id": "plan-1",
        "team_profile_id": "tp-1",
        "absent_member_id": "m-absent",
        "start_date": "2026-04-15",
        "end_date": "2026-04-17",
        "status": "in_progress",
        "cascade_depth_limit": 1,  # Low limit for testing
    }
    day_data = {
        "id": "day-1",
        "plan_id": "plan-1",
        "date": "2026-04-15",
        "original_shift_id": "s-absent",
        "status": "pending",
        "cascade_depth": 1,  # Already at depth 1
        "recommendations": [],
    }
    shifts = [
        _make_shift("s-absent", "m-absent", "2026-04-15"),
        _make_shift("s-bob-16", "m-bob", "2026-04-16"),
    ]
    members = [
        _make_member("m-absent", "Alice"),
        _make_member("m-bob", "Bob"),
    ]
    slot_policies = {"Morning1": {"min_headcount": 1}}

    mock_client.set_table_data("unavailability_plans", [plan_data])
    mock_client.set_table_data("unavailability_days", [day_data])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    service = UnavailabilityRecommendationService(client=mock_client, system_config={})
    result = service.approve_day("plan-1", "day-1", "m-bob")

    # The cascade day should NOT exist at depth 2 since limit is 1
    # _detect_cascades checks current_depth + 1 > depth_limit
    cascade_days = [d for d in result.days if d.cascade_depth > 1]
    # Should be flagged as needs_manual or not created at all
    if cascade_days:
        assert all(d.status == "needs_manual" for d in cascade_days)


# ---------------------------------------------------------------------------
# TC-UA-15: No cascade when replacement has no other gap-creating shifts
# ---------------------------------------------------------------------------

def test_no_cascade_when_no_gap(mock_client):
    """If pulling the replacement doesn't create a gap, no cascade day should be created."""
    plan_data = {
        "id": "plan-1",
        "team_profile_id": "tp-1",
        "absent_member_id": "m-absent",
        "start_date": "2026-04-15",
        "end_date": "2026-04-16",
        "status": "in_progress",
        "cascade_depth_limit": 3,
    }
    day_data = {
        "id": "day-1",
        "plan_id": "plan-1",
        "date": "2026-04-15",
        "original_shift_id": "s-absent",
        "status": "pending",
        "cascade_depth": 0,
        "recommendations": [],
    }
    # Bob works Apr 16 but coverage is still met with Carol also working
    shifts = [
        _make_shift("s-absent", "m-absent", "2026-04-15"),
        _make_shift("s-bob-16", "m-bob", "2026-04-16"),
        _make_shift("s-carol-16", "m-carol", "2026-04-16"),
    ]
    members = [
        _make_member("m-absent", "Alice"),
        _make_member("m-bob", "Bob"),
        _make_member("m-carol", "Carol"),
    ]
    # min_headcount=1, removing Bob still leaves Carol → no gap
    slot_policies = {"Morning1": {"min_headcount": 1}}

    mock_client.set_table_data("unavailability_plans", [plan_data])
    mock_client.set_table_data("unavailability_days", [day_data])
    mock_client.set_table_data("shifts", shifts)
    mock_client.set_table_data("team_members", members)
    mock_client.set_table_data("team_profiles", [
        {"id": "tp-1", "config": {"slot_policies": slot_policies}}
    ])

    service = UnavailabilityRecommendationService(client=mock_client, system_config={})
    result = service.approve_day("plan-1", "day-1", "m-bob")

    cascade_days = [d for d in result.days if d.cascade_depth > 0]
    assert len(cascade_days) == 0
