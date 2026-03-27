"""Pydantic models for backend planning contracts."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ShiftType(BaseModel):
    name: str
    local_start_min: int
    local_start_max: int


class ShiftSlotConfig(BaseModel):
    name: str
    shift_type: Literal["day", "evening", "night"] | str
    local_start_time: str
    local_end_time: str
    utc_start: str
    utc_end: str
    canonical: bool


class SlotPolicyConfig(BaseModel):
    coverage_label: Optional[str] = None
    coverage_role: Optional[str] = None
    allowed_regions: List[str] = Field(default_factory=list)
    preferred_regions: List[str] = Field(default_factory=list)
    patch_regions: List[str] = Field(default_factory=list)
    fallback_penalty: int = 0
    patch_penalty: int = 0
    region_penalties: Dict[str, int] = Field(default_factory=dict)
    canonical: Optional[bool] = None
    min_headcount: int = Field(default=0, ge=0)
    max_headcount: Optional[int] = Field(default=None, ge=1)


class TeamProfileRuleConfig(BaseModel):
    min_rest_hours: int = Field(default=12, ge=0)
    days_off_required: int = Field(default=4, ge=0)
    min_weekly_hours_required: int = Field(default=40, ge=0)
    overtime_threshold_hours: int = Field(default=40, ge=1)
    enforce_senior_per_shift: bool = True


class TeamProfileAnswersConfig(BaseModel):
    regions: Dict[str, str] = Field(default_factory=dict)


class DemandOverridePoint(BaseModel):
    minimum: int = Field(ge=0)
    ideal: int = Field(ge=0)

    @model_validator(mode="after")
    def ideal_gte_minimum(self) -> "DemandOverridePoint":
        if self.ideal < self.minimum:
            self.ideal = self.minimum
        return self


class DemandOverrideGroup(BaseModel):
    day: Optional[DemandOverridePoint] = None
    evening: Optional[DemandOverridePoint] = None
    night: Optional[DemandOverridePoint] = None


class DemandOverrides(BaseModel):
    weekday: Optional[DemandOverrideGroup] = None
    weekend: Optional[DemandOverrideGroup] = None


class SlotDemandTemplatePoint(BaseModel):
    day_type: Literal["weekday", "weekend", "all"] = "all"
    slot_name: str
    required_headcount: Optional[int] = Field(default=None, ge=0)
    minimum_headcount: Optional[int] = Field(default=None, ge=0)
    ideal_headcount: Optional[int] = Field(default=None, ge=0)
    priority_weight: int = Field(default=1, ge=1)
    source: Literal["template", "manual"] | str = "template"

    @model_validator(mode="after")
    def normalize_headcount_range(self) -> "SlotDemandTemplatePoint":
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

        minimum = max(0, int(minimum or 0))
        ideal = max(minimum, int(ideal or 0))
        self.minimum_headcount = minimum
        self.ideal_headcount = ideal
        self.required_headcount = ideal
        self.priority_weight = max(1, int(self.priority_weight or 1))
        return self


class TeamProfileConfig(BaseModel):
    schema_version: int = 1
    template_key: Optional[str] = None
    name: Optional[str] = None
    service_timezone: str
    description: Optional[str] = None
    rules: Optional[TeamProfileRuleConfig] = None
    slot_policies: Dict[str, SlotPolicyConfig] = Field(default_factory=dict)
    answers: Optional[TeamProfileAnswersConfig] = None
    demand_overrides: Optional[DemandOverrides] = None
    workload_template: List[SlotDemandTemplatePoint] = Field(default_factory=list)


class DSTConfig(BaseModel):
    utc_offset_dst: float
    dst_start: Dict[str, Any]
    dst_end: Dict[str, Any]


class RegionConfig(BaseModel):
    prefix: str
    timezone: str
    utc_offset_standard: float
    dst: Optional[DSTConfig] = None


class SystemConfig(BaseModel):
    raw_data_timezone: str
    raw_data_utc_offset: float
    default_team_profile_id: Optional[str] = None
    regions: Dict[str, RegionConfig]
    shift_types: List[ShiftType]
    shift_slots: List[ShiftSlotConfig]
    team_profiles: Dict[str, TeamProfileConfig] = Field(default_factory=dict)


class ManualAbsence(BaseModel):
    employee_id: int
    day_offset: int = Field(ge=0)


class EmployeeInput(BaseModel):
    employee_id: int
    member_id: Optional[str] = None  # Supabase UUID, required for shift writes
    region: str
    employee_name: Optional[str] = None


class ShiftDemandPoint(BaseModel):
    utc_date: date
    shift_type: Literal["day", "evening", "night"]
    required_headcount: Optional[int] = Field(default=None, ge=0)
    minimum_headcount: Optional[int] = Field(default=None, ge=0)
    ideal_headcount: Optional[int] = Field(default=None, ge=0)
    priority_weight: int = Field(default=1, ge=1)
    source: Literal["forecast", "historical", "manual"] | str = "forecast"

    @model_validator(mode="after")
    def normalize_headcount_range(self) -> "ShiftDemandPoint":
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

        minimum = max(0, int(minimum or 0))
        ideal = max(minimum, int(ideal or 0))

        self.minimum_headcount = minimum
        self.ideal_headcount = ideal
        self.required_headcount = ideal
        self.priority_weight = max(1, int(self.priority_weight or 1))
        return self


class SlotDemandPoint(BaseModel):
    utc_date: date
    slot_name: str
    required_headcount: Optional[int] = Field(default=None, ge=0)
    minimum_headcount: Optional[int] = Field(default=None, ge=0)
    ideal_headcount: Optional[int] = Field(default=None, ge=0)
    priority_weight: int = Field(default=1, ge=1)
    source: Literal["template", "manual", "derived"] | str = "manual"

    @model_validator(mode="after")
    def normalize_headcount_range(self) -> "SlotDemandPoint":
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

        minimum = max(0, int(minimum or 0))
        ideal = max(minimum, int(ideal or 0))
        self.minimum_headcount = minimum
        self.ideal_headcount = ideal
        self.required_headcount = ideal
        self.priority_weight = max(1, int(self.priority_weight or 1))
        return self


class DemandSummary(BaseModel):
    total_slots: int
    total_minimum_headcount: int
    total_ideal_headcount: int
    peak_minimum_headcount: int
    peak_ideal_headcount: int
    total_required_headcount: int
    peak_required_headcount: int
    start_utc_date: Optional[date] = None
    end_utc_date: Optional[date] = None


class AvailabilityWindowResponse(BaseModel):
    employee_id: int
    employee_name: Optional[str] = None
    region: str
    local_date: date
    utc_start: datetime
    utc_end: datetime
    local_start_hour: float
    local_end_hour: float
    shift_type: str
    absent: bool = False


class AvailabilitySummary(BaseModel):
    total_windows: int
    absent_windows: int
    by_region: Dict[str, int]


class AvailabilityPlanResponse(BaseModel):
    start_date: date
    num_days: int
    windows: List[AvailabilityWindowResponse]
    summary: AvailabilitySummary
    notes: List[str] = Field(default_factory=list)


class AssignmentCandidateResponse(BaseModel):
    utc_date: date
    shift_type: str
    employee_id: int
    employee_name: Optional[str] = None
    region: str
    source_window_start_utc: datetime
    source_window_end_utc: datetime
    overtime_hours: float
    natural_coverage: bool


class AssignmentSummary(BaseModel):
    total_candidates: int
    natural_candidates: int
    overtime_candidates: int
    candidate_count_by_slot: Dict[str, int]


class AssignmentPlanResponse(BaseModel):
    candidates: List[AssignmentCandidateResponse]
    summary: AssignmentSummary
    notes: List[str] = Field(default_factory=list)


class AbsenceEvent(BaseModel):
    absent_employee_id: int
    day_offset: int = Field(ge=0)


class AbsenceEventWindow(BaseModel):
    employee_id: int
    start_date: date
    end_date: date
    reason: Literal["sick", "vacation", "personal", "unavailable", "other"] | str = (
        "other"
    )

    @model_validator(mode="after")
    def validate_window(self) -> "AbsenceEventWindow":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class HistoricalShiftAssignment(BaseModel):
    employee_id: int
    start_utc: datetime
    end_utc: datetime
    shift_type: Literal["day", "evening", "night"] | str
    slot_name: Optional[str] = None


class ReplacementRecommendationResponse(BaseModel):
    absent_employee_id: int
    replacement_employee_id: int
    replacement_employee_name: Optional[str] = None
    absent_region: str
    replacement_region: str
    day_offset: int
    utc_start: datetime
    utc_end: datetime
    overtime_hours: float
    region_priority: int
    recommendation_rank: int
    ranking_score: float
    fatigue_score: float
    fatigue_source: Literal["heuristic", "model"] | str = "heuristic"
    rest_hours_since_last_shift: Optional[float] = None
    consecutive_days_worked: int = 0
    rationale: str


class RecommendationSummary(BaseModel):
    total_recommendations: int
    best_overtime_hours: Optional[float] = None
    best_fatigue_score: Optional[float] = None
    regions_present: List[str]


class CoverageImpactItem(BaseModel):
    utc_date: date
    slot_name: Optional[str] = None
    shift_type: str
    scheduled_headcount: int
    remaining_headcount: int
    minimum_required_headcount: int
    is_critical_shortage: bool
    rationale: str


class CoverageImpactSummary(BaseModel):
    impacted_shift_count: int
    critical_shortage_count: int
    optional_replacement_count: int


class AbsenceImpactResponse(BaseModel):
    employee_id: int
    start_date: date
    end_date: date
    is_critical_shortage: bool
    rationale: str
    impacts: List[CoverageImpactItem]
    summary: CoverageImpactSummary
    notes: List[str] = Field(default_factory=list)


class AbsenceImpactRequest(BaseModel):
    start_date: date
    num_days: int = Field(default=14, ge=1, le=92)
    employees: List[EmployeeInput]
    absence_event: AbsenceEventWindow
    current_assignments: List[HistoricalShiftAssignment] = Field(default_factory=list)
    manual_absences: Optional[List[ManualAbsence]] = None
    shift_demand: Optional[List[ShiftDemandPoint]] = None
    slot_demand: Optional[List[SlotDemandPoint]] = None
    team_profile_id: Optional[str] = None
    team_profile_config: Optional[TeamProfileConfig] = None


class EmergencyRecommendationRequest(BaseModel):
    start_date: date
    num_days: int = Field(default=14, ge=1, le=90)
    employees: List[EmployeeInput]
    manual_absences: Optional[List[ManualAbsence]] = None
    absence_event: AbsenceEvent
    absence_events: List[AbsenceEventWindow] = Field(default_factory=list)
    recent_assignments: List[HistoricalShiftAssignment] = Field(default_factory=list)
    top_n: int = Field(default=5, ge=1, le=20)
    prefer_fatigue_model: bool = False


class EmergencyRecommendationResponse(BaseModel):
    recommendations: List[ReplacementRecommendationResponse]
    summary: RecommendationSummary
    notes: List[str] = Field(default_factory=list)


class ValidationIssueResponse(BaseModel):
    section: str
    severity: str
    message: str


class ValidationSummary(BaseModel):
    ok: bool
    error_count: int
    warning_count: int


class PlanningValidationResponse(BaseModel):
    issues: List[ValidationIssueResponse]
    summary: ValidationSummary
    notes: List[str] = Field(default_factory=list)


class ScheduleRequest(BaseModel):
    start_date: date
    num_days: int = Field(default=14, ge=1, le=92)
    manual_absences: Optional[List[ManualAbsence]] = None
    absence_events: List[AbsenceEventWindow] = Field(default_factory=list)
    shift_demand: Optional[List[ShiftDemandPoint]] = None
    slot_demand: Optional[List[SlotDemandPoint]] = None
    employees: Optional[List[EmployeeInput]] = None
    team_profile_id: Optional[str] = None
    team_profile_config: Optional[TeamProfileConfig] = None


class DemandPlanResponse(BaseModel):
    start_date: date
    num_days: int
    shift_demand: List[ShiftDemandPoint]
    slot_demand: List[SlotDemandPoint] = Field(default_factory=list)
    summary: DemandSummary
    notes: List[str] = Field(default_factory=list)


class SchedulePlanResponse(BaseModel):
    status: Literal["planning_ready", "solved", "solver_failed"]
    demand: DemandPlanResponse
    availability: Optional[AvailabilityPlanResponse] = None
    solved_schedule: Optional[Dict[str, Any]] = None
    warnings: List[str] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)


class ScheduleJobStatus(BaseModel):
    """Status enum values for an async schedule job."""

    PENDING: str = "pending"
    RUNNING: str = "running"
    COMPLETED: str = "completed"
    FAILED: str = "failed"


class ScheduleJobResponse(BaseModel):
    """Response model for async schedule job polling."""

    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    result: Optional[SchedulePlanResponse] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
