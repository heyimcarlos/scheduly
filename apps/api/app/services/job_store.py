"""Thread-safe in-memory job store for async schedule generation jobs."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from app.models.schemas import ScheduleJobResponse, SchedulePlanResponse


class JobStore:
    """
    Thread-safe in-memory store for async schedule generation jobs.

    Each job tracks:
      - job_id   : unique UUID string
      - status   : "pending" | "running" | "completed" | "failed"
      - result   : SchedulePlanResponse (set on completion)
      - error    : error message string (set on failure)
      - timestamps: created_at, updated_at (UTC)

    Jobs persist only for the lifetime of the process.
    For production, replace with Redis / DB-backed store.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: Dict[str, ScheduleJobResponse] = {}

    def create_job(self) -> str:
        """Create a new job in 'pending' state and return its job_id."""
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        job = ScheduleJobResponse(
            job_id=job_id,
            status="pending",
            result=None,
            error=None,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._jobs[job_id] = job
        return job_id

    def update_job(
        self,
        job_id: str,
        *,
        status: str,
        result: Optional[SchedulePlanResponse] = None,
        error: Optional[str] = None,
    ) -> None:
        """Update an existing job's status, result, or error message."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            self._jobs[job_id] = ScheduleJobResponse(
                job_id=job_id,
                status=status,  # type: ignore[arg-type]
                result=result if result is not None else job.result,
                error=error if error is not None else job.error,
                created_at=job.created_at,
                updated_at=datetime.now(timezone.utc),
            )

    def get_job(self, job_id: str) -> Optional[ScheduleJobResponse]:
        """Return the job or None if not found."""
        with self._lock:
            return self._jobs.get(job_id)


# Module-level singleton — shared across all requests in one process.
_store = JobStore()


def get_job_store() -> JobStore:
    """FastAPI dependency that returns the singleton JobStore."""
    return _store
