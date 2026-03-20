"""Employee availability and local-day-shift modeling."""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def _nth_weekday_of_month(year: int, month: int, weekday: int, occurrence: int) -> date:
    if occurrence == -1:
        last_day = monthrange(year, month)[1]
        candidate = date(year, month, last_day)
        while candidate.weekday() != weekday:
            candidate -= timedelta(days=1)
        return candidate

    candidate = date(year, month, 1)
    while candidate.weekday() != weekday:
        candidate += timedelta(days=1)
    return candidate + timedelta(weeks=occurrence - 1)


def _resolve_dst_boundary(year: int, config: Dict[str, Any]) -> date:
    token = str(config["day"]).lower()
    ordinal_label, weekday_label = token.split("_")
    weekday_map = {
        "monday": 0,
        "tuesday": 1,
        "wednesday": 2,
        "thursday": 3,
        "friday": 4,
        "saturday": 5,
        "sunday": 6,
    }
    ordinal_map = {
        "first": 1,
        "second": 2,
        "third": 3,
        "fourth": 4,
        "last": -1,
    }
    return _nth_weekday_of_month(
        year,
        int(config["month"]),
        weekday_map[weekday_label],
        ordinal_map[ordinal_label],
    )


def _resolve_offset_hours(region_config: Dict[str, Any], local_day: date) -> float:
    offset = float(region_config["utc_offset_standard"])
    dst = region_config.get("dst")
    if not dst:
        return offset

    start_cfg = dst["dst_start"]
    end_cfg = dst["dst_end"]
    dst_start = _resolve_dst_boundary(local_day.year, start_cfg)
    dst_end = _resolve_dst_boundary(local_day.year, end_cfg)
    if dst_start <= local_day < dst_end:
        return float(dst["utc_offset_dst"])
    return offset


def _resolve_utc_window(
    region_config: Dict[str, Any],
    local_day: date,
    local_start_hour: float,
    shift_length_hours: float,
) -> tuple[datetime, datetime]:
    timezone_name = region_config.get("timezone")
    if timezone_name:
        try:
            region_zone = ZoneInfo(timezone_name)
            start_local = datetime.combine(
                local_day,
                AvailabilityService._hour_to_time(local_start_hour),
                tzinfo=region_zone,
            )
            utc_start = start_local.astimezone(timezone.utc)
            utc_end = utc_start + timedelta(hours=shift_length_hours)
            return utc_start, utc_end
        except ZoneInfoNotFoundError:
            pass

    offset_hours = _resolve_offset_hours(region_config, local_day)
    start_local = datetime.combine(
        local_day, AvailabilityService._hour_to_time(local_start_hour)
    )
    utc_start = (start_local - timedelta(hours=offset_hours)).replace(
        tzinfo=timezone.utc
    )
    utc_end = utc_start + timedelta(hours=shift_length_hours)
    return utc_start, utc_end


def _classify_shift_type(
    local_start_hour: float, shift_types: List[Dict[str, Any]]
) -> str:
    for shift_type in shift_types:
        lo = float(shift_type["local_start_min"])
        hi = float(shift_type["local_start_max"])
        if lo <= hi and lo <= local_start_hour <= hi:
            return shift_type["name"]
        if lo > hi and (local_start_hour >= lo or local_start_hour <= hi):
            return shift_type["name"]
    return "unknown"


@dataclass(frozen=True)
class AvailabilityWindow:
    employee_id: int
    employee_name: str | None
    region: str
    local_date: date
    utc_start: datetime
    utc_end: datetime
    local_start_hour: float
    local_end_hour: float
    shift_type: str
    absent: bool = False


class AvailabilityService:
    """Create UTC working windows for employees who work local day shifts."""

    def __init__(
        self,
        *,
        system_config: Dict[str, Any],
        local_day_start_hour: float = 9.0,
        shift_length_hours: float = 8.0,
    ) -> None:
        self.system_config = system_config
        self.local_day_start_hour = local_day_start_hour
        self.shift_length_hours = shift_length_hours

    @staticmethod
    def _hour_to_time(hour_value: float) -> time:
        hour = int(hour_value)
        minute = int(round((hour_value - hour) * 60))
        if minute == 60:
            hour += 1
            minute = 0
        hour = hour % 24
        return time(hour=hour, minute=minute)

    def build_windows(
        self,
        *,
        employees: Iterable[Dict[str, Any]],
        start_date: date,
        num_days: int,
        manual_absences: Iterable[Dict[str, Any]] | None = None,
    ) -> List[AvailabilityWindow]:
        absences = {
            (entry["employee_id"], entry["day_offset"])
            for entry in (manual_absences or [])
        }
        windows: list[AvailabilityWindow] = []
        regions = self.system_config["regions"]
        shift_types = self.system_config["shift_types"]

        for employee in employees:
            region_name = employee["region"]
            region_config = regions[region_name]
            for day_offset in range(num_days):
                local_day = start_date + timedelta(days=day_offset)
                utc_start, utc_end = _resolve_utc_window(
                    region_config,
                    local_day,
                    self.local_day_start_hour,
                    self.shift_length_hours,
                )
                local_end_hour = (
                    self.local_day_start_hour + self.shift_length_hours
                ) % 24
                windows.append(
                    AvailabilityWindow(
                        employee_id=int(employee["employee_id"]),
                        employee_name=employee.get("employee_name"),
                        region=region_name,
                        local_date=local_day,
                        utc_start=utc_start,
                        utc_end=utc_end,
                        local_start_hour=self.local_day_start_hour,
                        local_end_hour=local_end_hour,
                        shift_type=_classify_shift_type(
                            self.local_day_start_hour, shift_types
                        ),
                        absent=(int(employee["employee_id"]), day_offset) in absences,
                    )
                )
        windows.sort(key=lambda item: (item.utc_start, item.employee_id))
        return windows

    @staticmethod
    def summarize(windows: Iterable[AvailabilityWindow]) -> Dict[str, Any]:
        materialized = list(windows)
        by_region: Dict[str, int] = {}
        absent = 0
        for window in materialized:
            by_region[window.region] = by_region.get(window.region, 0) + 1
            absent += int(window.absent)
        return {
            "total_windows": len(materialized),
            "absent_windows": absent,
            "by_region": by_region,
        }
