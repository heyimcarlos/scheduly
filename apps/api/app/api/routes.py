"""API route handlers."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.config import Settings, get_settings
from app.models.schemas import (
    AbsenceImpactRequest,
    AbsenceImpactResponse,
    AvailabilityPlanResponse,
    DemandPlanResponse,
    EmergencyRecommendationRequest,
    EmergencyRecommendationResponse,
    LocalToUtcRequest,
    LocalToUtcResponse,
    PlanningValidationResponse,
    ScheduleJobResponse,
    SchedulePlanResponse,
    ScheduleRequest,
    SystemConfig,
)
from app.services.job_store import JobStore, get_job_store
from app.services.optimizer import OptimizerService

router = APIRouter()
_logger = logging.getLogger(__name__)


@router.get("/config", response_model=SystemConfig)
async def get_system_config(settings: Settings = Depends(get_settings)) -> SystemConfig:
    try:
        with open(settings.shared_config_path) as f:
            return SystemConfig(**json.load(f))
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500, detail="System configuration not found"
        ) from exc


@router.post("/demand/transform", response_model=DemandPlanResponse)
async def transform_demand(
    request: ScheduleRequest, settings: Settings = Depends(get_settings)
) -> DemandPlanResponse:
    service = OptimizerService.from_settings(settings)
    return service.build_demand_plan(request)


@router.post("/availability/plan", response_model=AvailabilityPlanResponse)
async def plan_availability(
    request: ScheduleRequest, settings: Settings = Depends(get_settings)
) -> AvailabilityPlanResponse:
    service = OptimizerService.from_settings(settings)
    availability = service.build_availability_plan(request)
    if availability is None:
        raise HTTPException(
            status_code=400,
            detail="employees are required to build an availability plan",
        )
    return availability


@router.post(
    "/emergency/recommendations", response_model=EmergencyRecommendationResponse
)
async def emergency_recommendations(
    request: EmergencyRecommendationRequest, settings: Settings = Depends(get_settings)
) -> EmergencyRecommendationResponse:
    """Build emergency replacement recommendations."""
    service = OptimizerService.from_settings(settings)
    return service.build_emergency_recommendations(request)


@router.post("/absence/impact", response_model=AbsenceImpactResponse)
async def absence_impact(
    request: AbsenceImpactRequest, settings: Settings = Depends(get_settings)
) -> AbsenceImpactResponse:
    """Analyze whether a multi-day absence creates critical coverage shortages."""
    service = OptimizerService.from_settings(settings)
    return service.build_absence_impact(request)


@router.post("/validation/plan", response_model=PlanningValidationResponse)
async def validate_plan(
    request: ScheduleRequest, settings: Settings = Depends(get_settings)
) -> PlanningValidationResponse:
    service = OptimizerService.from_settings(settings)
    return service.build_validation_report(request)


@router.post("/schedule/generate", response_model=SchedulePlanResponse)
async def generate_schedule(
    request: ScheduleRequest, settings: Settings = Depends(get_settings)
) -> SchedulePlanResponse:
    service = OptimizerService.from_settings(settings)
    return service.generate_schedule(request)


# ---------------------------------------------------------------------------
# Async generate endpoints
# ---------------------------------------------------------------------------


def _run_generate_job(
    job_id: str,
    request: ScheduleRequest,
    settings: Settings,
    store: JobStore,
) -> None:
    """Background task: run the solver and update the job store."""
    store.update_job(job_id, status="running")
    try:
        service = OptimizerService.from_settings(settings)
        result = service.generate_schedule(request)
        store.update_job(job_id, status="completed", result=result)
    except Exception as exc:  # noqa: BLE001
        _logger.exception("Async schedule job %s failed", job_id)
        store.update_job(job_id, status="failed", error=str(exc))


@router.post("/schedule/generate/async", status_code=202)
async def generate_schedule_async(
    request: ScheduleRequest,
    background_tasks: BackgroundTasks,
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> dict:
    """
    Start an async schedule generation job.

    Returns `{job_id}` immediately (HTTP 202).
    Poll `GET /schedule/job/{job_id}` every 3 s until status is
    "completed" or "failed".
    """
    job_id = store.create_job()
    background_tasks.add_task(_run_generate_job, job_id, request, settings, store)
    return {"job_id": job_id}


@router.get("/schedule/job/{job_id}", response_model=ScheduleJobResponse)
async def get_schedule_job(
    job_id: str,
    store: JobStore = Depends(get_job_store),
) -> ScheduleJobResponse:
    """Poll the status of an async schedule generation job."""
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return job


@router.get("/schedule/health")
async def check_schedule_health() -> dict:
    return {
        "optimizer": "cp-sat-two-pass-ready",
        "availability": "local-day-shift-ready",
        "assignment_primitives": "removed",
        "emergency_recommendations": "fatigue-aware-ranking",
        "validator": "explicit-workload-validation",
        "ml_bridge": "disabled-for-known-workload",
        "async_jobs": "in-memory-job-store",
        "status": "explicit-workload-product-path",
    }


@router.post("/utils/local-to-utc", response_model=LocalToUtcResponse)
async def local_to_utc(request: LocalToUtcRequest) -> LocalToUtcResponse:
    """
    Convert local HH:mm times to UTC HH:mm given a service timezone.

    Handles both regular overnight shifts (where shifts by the service timezone.
    The `overnight` flag should be set to True when the shift crosses midnight
    in the local timezone (e.g., 21:00-05:00).
    """
    from datetime import datetime, timezone as dt_tz
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        tz = ZoneInfo(request.service_timezone)
    except ZoneInfoNotFoundError:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown timezone: {request.service_timezone}",
        )

    # Use 2026-01-01 as reference date. For overnight shifts the end
    # time is on the next calendar day.
    start_hour, start_min = map(int, request.local_start.split(":"))
    end_hour, end_min = map(int, request.local_end.split(":"))

    start_local = datetime(2026, 1, 1, start_hour, start_min, tzinfo=tz)
    end_local = datetime(
        2026, 1, 1 + (1 if request.overnight else 0),
        end_hour, end_min, tzinfo=tz,
    )

    start_utc = start_local.astimezone(dt_tz.utc)
    end_utc = end_local.astimezone(dt_tz.utc)

    return LocalToUtcResponse(
        utc_start=start_utc.strftime("%H:%M"),
        utc_end=end_utc.strftime("%H:%M"),
    )
