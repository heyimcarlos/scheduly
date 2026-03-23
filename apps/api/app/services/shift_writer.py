"""Write solved schedule shifts to Supabase."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from supabase import Client

_logger = logging.getLogger(__name__)


class ShiftWriter:
    """Transform solver output and write shifts to Supabase."""

    def __init__(self, client: Client) -> None:
        self.client = client

    def write_schedule(
        self,
        solved_schedule: dict[str, Any],
        member_id_map: dict[int, str],
    ) -> list[str]:
        """Write solved schedule shifts to Supabase.

        Args:
            solved_schedule: JSON-decoded schedule from CP-SAT solver
            member_id_map: Mapping of employee_id (int) to member_id (UUID string)

        Returns:
            List of created shift IDs
        """
        staff_schedules = solved_schedule.get("staff_schedules", [])
        shift_ids: list[str] = []

        for emp_schedule in staff_schedules:
            employee_id = emp_schedule["employee_id"]
            member_id = member_id_map.get(employee_id)

            if not member_id:
                _logger.warning(
                    "No member_id mapping for employee_id %s, skipping", employee_id
                )
                continue

            for day in emp_schedule.get("days", []):
                if not day.get("is_working") or not day.get("shift"):
                    continue

                shift = day["shift"]
                shift_data = self._build_shift_record(
                    member_id=member_id,
                    shift=shift,
                    date=day["date"],
                )

                result = self.client.table("shifts").insert(shift_data).execute()

                if result.data:
                    shift_ids.append(result.data[0]["id"])

        _logger.info("Wrote %s shifts to Supabase", len(shift_ids))
        return shift_ids

    def _build_shift_record(
        self,
        member_id: str,
        shift: dict[str, Any],
        date: str,
    ) -> dict[str, Any]:
        """Build a shift record from solver output.

        Args:
            member_id: UUID of the team member
            shift: Shift info from solver (slot_name, shift_type, utc_start_at, etc.)
            date: Date string (YYYY-MM-DD)

        Returns:
            Shift record dict for Supabase insert
        """
        utc_start_at = shift["utc_start_at"]
        utc_end_at = shift["utc_end_at"]

        # Handle overnight shifts where end is next day
        end_date = date
        if isinstance(utc_end_at, str):
            # Parse and check if end is next day
            end_dt = datetime.fromisoformat(utc_end_at.replace("Z", "+00:00"))
            if end_dt.date() > datetime.fromisoformat(date).date():
                end_date = end_dt.date().isoformat()

        return {
            "member_id": member_id,
            "shift_type": shift.get("shift_type", "day"),
            "start_time": utc_start_at if isinstance(utc_start_at, str) else utc_start_at.isoformat(),
            "end_time": utc_end_at if isinstance(utc_end_at, str) else utc_end_at.isoformat(),
            "title": shift.get("slot_name"),
            "is_pending": False,
            "is_conflict": False,
            "is_efficient": True,
            "is_high_fatigue": False,
        }

    def delete_shifts_for_date_range(
        self,
        member_ids: list[str],
        start_date: str,
        end_date: str,
    ) -> int:
        """Delete existing shifts for a date range.

        Args:
            member_ids: List of member UUIDs to clear shifts for
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)

        Returns:
            Number of shifts deleted
        """
        if not member_ids:
            return 0

        # Get shifts to delete
        response = (
            self.client.table("shifts")
            .select("id")
            .in_("member_id", member_ids)
            .gte("start_time", f"{start_date}T00:00:00Z")
            .lte("start_time", f"{end_date}T23:59:59Z")
            .execute()
        )

        if not response.data:
            return 0

        shift_ids = [s["id"] for s in response.data]

        # Delete them
        self.client.table("shifts").delete().in_("id", shift_ids).execute()

        _logger.info("Deleted %s shifts for date range %s to %s", len(shift_ids), start_date, end_date)
        return len(shift_ids)
