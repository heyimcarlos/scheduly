from datetime import date

from app.services.availability import AvailabilityService


def test_build_windows_maps_regions_to_expected_utc_hours():
    config = {
        "regions": {
            "Canada": {
                "timezone": "America/Toronto",
                "utc_offset_standard": -5,
                "dst": None,
            },
            "Serbia": {
                "timezone": "Europe/Belgrade",
                "utc_offset_standard": 1,
                "dst": {
                    "utc_offset_dst": 2,
                    "dst_start": {"month": 3, "day": "last_sunday"},
                    "dst_end": {"month": 10, "day": "last_sunday"},
                },
            },
            "India": {
                "timezone": "Asia/Kolkata",
                "utc_offset_standard": 5.5,
                "dst": None,
            },
        },
        "shift_types": [
            {"name": "day", "local_start_min": 5, "local_start_max": 11},
            {"name": "evening", "local_start_min": 12, "local_start_max": 21},
            {"name": "night", "local_start_min": 22, "local_start_max": 4},
        ],
    }

    service = AvailabilityService(system_config=config)
    windows = service.build_windows(
        employees=[
            {"employee_id": 1, "region": "Canada"},
            {"employee_id": 2, "region": "India"},
        ],
        start_date=date(2026, 3, 10),
        num_days=1,
    )

    canada = next(window for window in windows if window.region == "Canada")
    india = next(window for window in windows if window.region == "India")

    assert canada.utc_start.isoformat() == "2026-03-10T13:00:00+00:00"
    assert india.utc_start.isoformat() == "2026-03-10T03:30:00+00:00"
    assert canada.shift_type == "day"


def test_build_windows_applies_dst_for_serbia():
    config = {
        "regions": {
            "Serbia": {
                "timezone": "Europe/Belgrade",
                "utc_offset_standard": 1,
                "dst": {
                    "utc_offset_dst": 2,
                    "dst_start": {"month": 3, "day": "last_sunday"},
                    "dst_end": {"month": 10, "day": "last_sunday"},
                },
            },
        },
        "shift_types": [{"name": "day", "local_start_min": 5, "local_start_max": 11}],
    }
    service = AvailabilityService(system_config=config)
    windows = service.build_windows(
        employees=[{"employee_id": 9, "region": "Serbia"}],
        start_date=date(2026, 4, 1),
        num_days=1,
    )

    assert windows[0].utc_start.isoformat() == "2026-04-01T07:00:00+00:00"


def test_build_windows_marks_manual_absences():
    config = {
        "regions": {
            "Canada": {
                "timezone": "America/Toronto",
                "utc_offset_standard": -5,
                "dst": None,
            }
        },
        "shift_types": [{"name": "day", "local_start_min": 5, "local_start_max": 11}],
    }
    service = AvailabilityService(system_config=config)
    windows = service.build_windows(
        employees=[{"employee_id": 1, "region": "Canada"}],
        start_date=date(2026, 3, 10),
        num_days=2,
        manual_absences=[{"employee_id": 1, "day_offset": 1}],
    )

    assert windows[0].absent is False
    assert windows[1].absent is True


def test_build_windows_uses_standard_time_outside_dst():
    config = {
        "regions": {
            "Canada": {
                "timezone": "America/Toronto",
                "utc_offset_standard": -5,
                "dst": None,
            }
        },
        "shift_types": [{"name": "day", "local_start_min": 5, "local_start_max": 11}],
    }

    service = AvailabilityService(system_config=config)
    windows = service.build_windows(
        employees=[{"employee_id": 1, "region": "Canada"}],
        start_date=date(2026, 1, 15),
        num_days=1,
    )

    assert windows[0].utc_start.isoformat() == "2026-01-15T14:00:00+00:00"
