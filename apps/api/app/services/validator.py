"""Validation helpers for planning artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence


@dataclass(frozen=True)
class ValidationIssue:
    section: str
    severity: str
    message: str


class ValidatorService:
    """Validate planning artifacts before full assignment solving exists."""

    def validate_demand_points(self, points: Sequence[object]) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        for point in points:
            minimum = getattr(point, "minimum_headcount", None)
            ideal = getattr(point, "ideal_headcount", None)
            required = getattr(point, "required_headcount", None)

            if required is not None and required < 0:
                issues.append(
                    ValidationIssue(
                        "demand",
                        "error",
                        f"negative headcount for {point.utc_date} {point.shift_type}",  # type: ignore[attr-defined]
                    )
                )
            if minimum is not None and minimum < 0:
                issues.append(
                    ValidationIssue(
                        "demand",
                        "error",
                        f"negative minimum headcount for {point.utc_date} {point.shift_type}",  # type: ignore[attr-defined]
                    )
                )
            if ideal is not None and minimum is not None and ideal < minimum:
                issues.append(
                    ValidationIssue(
                        "demand",
                        "error",
                        f"ideal headcount is below minimum for {point.utc_date} {point.shift_type}",  # type: ignore[attr-defined]
                    )
                )
        return issues

    def validate_availability_windows(
        self, windows: Sequence[object]
    ) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        seen: set[tuple] = set()
        for window in windows:
            if window.utc_end <= window.utc_start:  # type: ignore[attr-defined]
                issues.append(
                    ValidationIssue(
                        "availability",
                        "error",
                        f"employee {window.employee_id} has a non-positive UTC window",  # type: ignore[attr-defined]
                    )
                )
            key = (window.employee_id, window.local_date)  # type: ignore[attr-defined]
            if key in seen:
                issues.append(
                    ValidationIssue(
                        "availability",
                        "error",
                        f"duplicate availability window for employee {window.employee_id} on {window.local_date}",  # type: ignore[attr-defined]
                    )
                )
            seen.add(key)
        return issues

    def validate_assignment_candidates(
        self,
        candidates: Sequence[object],
        demand_points: Sequence[object],
    ) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        demand_slots = {
            (p.utc_date, p.shift_type)  # type: ignore[attr-defined]
            for p in demand_points
            if max(
                getattr(p, "minimum_headcount", 0) or 0,
                getattr(p, "ideal_headcount", 0) or 0,
            )
            > 0
        }
        candidate_slots = {
            (c.utc_date, c.shift_type)  # type: ignore[attr-defined]
            for c in candidates
        }
        for candidate in candidates:
            if candidate.overtime_hours < 0:  # type: ignore[attr-defined]
                issues.append(
                    ValidationIssue(
                        "assignment",
                        "error",
                        f"negative overtime for employee {candidate.employee_id}",  # type: ignore[attr-defined]
                    )
                )
        for slot in sorted(demand_slots - candidate_slots)[:5]:
            issues.append(
                ValidationIssue(
                    "assignment",
                    "warning",
                    f"no assignment candidates for {slot[0]} {slot[1]}",
                )
            )
        return issues

    def validate_recommendations(
        self, recommendations: Sequence[object]
    ) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        for expected_rank, recommendation in enumerate(recommendations, start=1):
            if recommendation.recommendation_rank != expected_rank:  # type: ignore[attr-defined]
                issues.append(
                    ValidationIssue(
                        "recommendations",
                        "error",
                        "recommendation ranks must be contiguous and start at 1",
                    )
                )
        return issues

    def summarize(self, issues: Iterable[ValidationIssue]) -> dict:
        materialized = list(issues)
        return {
            "ok": not any(issue.severity == "error" for issue in materialized),
            "error_count": sum(
                1 for issue in materialized if issue.severity == "error"
            ),
            "warning_count": sum(
                1 for issue in materialized if issue.severity == "warning"
            ),
        }
