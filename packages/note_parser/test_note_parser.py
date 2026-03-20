import json
from unittest.mock import MagicMock, patch

import pytest

from note_parser import (
    EVENT_TYPES,
    REQUIRED_EVENT_FIELDS,
    SHIFT_TYPES,
    URGENCY_LEVELS,
    _make_fallback_event,
    parse_manager_note
)

def _mock_model(response_text: str) -> MagicMock:
    """Create a mock GenerativeModel that returns the given JSON string."""
    mock_response = MagicMock()
    mock_response.text = response_text
    mock_model = MagicMock()
    mock_model.generate_content.return_value = mock_response
    return mock_model


def _make_valid_event(**overrides) -> dict:
    """Create a valid event dict with sensible defaults."""
    event = {
        "type": "sick_leave",
        "employee": "Alice",
        "affected_dates": ["2026-02-20"],
        "affected_shifts": ["night"],
        "swap_target": None,
        "notes": "Alice is sick",
        "urgency": "immediate",
    }
    event.update(overrides)
    return event


def _wrap_events(*events) -> str:
    """Wrap event dicts into a JSON response string."""
    return json.dumps({"events": list(events)})

class TestParseManagerNote:
    """Tests for the main parsing function with mocked Gemini API."""

    FIXED_TODAY = "2026-02-19 (Thursday)"

    def test_sick_leave(self):
        response_json = _wrap_events(
            {
                "type": "sick_leave",
                "employee": "Alice",
                "affected_dates": ["2026-02-20"],
                "affected_shifts": ["night"],
                "swap_target": None,
                "notes": "Alice is sick tomorrow",
                "urgency": "immediate",
            }
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Alice is sick tomorrow, she won't make her night shift.",
            model=model,
            today_override=self.FIXED_TODAY,
        )

        assert len(result["events"]) == 1
        event = result["events"][0]
        assert event["type"] == "sick_leave"
        assert event["employee"] == "Alice"
        assert "2026-02-20" in event["affected_dates"]
        assert event["urgency"] == "immediate"


    def test_swap_event(self):
        response_json = _wrap_events(
            {
                "type": "swap",
                "employee": "Bob",
                "affected_dates": ["2026-02-23"],
                "affected_shifts": ["day"],
                "swap_target": "Carlos",
                "notes": "Bob wants to swap with Carlos",
                "urgency": "planned",
            }
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Bob wants to swap his Monday day shift with Carlos.",
            model=model,
            today_override=self.FIXED_TODAY,
        )

        event = result["events"][0]
        assert event["type"] == "swap"
        assert event["swap_target"] == "Carlos"

    def test_multi_day_time_off(self):
        dates = [f"2026-02-{d}" for d in range(20, 26)]
        response_json = _wrap_events(
            {
                "type": "time_off",
                "employee": "Priya",
                "affected_dates": dates,
                "affected_shifts": None,
                "swap_target": None,
                "notes": "Vacation Feb 20-25",
                "urgency": "planned",
            }
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Priya from India will be on vacation Feb 20 to Feb 25.",
            model=model,
            today_override=self.FIXED_TODAY,
        )

        event = result["events"][0]
        assert len(event["affected_dates"]) == 6
        assert event["affected_shifts"] is None

    def test_coverage_request_no_employee(self):
        response_json = _wrap_events(
            {
                "type": "coverage_request",
                "employee": None,
                "affected_dates": ["2026-02-21"],
                "affected_shifts": ["evening"],
                "swap_target": None,
                "notes": "Extra coverage for Serbian holiday",
                "urgency": "planned",
            }
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "We need extra coverage this Saturday evening.",
            model=model,
            today_override=self.FIXED_TODAY,
        )

        event = result["events"][0]
        assert event["employee"] is None
        assert event["type"] == "coverage_request"

    def test_compound_note_multiple_events(self):
        response_json = _wrap_events(
            {
                "type": "late_arrival",
                "employee": "John",
                "affected_dates": ["2026-02-19"],
                "affected_shifts": ["day"],
                "swap_target": None,
                "notes": "Running 2 hours late",
                "urgency": "immediate",
            },
            {
                "type": "time_off",
                "employee": "Maria",
                "affected_dates": ["2026-02-27"],
                "affected_shifts": [None],
                "swap_target": None,
                "notes": "Requested next Friday off",
                "urgency": "planned",
            },
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "John is running late today. "
            "Also, Maria requested next Friday off.",
            model=model,
            today_override=self.FIXED_TODAY,
        )

        assert len(result["events"]) == 2
        types = {e["type"] for e in result["events"]}
        assert types == {"late_arrival", "time_off"}

    def test_api_model_called_with_note(self):
        model = _mock_model(_wrap_events(_make_valid_event()))
        parse_manager_note(
            "Test note",
            model=model,
            today_override=self.FIXED_TODAY,
        )
        model.generate_content.assert_called_once()
        call_args = model.generate_content.call_args
        assert call_args[0][0] == "Test note"