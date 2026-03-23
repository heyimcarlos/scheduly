"""Optimizer planning service."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any

from app.models.schemas import (
    AbsenceImpactRequest,
    AbsenceImpactResponse,
    CoverageImpactItem,
    CoverageImpactSummary,
    AvailabilityPlanResponse,
    AvailabilitySummary,
    AvailabilityWindowResponse,
    DemandPlanResponse,
    DemandSummary,
    EmergencyRecommendationRequest,
    EmergencyRecommendationResponse,
    PlanningValidationResponse,
    RecommendationSummary,
    ReplacementRecommendationResponse,
    SchedulePlanResponse,
    ScheduleRequest,
    ShiftDemandPoint,
    SlotDemandPoint,
    ValidationIssueResponse,
    ValidationSummary,
)
from app.services.availability import AvailabilityService
from app.services.demand import DemandGenerator
from app.services.recommendations import FatigueAwareRecommendationService
from app.services.validator import ValidatorService
from app.services.shift_writer import ShiftWriter
from app.integrations.supabase import get_supabase_client
from app.lib.optimizer import (
    AbsenceEvent as _AbsenceEvent,
    EmployeeInput as _EmployeeInput,
    ScheduleInput as _ScheduleInput,
    ShiftDemandPoint as _ShiftDemandPoint,
    SlotDemandPoint as _SlotDemandPoint,
    solve_scheduling,
)

_logger = logging.getLogger(__name__)


class OptimizerService:
    """Bridge explicit workload inputs into optimizer-ready requirements."""

    def __init__(self, *, config_path: Path) -> None:
        self.config_path = config_path
        self.demand_generator = DemandGenerator()

    @classmethod
    def from_settings(cls, settings: Any) -> "OptimizerService":
        return cls(config_path=settings.shared_config_path)

    def load_config(self) -> dict[str, Any]:
        with open(self.config_path, encoding="utf-8") as file_handle:
            return json.load(file_handle)

    def _resolved_team_profile(
        self, request: ScheduleRequest
    ) -> tuple[str, dict[str, Any] | None]:
        config = self.load_config()
        inline_profile = (
            request.team_profile_config.model_dump(exclude_none=True)
            if request.team_profile_config
            else None
        )
        active_profile_id = (
            request.team_profile_id
            or (
                request.team_profile_config.template_key
                if request.team_profile_config
                else None
            )
            or config.get("default_team_profile_id")
            or "default"
        )
        return active_profile_id, inline_profile

    @staticmethod
    def _expand_absence_events(
        *,
        start_date: Any,
        num_days: int,
        manual_absences: list[Any] | None,
        absence_events: list[Any] | None,
    ) -> list[dict[str, int]]:
        expanded = [item.model_dump() for item in (manual_absences or [])]
        for event in absence_events or []:
            current = event.start_date
            while current <= event.end_date:
                day_offset = (current - start_date).days
                if 0 <= day_offset < num_days:
                    expanded.append(
                        {
                            "employee_id": event.employee_id,
                            "day_offset": day_offset,
                        }
                    )
                current = current.fromordinal(current.toordinal() + 1)

        deduped: dict[tuple[int, int], dict[str, int]] = {}
        for item in expanded:
            deduped[(int(item["employee_id"]), int(item["day_offset"]))] = {
                "employee_id": int(item["employee_id"]),
                "day_offset": int(item["day_offset"]),
            }
        return list(deduped.values())

    def build_demand_plan(self, request: ScheduleRequest) -> DemandPlanResponse:
        system_config = self.load_config()
        active_profile_id, inline_profile = self._resolved_team_profile(request)

        slot_points: list[Any] = []
        shift_points: list[Any] = []
        notes: list[str] = []

        if request.slot_demand:
            slot_points = self.demand_generator.normalize_slot_demand_rows(
                [item.model_dump() for item in request.slot_demand],
                default_source="manual",
            )
            shift_points = self.demand_generator.aggregate_slot_demand_to_shift_demand(
                slot_points,
                system_config=system_config,
            )
            notes.append("Using caller-supplied slot demand as the source of truth.")
        elif request.shift_demand:
            shift_points = self.demand_generator.normalize_shift_demand_rows(
                [item.model_dump() for item in request.shift_demand],
                default_source="manual",
            )
            notes.append("Using caller-supplied shift demand as the source of truth.")
        elif (
            request.team_profile_config
            and request.team_profile_config.workload_template
        ):
            slot_points = self.demand_generator.expand_workload_template(
                template_rows=[
                    item.model_dump()
                    for item in request.team_profile_config.workload_template
                ],
                start_date=request.start_date,
                num_days=request.num_days,
            )
            shift_points = self.demand_generator.aggregate_slot_demand_to_shift_demand(
                slot_points,
                system_config=system_config,
            )
            notes.append(
                "Expanded team-profile workload template into explicit slot demand."
            )
        else:
            slot_points = self.demand_generator.derive_slot_demand_from_team_profile(
                start_date=request.start_date,
                num_days=request.num_days,
                team_profile_config=inline_profile,
            )
            shift_points = self.demand_generator.aggregate_slot_demand_to_shift_demand(
                slot_points,
                system_config=system_config,
            )
            notes.append(
                "Derived baseline workload from team-profile slot policies; workload forecasting is disabled."
            )

        if not shift_points and not slot_points:
            raise ValueError(
                "Known workload is required. Supply 'slot_demand', 'shift_demand', or a team profile workload template."
            )

        summary = DemandSummary(**self.demand_generator.summarize(shift_points))
        return DemandPlanResponse(
            start_date=request.start_date,
            num_days=request.num_days,
            shift_demand=[
                ShiftDemandPoint(
                    utc_date=point.utc_date,
                    shift_type=point.shift_type,
                    required_headcount=point.required_headcount,
                    minimum_headcount=point.minimum_headcount,
                    ideal_headcount=point.ideal_headcount,
                    priority_weight=point.priority_weight,
                    source=point.source,
                )
                for point in shift_points
            ],
            slot_demand=[
                SlotDemandPoint(
                    utc_date=point.utc_date,
                    slot_name=point.slot_name,
                    required_headcount=point.required_headcount,
                    minimum_headcount=point.minimum_headcount,
                    ideal_headcount=point.ideal_headcount,
                    priority_weight=point.priority_weight,
                    source=point.source,
                )
                for point in slot_points
            ],
            summary=summary,
            notes=notes + [f"Resolved team profile: {active_profile_id}."],
        )

    def build_availability_plan(
        self, request: ScheduleRequest
    ) -> AvailabilityPlanResponse | None:
        if not request.employees:
            return None

        expanded_absences = self._expand_absence_events(
            start_date=request.start_date,
            num_days=request.num_days,
            manual_absences=request.manual_absences,
            absence_events=request.absence_events,
        )
        service = AvailabilityService(system_config=self.load_config())
        windows = service.build_windows(
            employees=[employee.model_dump() for employee in request.employees],
            start_date=request.start_date,
            num_days=request.num_days,
            manual_absences=expanded_absences,
        )
        return AvailabilityPlanResponse(
            start_date=request.start_date,
            num_days=request.num_days,
            windows=[
                AvailabilityWindowResponse(**asdict(window)) for window in windows
            ],
            summary=AvailabilitySummary(**service.summarize(windows)),
            notes=[
                "Employees are modeled as working one local-day shift per day.",
                "UTC windows are derived from each region's IANA timezone with DST-aware conversion.",
            ],
        )

    def build_emergency_recommendations(
        self, request: EmergencyRecommendationRequest
    ) -> EmergencyRecommendationResponse:
        service = FatigueAwareRecommendationService(system_config=self.load_config())
        expanded_absences = self._expand_absence_events(
            start_date=request.start_date,
            num_days=request.num_days,
            manual_absences=request.manual_absences,
            absence_events=request.absence_events,
        )
        recommendations = service.build_recommendations(
            employees=[employee.model_dump() for employee in request.employees],
            start_date=request.start_date,
            num_days=request.num_days,
            absence_event=request.absence_event.model_dump(),
            manual_absences=expanded_absences,
            recent_assignments=[
                item.model_dump() for item in request.recent_assignments
            ],
            top_n=request.top_n,
            prefer_fatigue_model=request.prefer_fatigue_model,
        )
        return EmergencyRecommendationResponse(
            recommendations=[
                ReplacementRecommendationResponse(**asdict(item))
                for item in recommendations
            ],
            summary=RecommendationSummary(**service.summarize(recommendations)),
            notes=[
                "Recommendations are ranked using region fit, overtime impact, and fatigue risk.",
                "Fatigue scores fall back to a heuristic when the model is unavailable or insufficient history is provided.",
            ],
        )

    def build_validation_report(
        self, request: ScheduleRequest
    ) -> PlanningValidationResponse:
        validator = ValidatorService()
        issues = []
        demand_plan = self.build_demand_plan(request)
        issues.extend(validator.validate_demand_points(demand_plan.shift_demand))

        if request.employees:
            windows = AvailabilityService(
                system_config=self.load_config()
            ).build_windows(
                employees=[employee.model_dump() for employee in request.employees],
                start_date=request.start_date,
                num_days=request.num_days,
                manual_absences=self._expand_absence_events(
                    start_date=request.start_date,
                    num_days=request.num_days,
                    manual_absences=request.manual_absences,
                    absence_events=request.absence_events,
                ),
            )
            issues.extend(validator.validate_availability_windows(windows))

        return PlanningValidationResponse(
            issues=[
                ValidationIssueResponse(
                    section=item.section,
                    severity=item.severity,
                    message=item.message,
                )
                for item in issues
            ],
            summary=ValidationSummary(**validator.summarize(issues)),
            notes=[
                "Validation checks explicit workload inputs and availability windows.",
                "Use emergency recommendations to evaluate fatigue-sensitive swap decisions after the initial schedule is generated.",
            ],
        )

    def generate_schedule(self, request: ScheduleRequest) -> SchedulePlanResponse:
        config = self.load_config()
        inline_profile = (
            request.team_profile_config.model_dump(exclude_none=True)
            if request.team_profile_config
            else None
        )
        inline_rules = (
            request.team_profile_config.rules if request.team_profile_config else None
        )
        active_profile_id = (
            request.team_profile_id
            or (
                request.team_profile_config.template_key
                if request.team_profile_config
                else None
            )
            or config.get("default_team_profile_id")
            or "default"
        )
        demand_plan = self.build_demand_plan(request)
        availability_plan = self.build_availability_plan(request)
        expanded_absences = self._expand_absence_events(
            start_date=request.start_date,
            num_days=request.num_days,
            manual_absences=request.manual_absences,
            absence_events=request.absence_events,
        )

        solved_schedule: dict[str, Any] | None = None
        solver_status = "planning_ready"
        warnings: list[str] = []
        notes: list[str] = []

        if request.employees:
            employees_in = [
                _EmployeeInput(
                    employee_id=employee.employee_id,
                    region=employee.region,
                    employee_name=employee.employee_name,
                )
                for employee in request.employees
            ]
            demand_in = [
                _ShiftDemandPoint(
                    utc_date=point.utc_date,
                    shift_type=point.shift_type,
                    required_headcount=point.required_headcount,
                    minimum_headcount=point.minimum_headcount,
                    ideal_headcount=point.ideal_headcount,
                    priority_weight=point.priority_weight,
                    source=point.source,
                )
                for point in demand_plan.shift_demand
            ]
            slot_demand_in = [
                _SlotDemandPoint(
                    utc_date=point.utc_date,
                    slot_name=point.slot_name,
                    required_headcount=point.required_headcount,
                    minimum_headcount=point.minimum_headcount,
                    ideal_headcount=point.ideal_headcount,
                    priority_weight=point.priority_weight,
                    source=point.source,
                )
                for point in demand_plan.slot_demand
            ]
            absences_in = [
                _AbsenceEvent(
                    employee_id=item["employee_id"], day_offset=item["day_offset"]
                )
                for item in expanded_absences
            ]

            schedule_input = _ScheduleInput(
                start_date=request.start_date,
                num_days=request.num_days,
                employees=employees_in,
                shift_demand=demand_in,
                slot_demand=slot_demand_in,
                absences=absences_in,
                days_off_required=inline_rules.days_off_required if inline_rules else 4,
                min_rest_hours=inline_rules.min_rest_hours if inline_rules else 12,
                min_weekly_hours_required=(
                    inline_rules.min_weekly_hours_required if inline_rules else 0
                ),
                overtime_threshold_hours=(
                    inline_rules.overtime_threshold_hours if inline_rules else 40
                ),
                team_profile_id=active_profile_id,
                team_profile_config=inline_profile,
            )
            schedule_json = solve_scheduling(schedule_input)
            if schedule_json:
                solved_schedule = json.loads(schedule_json)
                solver_status = "solved"
                notes = [
                    "CP-SAT two-pass solver completed successfully.",
                    f"Team profile: {active_profile_id}.",
                    "Known workload was provided explicitly; no workload forecasting was used.",
                ]
                # Write shifts to Supabase
                shift_ids = self._write_shifts_to_supabase(solved_schedule, request)
                if shift_ids:
                    notes.append(f"Wrote {len(shift_ids)} shifts to database.")
            else:
                solver_status = "solver_failed"
                warnings.append("CP-SAT solver returned no feasible solution.")
                notes = [
                    f"The solver could not find a feasible schedule for profile {active_profile_id}.",
                    "Check that explicit workload, slot minima, and staffing constraints are simultaneously achievable.",
                ]
        else:
            notes = [
                "No employees provided — skipping CP-SAT solve.",
                "Provide 'employees' in the request body to generate a full schedule.",
            ]

        return SchedulePlanResponse(
            status=solver_status,
            demand=demand_plan,
            availability=availability_plan,
            solved_schedule=solved_schedule,
            warnings=warnings,
            notes=notes,
        )

    def build_absence_impact(
        self, request: AbsenceImpactRequest
    ) -> AbsenceImpactResponse:
        demand_plan = self.build_demand_plan(
            ScheduleRequest(
                start_date=request.start_date,
                num_days=request.num_days,
                manual_absences=request.manual_absences,
                shift_demand=request.shift_demand,
                slot_demand=request.slot_demand,
                employees=request.employees,
                team_profile_id=request.team_profile_id,
                team_profile_config=request.team_profile_config,
            )
        )
        shift_minimums = {
            (item.utc_date.isoformat(), item.shift_type): int(
                item.minimum_headcount or 0
            )
            for item in demand_plan.shift_demand
        }
        slot_minimums = {
            (item.utc_date.isoformat(), item.slot_name): int(
                item.minimum_headcount or 0
            )
            for item in demand_plan.slot_demand
        }
        impacted_assignments = [
            item
            for item in request.current_assignments
            if item.employee_id == request.absence_event.employee_id
            and request.absence_event.start_date
            <= item.start_utc.date()
            <= request.absence_event.end_date
        ]

        impacts: list[CoverageImpactItem] = []
        for assignment in impacted_assignments:
            assignment_date = assignment.start_utc.date().isoformat()
            minimum_required = 0
            if assignment.slot_name is not None:
                minimum_required = slot_minimums.get(
                    (assignment_date, assignment.slot_name), 0
                )
            if minimum_required <= 0:
                minimum_required = shift_minimums.get(
                    (assignment_date, str(assignment.shift_type)), 0
                )

            scheduled_headcount = sum(
                1
                for item in request.current_assignments
                if item.start_utc.date() == assignment.start_utc.date()
                and (
                    (
                        assignment.slot_name is not None
                        and item.slot_name == assignment.slot_name
                    )
                    or (
                        assignment.slot_name is None
                        and str(item.shift_type) == str(assignment.shift_type)
                    )
                )
            )
            remaining_headcount = max(0, scheduled_headcount - 1)
            is_critical_shortage = remaining_headcount < minimum_required
            rationale = (
                f"Replacement required: removing this assignment drops coverage to {remaining_headcount}, below the minimum {minimum_required}."
                if is_critical_shortage
                else f"Replacement optional: coverage remains at {remaining_headcount}, meeting the minimum {minimum_required}."
            )
            impacts.append(
                CoverageImpactItem(
                    utc_date=assignment.start_utc.date(),
                    slot_name=assignment.slot_name,
                    shift_type=str(assignment.shift_type),
                    scheduled_headcount=scheduled_headcount,
                    remaining_headcount=remaining_headcount,
                    minimum_required_headcount=minimum_required,
                    is_critical_shortage=is_critical_shortage,
                    rationale=rationale,
                )
            )

        is_critical = any(item.is_critical_shortage for item in impacts)
        if not impacted_assignments:
            rationale = "The absent employee has no scheduled assignments in the selected absence window, so no coverage action is required."
        elif is_critical:
            rationale = "At least one affected assignment falls below minimum slot coverage, so replacement is required."
        else:
            rationale = "All affected assignments still meet minimum slot coverage after removing the absent employee, so replacement is optional."

        return AbsenceImpactResponse(
            employee_id=request.absence_event.employee_id,
            start_date=request.absence_event.start_date,
            end_date=request.absence_event.end_date,
            is_critical_shortage=is_critical,
            rationale=rationale,
            impacts=impacts,
            summary=CoverageImpactSummary(
                impacted_shift_count=len(impacts),
                critical_shortage_count=sum(
                    int(item.is_critical_shortage) for item in impacts
                ),
                optional_replacement_count=sum(
                    int(not item.is_critical_shortage) for item in impacts
                ),
            ),
            notes=[
                "Coverage impact is evaluated against current assignments and minimum coverage only.",
                "Use recommendations to identify safe replacements when coverage becomes critical or fatigue risk increases.",
            ],
        )

    def _write_shifts_to_supabase(
        self,
        solved_schedule: dict[str, Any],
        request: ScheduleRequest,
    ) -> list[str]:
        """Write solved schedule shifts to Supabase.

        Args:
            solved_schedule: JSON-decoded schedule from CP-SAT solver
            request: Original schedule request with employee data

        Returns:
            List of created shift IDs, or empty list if write failed
        """
        # Build employee_id -> member_id mapping from request
        member_id_map: dict[int, str] = {}
        for emp in request.employees or []:
            if emp.member_id:
                member_id_map[emp.employee_id] = emp.member_id

        if not member_id_map:
            _logger.warning(
                "No member_id mapping found in request. "
                "Shifts will not be written to Supabase. "
                "Ensure EmployeeInput includes member_id (Supabase UUID)."
            )
            return []

        try:
            client = get_supabase_client()
            writer = ShiftWriter(client)

            # Get date range from request
            start_date = request.start_date.isoformat()
            end_date = request.start_date.isoformat()  # Simplified - could calculate end

            # Delete existing shifts for these employees in the date range
            member_ids = list(member_id_map.values())
            writer.delete_shifts_for_date_range(member_ids, start_date, end_date)

            # Write new shifts
            shift_ids = writer.write_schedule(solved_schedule, member_id_map)
            return shift_ids

        except Exception as exc:  # noqa: BLE001
            _logger.error("Failed to write shifts to Supabase: %s", exc)
            return []
