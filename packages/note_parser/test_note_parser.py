"""Test suite for the LLM Note Parser — Iteration 2.

Covers the original 5 test cases from Iteration 1 plus new edge cases:
  - Ambiguous / misspelled employee names with fuzzy matching
  - Conflicting instructions in a single note
  - Multi-language fragments (French, Serbian, Hindi)
  - Malformed / partial LLM responses
  - Empty and whitespace-only inputs
  - Invalid date and shift values from the LLM
  - Confidence scoring validation
  - Retry behavior on transient API errors
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from note_parser_module import (
    EVENT_TYPES,
    REQUIRED_EVENT_FIELDS,
    SHIFT_TYPES,
    URGENCY_LEVELS,
    _make_fallback_event,
    _sanitize_event,
    _validate_events,
    _flag_conflicts,
    fuzzy_match_employee,
    parse_manager_note,
)


# ──────────────────────────────────────────────────────────────────────────
# Test helpers
# ──────────────────────────────────────────────────────────────────────────

SAMPLE_ROSTER = [
    "Alice Chen",
    "Bob Martinez",
    "Carlos De La Cruz",
    "Priya Sharma",
    "Milan Jovanovic",
    "Sarah Kim",
]

FIXED_TODAY = "2026-02-19 (Thursday)"


def _mock_model(response_text: str) -> MagicMock:
    """Create a mock GenerativeModel that returns the given JSON string."""
    mock_response = MagicMock()
    mock_response.text = response_text
    mock_model = MagicMock()
    mock_model.generate_content.return_value = mock_response
    return mock_model


def _mock_model_error(error: Exception) -> MagicMock:
    """Create a mock GenerativeModel that raises an error."""
    mock_model = MagicMock()
    mock_model.generate_content.side_effect = error
    return mock_model


def _make_valid_event(**overrides) -> dict:
    """Create a valid event dict with sensible defaults."""
    event = {
        "type": "sick_leave",
        "employee": "Alice Chen",
        "affected_dates": ["2026-02-20"],
        "affected_shifts": ["night"],
        "swap_target": None,
        "notes": "Alice is sick",
        "urgency": "immediate",
        "confidence": "high",
    }
    event.update(overrides)
    return event


def _wrap_events(*events) -> str:
    """Wrap event dicts into a JSON response string."""
    return json.dumps({"events": list(events)})


# ======================================================================
# ITERATION 1 — Original test cases (preserved & updated)
# ======================================================================

class TestIteration1Core:
    """The original 5 test cases from Iteration 1, verifying backward compat."""

    def test_sick_leave(self):
        response_json = _wrap_events(
            _make_valid_event(
                type="sick_leave",
                employee="Alice",
                affected_dates=["2026-02-20"],
                affected_shifts=["night"],
                notes="Alice is sick tomorrow",
                urgency="immediate",
                confidence="high",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Alice is sick tomorrow, she won't make her night shift.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert len(result["events"]) == 1
        event = result["events"][0]
        assert event["type"] == "sick_leave"
        assert event["employee"] == "Alice"
        assert "2026-02-20" in event["affected_dates"]
        assert event["urgency"] == "immediate"

    def test_swap_event(self):
        response_json = _wrap_events(
            _make_valid_event(
                type="swap",
                employee="Bob",
                affected_dates=["2026-02-23"],
                affected_shifts=["day"],
                swap_target="Carlos",
                notes="Bob wants to swap with Carlos",
                urgency="planned",
                confidence="high",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Bob wants to swap his Monday day shift with Carlos.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert event["type"] == "swap"
        assert event["swap_target"] == "Carlos"

    def test_multi_day_time_off(self):
        dates = [f"2026-02-{d}" for d in range(20, 26)]
        response_json = _wrap_events(
            _make_valid_event(
                type="time_off",
                employee="Priya",
                affected_dates=dates,
                affected_shifts=None,
                notes="Vacation Feb 20-25",
                urgency="planned",
                confidence="high",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Priya from India will be on vacation Feb 20 to Feb 25.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert len(event["affected_dates"]) == 6
        assert event["affected_shifts"] is None

    def test_coverage_request_no_employee(self):
        response_json = _wrap_events(
            _make_valid_event(
                type="coverage_request",
                employee=None,
                affected_dates=["2026-02-21"],
                affected_shifts=["evening"],
                notes="Extra coverage for Serbian holiday",
                urgency="planned",
                confidence="high",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "We need extra coverage this Saturday evening.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert event["employee"] is None
        assert event["type"] == "coverage_request"

    def test_compound_note_multiple_events(self):
        response_json = _wrap_events(
            _make_valid_event(
                type="late_arrival",
                employee="John",
                affected_dates=["2026-02-19"],
                affected_shifts=["day"],
                notes="Running 2 hours late",
                urgency="immediate",
                confidence="high",
            ),
            _make_valid_event(
                type="time_off",
                employee="Maria",
                affected_dates=["2026-02-27"],
                affected_shifts=None,
                notes="Requested next Friday off",
                urgency="planned",
                confidence="high",
            ),
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "John is running late today. Also, Maria requested next Friday off.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert len(result["events"]) == 2
        types = {e["type"] for e in result["events"]}
        assert types == {"late_arrival", "time_off"}


# ======================================================================
# ITERATION 2 — Fuzzy employee matching
# ======================================================================

class TestFuzzyMatching:
    """Verify fuzzy name matching against a known roster."""

    def test_exact_match_case_insensitive(self):
        matched, note = fuzzy_match_employee("alice chen", SAMPLE_ROSTER)
        assert matched == "Alice Chen"
        assert note is None

    def test_misspelled_name_fuzzy_match(self):
        matched, note = fuzzy_match_employee("Alic Chen", SAMPLE_ROSTER)
        assert matched == "Alice Chen"
        assert "Fuzzy matched" in note
        assert "score=" in note

    def test_heavily_misspelled_below_threshold(self):
        matched, note = fuzzy_match_employee("Zzzzzzz", SAMPLE_ROSTER)
        assert matched == "Zzzzzzz"  # no match, return as-is
        assert "No roster match" in note

    def test_none_name(self):
        matched, note = fuzzy_match_employee(None, SAMPLE_ROSTER)
        assert matched is None
        assert note is None

    def test_empty_roster(self):
        matched, note = fuzzy_match_employee("Alice", [])
        assert matched == "Alice"
        assert note is None

    def test_misspelled_name_in_full_parse(self):
        """Misspelled name gets corrected via roster during a full parse."""
        response_json = _wrap_events(
            _make_valid_event(
                employee="Alic Chen",  # misspelled
                type="sick_leave",
                confidence="high",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Alic Chen is sick tomorrow.",
            model=model,
            today_override=FIXED_TODAY,
            employee_roster=SAMPLE_ROSTER,
        )
        event = result["events"][0]
        assert event["employee"] == "Alice Chen"
        assert "Fuzzy matched" in event["notes"]

    def test_misspelled_swap_target_corrected(self):
        """Misspelled swap target gets corrected via roster."""
        response_json = _wrap_events(
            _make_valid_event(
                type="swap",
                employee="Bob Martinez",
                swap_target="Sarah Kimm",  # misspelled
                affected_dates=["2026-02-23"],
                affected_shifts=["day"],
                confidence="high",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Bob wants to swap with Sarah Kimm.",
            model=model,
            today_override=FIXED_TODAY,
            employee_roster=SAMPLE_ROSTER,
        )
        event = result["events"][0]
        assert event["swap_target"] == "Sarah Kim"
        assert "Fuzzy matched" in event["notes"]


# ======================================================================
# ITERATION 2 — Conflicting instructions
# ======================================================================

class TestConflictDetection:
    """Verify that contradictory events are flagged."""

    def test_same_employee_away_and_present_on_same_day(self):
        """Alice is both sick and doing a swap on the same day → conflict."""
        events = [
            _make_valid_event(
                type="sick_leave",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                confidence="high",
            ),
            _make_valid_event(
                type="swap",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                swap_target="Bob Martinez",
                confidence="high",
            ),
        ]
        _flag_conflicts(events)
        assert events[0]["confidence"] == "low"
        assert events[1]["confidence"] == "low"
        assert "Conflict" in events[0]["notes"]
        assert "Conflict" in events[1]["notes"]

    def test_no_conflict_different_employees(self):
        """Different employees on the same day → no conflict."""
        events = [
            _make_valid_event(
                type="sick_leave",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                confidence="high",
            ),
            _make_valid_event(
                type="swap",
                employee="Bob Martinez",
                affected_dates=["2026-02-20"],
                confidence="high",
            ),
        ]
        _flag_conflicts(events)
        assert events[0]["confidence"] == "high"
        assert events[1]["confidence"] == "high"

    def test_no_conflict_different_dates(self):
        """Same employee but different dates → no conflict."""
        events = [
            _make_valid_event(
                type="sick_leave",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                confidence="high",
            ),
            _make_valid_event(
                type="swap",
                employee="Alice Chen",
                affected_dates=["2026-02-21"],
                confidence="high",
            ),
        ]
        _flag_conflicts(events)
        assert events[0]["confidence"] == "high"
        assert events[1]["confidence"] == "high"

    def test_conflict_in_full_parse(self):
        """Conflicting instructions detected in a full parse_manager_note call."""
        response_json = _wrap_events(
            _make_valid_event(
                type="time_off",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                confidence="high",
            ),
            _make_valid_event(
                type="late_arrival",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                affected_shifts=["day"],
                confidence="high",
            ),
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Alice is off on the 20th. Actually Alice is just running late on the 20th.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert len(result["events"]) == 2
        assert all(e["confidence"] == "low" for e in result["events"])


# ======================================================================
# ITERATION 2 — Multi-language fragments
# ======================================================================

class TestMultiLanguage:
    """Verify handling of non-English or mixed-language notes."""

    def test_french_note(self):
        """French sick leave note parsed correctly."""
        response_json = _wrap_events(
            _make_valid_event(
                type="sick_leave",
                employee="Milan Jovanovic",
                affected_dates=["2026-02-20"],
                notes="Milan est malade demain (Milan is sick tomorrow)",
                urgency="immediate",
                confidence="high",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Milan est malade demain, il ne pourra pas venir.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert event["type"] == "sick_leave"
        assert event["employee"] == "Milan Jovanovic"

    def test_serbian_note(self):
        """Serbian time-off note parsed correctly."""
        response_json = _wrap_events(
            _make_valid_event(
                type="time_off",
                employee="Milan Jovanovic",
                affected_dates=["2026-02-24", "2026-02-25"],
                notes="Milan trazi slobodan dan (Milan requests time off)",
                urgency="planned",
                confidence="medium",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Milan trazi slobodan dan ponedeljak i utorak.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert event["type"] == "time_off"

    def test_mixed_language_note(self):
        """Mixed English/Hindi note parsed correctly."""
        response_json = _wrap_events(
            _make_valid_event(
                type="time_off",
                employee="Priya Sharma",
                affected_dates=["2026-02-26"],
                notes="Priya kal chutti chahiye (Priya needs leave tomorrow)",
                urgency="planned",
                confidence="medium",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Priya kal chutti chahiye, Thursday off.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert event["type"] == "time_off"
        assert event["employee"] == "Priya Sharma"


# ======================================================================
# ITERATION 2 — Validation & sanitization
# ======================================================================

class TestSanitization:
    """Verify that malformed LLM output is sanitized gracefully."""

    def test_invalid_event_type_becomes_unknown(self):
        event = _sanitize_event({"type": "banana", "employee": "Alice"})
        assert event["type"] is None

    def test_missing_type_defaults_unknown(self):
        event = _sanitize_event({"employee": "Alice"})
        assert event["type"] is None

    def test_invalid_urgency_defaults_unknown(self):
        event = _sanitize_event({"urgency": "super_urgent"})
        assert event["urgency"] == "unknown"

    def test_invalid_dates_filtered_out(self):
        event = _sanitize_event({
            "affected_dates": ["2026-02-20", "not-a-date", "2026-13-40", "2026-02-21"]
        })
        assert event["affected_dates"] == ["2026-02-20", "2026-02-21"]

    def test_invalid_shifts_filtered_out(self):
        event = _sanitize_event({
            "affected_shifts": ["day", "midnight", "graveyard", "evening"]
        })
        assert event["affected_shifts"] == ["day", "evening"]

    def test_all_invalid_shifts_becomes_none(self):
        event = _sanitize_event({
            "affected_shifts": ["midnight", "graveyard"]
        })
        assert event["affected_shifts"] is None

    def test_string_date_wrapped_in_list(self):
        event = _sanitize_event({"affected_dates": "2026-02-20"})
        assert event["affected_dates"] == ["2026-02-20"]

    def test_string_shift_wrapped_in_list(self):
        event = _sanitize_event({"affected_shifts": "day"})
        assert event["affected_shifts"] == ["day"]

    def test_none_employee_stays_none(self):
        event = _sanitize_event({"employee": None})
        assert event["employee"] is None

    def test_confidence_defaults_to_medium(self):
        event = _sanitize_event({})
        assert event["confidence"] == "medium"

    def test_invalid_confidence_defaults_to_medium(self):
        event = _sanitize_event({"confidence": "super_high"})
        assert event["confidence"] == "medium"


class TestValidateEvents:
    """Test the full _validate_events pipeline."""

    def test_missing_events_key(self):
        result = _validate_events({"data": []})
        assert result["events"][0]["type"] is None
        assert "missing" in result["events"][0]["notes"].lower()

    def test_events_not_a_list(self):
        result = _validate_events({"events": "not a list"})
        assert result["events"][0]["type"] is None

    def test_empty_events_list(self):
        result = _validate_events({"events": []})
        assert result["events"][0]["type"] is None
        assert "No events" in result["events"][0]["notes"]

    def test_non_dict_event_skipped(self):
        result = _validate_events({
            "events": [
                "not a dict",
                _make_valid_event(),
            ]
        })
        # Only the valid dict event survives
        assert len(result["events"]) == 1
        assert result["events"][0]["type"] == "sick_leave"


# ======================================================================
# ITERATION 2 — Error handling & edge cases
# ======================================================================

class TestErrorHandling:
    """Verify graceful handling of API failures and edge cases."""

    def test_empty_note(self):
        result = parse_manager_note(
            "",
            model=_mock_model("{}"),
            today_override=FIXED_TODAY,
        )
        assert result["events"][0]["type"] is None
        assert "Empty note" in result["events"][0]["notes"]

    def test_whitespace_only_note(self):
        result = parse_manager_note(
            "   \n\t  ",
            model=_mock_model("{}"),
            today_override=FIXED_TODAY,
        )
        assert result["events"][0]["type"] is None
        assert "Empty note" in result["events"][0]["notes"]

    def test_api_error_returns_fallback(self):
        model = _mock_model_error(ConnectionError("Network timeout"))
        result = parse_manager_note(
            "Alice is sick tomorrow.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert result["events"][0]["type"] is None
        assert "API error" in result["events"][0]["notes"]

    def test_api_error_retries(self):
        """Verify the model is called MAX_RETRIES + 1 times on persistent failure."""
        model = _mock_model_error(ConnectionError("timeout"))
        with patch("note_parser_module.RETRY_DELAY_SECONDS", 0):
            result = parse_manager_note(
                "Test retry",
                model=model,
                today_override=FIXED_TODAY,
            )
        # Should have been called 3 times (initial + 2 retries)
        assert model.generate_content.call_count == 3
        assert "API error after 3 attempts" in result["events"][0]["notes"]

    def test_malformed_json_response(self):
        mock_response = MagicMock()
        mock_response.text = "This is not JSON at all {{{}"
        model = MagicMock()
        model.generate_content.return_value = mock_response

        result = parse_manager_note(
            "Alice is sick.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert result["events"][0]["type"] is None
        assert "Failed to parse" in result["events"][0]["notes"]

    def test_response_text_is_none(self):
        mock_response = MagicMock()
        mock_response.text = None
        model = MagicMock()
        model.generate_content.return_value = mock_response

        result = parse_manager_note(
            "Alice is sick.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert result["events"][0]["type"] is None


# ======================================================================
# ITERATION 2 — Ambiguous scenarios
# ======================================================================

class TestAmbiguousScenarios:
    """Verify handling of vague or incomplete notes."""

    def test_vague_note_no_name_no_date(self):
        """A vague note with no name or date → unknown event with low confidence."""
        response_json = _wrap_events(
            _make_valid_event(
                type="unknown",
                employee=None,
                affected_dates=[],
                affected_shifts=None,
                notes="Vague request, unable to determine details",
                urgency="unknown",
                confidence="low",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Someone might need to take some time off soon.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert event["type"] is None
        assert event["employee"] is None
        assert event["confidence"] == "low"

    def test_ambiguous_name_two_possible_employees(self):
        """Note says 'Sarah' but roster has 'Sarah Kim' — should still match."""
        response_json = _wrap_events(
            _make_valid_event(
                type="time_off",
                employee="Sarah",
                affected_dates=["2026-02-21"],
                confidence="medium",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Sarah wants Friday off.",
            model=model,
            today_override=FIXED_TODAY,
            employee_roster=SAMPLE_ROSTER,
        )
        event = result["events"][0]
        # "Sarah" is close enough to "Sarah Kim" to fuzzy match
        assert event["employee"] == "Sarah Kim"

    def test_date_ambiguity_past_vs_future(self):
        """'Monday' could be past or future — LLM resolves, we validate format."""
        response_json = _wrap_events(
            _make_valid_event(
                type="time_off",
                employee="Alice Chen",
                affected_dates=["2026-02-23"],  # next Monday
                notes="Resolved 'Monday' as next Monday",
                confidence="medium",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Alice needs Monday off.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert "2026-02-23" in event["affected_dates"]

    def test_only_shift_mentioned_no_date(self):
        """Note mentions a shift but no date → dates may be empty."""
        response_json = _wrap_events(
            _make_valid_event(
                type="coverage_request",
                employee=None,
                affected_dates=[],
                affected_shifts=["night"],
                notes="Night shift coverage needed, no date specified",
                urgency="unknown",
                confidence="low",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "We need someone for the night shift.",
            model=model,
            today_override=FIXED_TODAY,
        )
        event = result["events"][0]
        assert event["affected_dates"] == []
        assert event["affected_shifts"] == ["night"]
        assert event["confidence"] == "low"


# ======================================================================
# ITERATION 2 — Confidence scoring
# ======================================================================

class TestConfidenceScoring:
    """Verify confidence values in different scenarios."""

    def test_high_confidence_all_fields_present(self):
        response_json = _wrap_events(
            _make_valid_event(confidence="high")
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Alice Chen is sick tomorrow, night shift.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert result["events"][0]["confidence"] == "high"

    def test_medium_confidence_inferred_element(self):
        response_json = _wrap_events(
            _make_valid_event(
                affected_shifts=None,
                confidence="medium",
                notes="Shift not specified, inferred from context",
            )
        )
        model = _mock_model(response_json)
        result = parse_manager_note(
            "Alice is sick tomorrow.",
            model=model,
            today_override=FIXED_TODAY,
        )
        assert result["events"][0]["confidence"] == "medium"

    def test_conflict_downgrades_to_low(self):
        """Conflicting events should both end up at low confidence."""
        events = [
            _make_valid_event(
                type="time_off",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                confidence="high",
            ),
            _make_valid_event(
                type="late_arrival",
                employee="Alice Chen",
                affected_dates=["2026-02-20"],
                confidence="high",
            ),
        ]
        _flag_conflicts(events)
        assert events[0]["confidence"] == "low"
        assert events[1]["confidence"] == "low"


# ======================================================================
# Structural / contract tests
# ======================================================================

class TestEventContract:
    """Verify every event has all required fields after sanitization."""

    def test_sanitized_event_has_all_required_fields(self):
        event = _sanitize_event({})
        # All required fields should be present (plus confidence)
        for field in REQUIRED_EVENT_FIELDS:
            assert field in event, f"Missing required field: {field}"
        assert "confidence" in event

    def test_all_event_types_are_valid_strings(self):
        for t in EVENT_TYPES:
            assert isinstance(t, str)
            assert t == t.lower()

    def test_all_shift_types_are_valid(self):
        for s in SHIFT_TYPES:
            assert s in ("day", "evening", "night")

    def test_all_urgency_levels_valid(self):
        for u in URGENCY_LEVELS:
            assert u in ("immediate", "planned", "unknown")

    def test_fallback_event_structure(self):
        fb = _make_fallback_event("test error")
        assert "events" in fb
        assert len(fb["events"]) == 1
        event = fb["events"][0]
        for field in REQUIRED_EVENT_FIELDS:
            assert field in event
        assert event["type"] is None
        assert event["confidence"] == "low"

