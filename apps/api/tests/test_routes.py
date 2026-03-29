from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_transform_demand_endpoint_uses_inline_shift_demand_payload():
    response = client.post(
        "/api/v1/demand/transform",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "shift_demand": [
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "day",
                    "required_headcount": 3,
                },
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "evening",
                    "minimum_headcount": 1,
                    "ideal_headcount": 2,
                    "priority_weight": 4,
                },
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "night",
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["total_slots"] == 3
    assert payload["summary"]["peak_ideal_headcount"] == 3
    assert payload["shift_demand"][1]["minimum_headcount"] == 1
    assert payload["shift_demand"][1]["ideal_headcount"] == 2


def test_transform_demand_endpoint_expands_slot_workload_template():
    response = client.post(
        "/api/v1/demand/transform",
        json={
            "start_date": "2026-03-09",
            "num_days": 2,
            "team_profile_config": {
                "schema_version": 1,
                "template_key": "follow_the_sun_support",
                "service_timezone": "America/Toronto",
                "slot_policies": {},
                "workload_template": [
                    {
                        "day_type": "weekday",
                        "slot_name": "Morning2",
                        "minimum_headcount": 2,
                        "ideal_headcount": 3,
                    }
                ],
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["slot_demand"]) == 2
    assert payload["shift_demand"][0]["shift_type"] == "day"
    assert payload["shift_demand"][0]["minimum_headcount"] == 2
    assert payload["shift_demand"][0]["ideal_headcount"] == 3


def test_availability_plan_endpoint_returns_utc_windows():
    response = client.post(
        "/api/v1/availability/plan",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 1, "region": "Canada"},
                {"employee_id": 2, "region": "India"},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["total_windows"] == 2


# /assignment/primitives endpoint REMOVED - test removed in simplified architecture


def test_emergency_recommendations_endpoint_ranks_candidates():
    response = client.post(
        "/api/v1/emergency/recommendations",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 1, "region": "India"},
                {"employee_id": 2, "region": "India"},
                {"employee_id": 5, "region": "India"},
                {"employee_id": 3, "region": "Serbia"},
                {"employee_id": 4, "region": "Canada"},
            ],
            "absence_event": {"absent_employee_id": 1, "day_offset": 0},
            "recent_assignments": [
                {
                    "employee_id": 2,
                    "start_utc": "2026-03-10T00:00:00Z",
                    "end_utc": "2026-03-10T08:00:00Z",
                    "shift_type": "night",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommendations"][0]["replacement_region"] == "India"
    assert payload["recommendations"][0]["replacement_employee_id"] == 5
    assert all(
        item["replacement_employee_id"] != 2 for item in payload["recommendations"]
    )
    assert "fatigue_score" in payload["recommendations"][0]


def test_absence_impact_endpoint_flags_optional_replacement_when_minimum_met():
    response = client.post(
        "/api/v1/absence/impact",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 1, "region": "India"},
                {"employee_id": 2, "region": "India"},
            ],
            "absence_event": {
                "employee_id": 1,
                "start_date": "2026-03-10",
                "end_date": "2026-03-10",
                "reason": "sick",
            },
            "current_assignments": [
                {
                    "employee_id": 1,
                    "start_utc": "2026-03-10T09:00:00Z",
                    "end_utc": "2026-03-10T17:00:00Z",
                    "shift_type": "day",
                    "slot_name": "Hybrid1",
                },
                {
                    "employee_id": 2,
                    "start_utc": "2026-03-10T09:00:00Z",
                    "end_utc": "2026-03-10T17:00:00Z",
                    "shift_type": "day",
                    "slot_name": "Hybrid1",
                },
            ],
            "slot_demand": [
                {
                    "utc_date": "2026-03-10",
                    "slot_name": "Hybrid1",
                    "minimum_headcount": 1,
                    "ideal_headcount": 1,
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_critical_shortage"] is False
    assert "optional" in payload["rationale"].lower()


def test_generate_schedule_endpoint_expands_absence_events():
    response = client.post(
        "/api/v1/schedule/generate",
        json={
            "start_date": "2026-03-10",
            "num_days": 2,
            "employees": [
                {"employee_id": 1, "region": "Canada"},
            ],
            "shift_demand": [
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "day",
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                },
                {
                    "utc_date": "2026-03-11",
                    "shift_type": "day",
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                },
            ],
            "absence_events": [
                {
                    "employee_id": 1,
                    "start_date": "2026-03-10",
                    "end_date": "2026-03-11",
                    "reason": "sick",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["availability"]["windows"][0]["absent"] is True
    assert payload["availability"]["windows"][1]["absent"] is True


def test_validation_plan_endpoint_returns_summary():
    response = client.post(
        "/api/v1/validation/plan",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "shift_demand": [
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "day",
                    "minimum_headcount": 1,
                    "ideal_headcount": 1,
                },
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "evening",
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                },
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "night",
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "summary" in payload
    assert payload["summary"]["error_count"] == 0
    assert payload["summary"]["warning_count"] == 0


def test_generate_schedule_endpoint_returns_solver_response():
    response = client.post(
        "/api/v1/schedule/generate",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 1, "region": "Canada"},
                {"employee_id": 2, "region": "India"},
            ],
            "shift_demand": [
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "day",
                    "minimum_headcount": 1,
                    "ideal_headcount": 1,
                },
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "evening",
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                },
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "night",
                    "minimum_headcount": 0,
                    "ideal_headcount": 0,
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in ["solved", "planning_ready", "solver_failed"]


def test_generate_schedule_async_creates_job():
    response = client.post(
        "/api/v1/schedule/generate/async",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 1, "region": "Canada"},
            ],
            "shift_demand": [
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "day",
                    "minimum_headcount": 1,
                    "ideal_headcount": 1,
                }
            ],
        },
    )

    assert response.status_code == 202
    assert "job_id" in response.json()


def test_get_schedule_job_returns_job_status():
    create_response = client.post(
        "/api/v1/schedule/generate/async",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 1, "region": "Canada"},
            ],
            "shift_demand": [
                {
                    "utc_date": "2026-03-10",
                    "shift_type": "day",
                    "minimum_headcount": 1,
                    "ideal_headcount": 1,
                }
            ],
        },
    )
    job_id = create_response.json()["job_id"]

    get_response = client.get(f"/api/v1/schedule/job/{job_id}")

    assert get_response.status_code == 200
    assert get_response.json()["status"] in [
        "pending",
        "running",
        "completed",
        "failed",
    ]


