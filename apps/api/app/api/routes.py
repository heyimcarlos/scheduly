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
    FatigueScoresRequest,
    FatigueScoresResponse,
    ParseNoteRequest,
    ParseNoteResponse,
    PlanningValidationResponse,
    ScheduleJobResponse,
    SchedulePlanResponse,
    ScheduleRequest,
    SystemConfig,
)
from app.services.fatigue_scoring import FatigueScoringService
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


@router.post("/fatigue/scores", response_model=FatigueScoresResponse)
async def compute_fatigue_scores(
    request: FatigueScoresRequest,
    settings: Settings = Depends(get_settings),
) -> FatigueScoresResponse:
    """Compute per-employee fatigue trajectories for the scheduling window.

    This endpoint runs the LSTM model (or heuristic fallback) to compute
    day-by-day fatigue scores without invoking the CP-SAT scheduler.
    Use this to power the fatigue rings in the UI after manual shift changes.
    """
    import json

    with open(settings.shared_config_path) as f:
        config = json.load(f)

    service = FatigueScoringService(system_config=config)
    recent_shifts = [item.model_dump() for item in request.recent_assignments]
    trajectories = service.score_team_fatigue(
        employees=[e.model_dump() for e in request.employees],
        start_date=request.start_date,
        num_days=request.num_days,
        recent_shifts=recent_shifts,
        prefer_model=True,
    )
    return FatigueScoresResponse(
        start_date=request.start_date,
        num_days=request.num_days,
        fatigue_trajectories=trajectories,
    )


@router.post("/notes/parse", response_model=ParseNoteResponse)
async def parse_manager_note(request: ParseNoteRequest) -> ParseNoteResponse:
    """
    Parse a natural language manager note into structured scheduling events.

    Uses an LLM (Gemini) to extract scheduling information from free-text notes,
    including sick leave, time off, shift swaps, late arrivals, and coverage requests.
    """
    import subprocess
    import sys
    from pathlib import Path

    note_parser_path = Path(__file__).resolve().parents[4] / "packages" / "note_parser"
    venv_python = (
        note_parser_path / ".venv" / "Scripts" / "python.exe"
        if sys.platform == "win32"
        else note_parser_path / ".venv" / "bin" / "python"
    )
    run_script = note_parser_path / "run_parse.py"

    if not venv_python.exists():
        raise HTTPException(
            status_code=500,
            detail="Note parser environment not found. Run 'uv sync' in packages/note_parser.",
        )

    payload = json.dumps({
        "note": request.note,
        "today_override": request.today_override,
        "employee_roster": request.employee_roster,
    })

    try:
        proc = subprocess.run(
            [str(venv_python), str(run_script)],
            input=payload,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Note parser timed out.")
    except Exception as exc:
        _logger.exception("Failed to launch note parser subprocess")
        raise HTTPException(status_code=500, detail=f"Failed to launch note parser: {exc}") from exc

    if proc.returncode != 0:
        _logger.error("Note parser subprocess error: %s", proc.stderr)
        raise HTTPException(
            status_code=500,
            detail=f"Note parser error: {proc.stderr.strip()}",
        )

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Note parser returned invalid JSON: {exc}",
        ) from exc

    return ParseNoteResponse(**result)
