from datetime import date
from types import SimpleNamespace

from app.services.demand import ShiftDemandPoint
from app.services.validator import ValidatorService


def test_validator_flags_ideal_below_minimum():
    validator = ValidatorService()
    issues = validator.validate_demand_points(
        [
            SimpleNamespace(
                utc_date=date(2026, 3, 10),
                shift_type="day",
                required_headcount=1,
                minimum_headcount=2,
                ideal_headcount=1,
            )
        ]
    )

    assert any(
        issue.section == "demand" and issue.severity == "error" for issue in issues
    )


def test_validator_flags_missing_assignment_candidates():
    validator = ValidatorService()
    issues = validator.validate_assignment_candidates(
        candidates=[],
        demand_points=[
            ShiftDemandPoint(
                utc_date=date(2026, 3, 10),
                shift_type="day",
                minimum_headcount=1,
                ideal_headcount=1,
            )
        ],
    )
    assert any(issue.section == "assignment" for issue in issues)


def test_validator_summary_marks_clean_run_ok():
    validator = ValidatorService()
    summary = validator.summarize([])
    assert summary["ok"] is True
    assert summary["error_count"] == 0