def test_config_endpoint_returns_system_configuration():
    response = client.get("/api/v1/config")

    assert response.status_code == 200
    payload = response.json()
    assert "regions" in payload
    assert "shift_types" in payload


def test_health_endpoint_reports_status():
    response = client.get("/api/v1/schedule/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "explicit-workload-product-path"
    assert payload["emergency_recommendations"] == "fatigue-aware-ranking"


# ---------------------------------------------------------------------------
# /fatigue/scores endpoint
# ---------------------------------------------------------------------------


def test_fatigue_scores_endpoint_returns_trajectories_for_employees():
    response = client.post(
        "/api/v1/fatigue/scores",
        json={
            "start_date": "2026-03-10",
            "num_days": 3,
            "employees": [
                {"employee_id": 0, "region": "Canada"},
                {"employee_id": 1, "region": "India"},
            ],
            "recent_assignments": [],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["start_date"] == "2026-03-10"
    assert payload["num_days"] == 3
    assert "0" in payload["fatigue_trajectories"]
    assert "1" in payload["fatigue_trajectories"]
    # Each trajectory should have exactly num_days entries
    assert len(payload["fatigue_trajectories"]["0"]) == 3
    assert len(payload["fatigue_trajectories"]["1"]) == 3
    # Scores must be in [0, 1]
    for emp_id, trajectory in payload["fatigue_trajectories"].items():
        for score in trajectory:
            assert 0.0 <= score <= 1.0


def test_fatigue_scores_endpoint_reflects_rest_hours_in_scores():
    """An employee who just finished a night shift should have higher fatigue
    than one with no recent assignments."""
    response = client.post(
        "/api/v1/fatigue/scores",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 0, "region": "Canada"},
                {"employee_id": 1, "region": "Canada"},
            ],
            "recent_assignments": [
                {
                    "employee_id": 0,
                    # Shift ended just before start_date — minimal rest
                    "start_utc": "2026-03-09T22:00:00Z",
                    "end_utc": "2026-03-10T06:00:00Z",
                    "shift_type": "night",
                },
                # Employee 1 has no recent assignments — should be low fatigue
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    # Employee 0 had <12h rest → higher fatigue; Employee 1 has baseline low fatigue
    assert payload["fatigue_trajectories"]["0"][0] > payload["fatigue_trajectories"]["1"][0]


def test_fatigue_scores_endpoint_consecutive_days_increases_fatigue():
    """Consecutive days worked increase the fatigue score."""
    response = client.post(
        "/api/v1/fatigue/scores",
        json={
            "start_date": "2026-03-10",
            "num_days": 1,
            "employees": [
                {"employee_id": 0, "region": "Canada"},
                {"employee_id": 1, "region": "Canada"},
            ],
            "recent_assignments": [
                # Employee 0: worked 3 consecutive days before start_date
                {
                    "employee_id": 0,
                    "start_utc": "2026-03-07T09:00:00Z",
                    "end_utc": "2026-03-07T17:00:00Z",
                    "shift_type": "day",
                },
                {
                    "employee_id": 0,
                    "start_utc": "2026-03-08T09:00:00Z",
                    "end_utc": "2026-03-08T17:00:00Z",
                    "shift_type": "day",
                },
                {
                    "employee_id": 0,
                    "start_utc": "2026-03-09T09:00:00Z",
                    "end_utc": "2026-03-09T17:00:00Z",
                    "shift_type": "day",
                },
                # Employee 1: no history
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    # Employee with consecutive shifts should have elevated fatigue vs baseline
    assert payload["fatigue_trajectories"]["0"][0] > payload["fatigue_trajectories"]["1"][0]


def test_fatigue_scores_endpoint_empty_employees_returns_empty_trajectories():
    response = client.post(
        "/api/v1/fatigue/scores",
        json={
            "start_date": "2026-03-10",
            "num_days": 3,
            "employees": [],
            "recent_assignments": [],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["fatigue_trajectories"] == {}


def test_fatigue_scores_endpoint_defaults_to_heuristic_without_ml_model():
    """Endpoint should return valid scores even when LSTM model is unavailable."""
    response = client.post(
        "/api/v1/fatigue/scores",
        json={
            "start_date": "2026-03-10",
            "num_days": 7,
            "employees": [
                {"employee_id": 0, "region": "Serbia"},
            ],
            "recent_assignments": [
                {
                    "employee_id": 0,
                    "start_utc": "2026-03-09T09:00:00Z",
                    "end_utc": "2026-03-09T17:00:00Z",
                    "shift_type": "day",
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "0" in payload["fatigue_trajectories"]
    assert len(payload["fatigue_trajectories"]["0"]) == 7
    for score in payload["fatigue_trajectories"]["0"]:
        assert 0.0 <= score <= 1.0
