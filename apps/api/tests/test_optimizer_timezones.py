from datetime import date
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.lib.optimizer import _build_slot_occurrences_by_day, load_system_config  # noqa: E402


def test_slot_occurrences_follow_toronto_dst_boundaries():
    config = load_system_config()
    occurrences = _build_slot_occurrences_by_day(
        config["shift_slots"],
        start_date=date(2026, 3, 7),
        num_days=3,
        schedule_timezone=config.get("raw_data_timezone"),
    )

    assert occurrences[0]["Morning2"]["utc_start"] == "13:00"
    assert occurrences[1]["Morning2"]["utc_start"] == "12:00"
    assert occurrences[2]["Evening2"]["utc_start"] == "20:00"
