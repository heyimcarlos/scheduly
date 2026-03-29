from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import datetime
from difflib import SequenceMatcher
from typing import Sequence

from dotenv import load_dotenv

from google import genai
from google.genai import types

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError(
        "GEMINI_API_KEY environment variable is not set or is empty. "
        "Please set it before running this script."
    )

_client = genai.Client(api_key=api_key)

MODEL_NAME = os.getenv("MODEL_NAME")
if not MODEL_NAME:
    raise RuntimeError(
        "MODEL_NAME environment variable is not set. Please define "
        "MODEL_NAME in your environment or .env file with the name of "
        "the GenerativeModel to use."
    )

SHIFT_TYPES = ["day", "evening", "night"]

EVENT_TYPES = [
    "sick_leave",
    "time_off",
    "swap",
    "late_arrival",
    "early_departure",
    "coverage_request",
]

URGENCY_LEVELS = ["immediate", "planned", "unknown"]

REQUIRED_EVENT_FIELDS = {
    "type",
    "employee",
    "affected_dates",
    "affected_shifts",
    "swap_target",
    "notes",
    "urgency",
}

# Maximum retries on transient API errors
MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 1.0


def _is_rate_limit_error(exc: Exception) -> bool:
    """Return True for 429/quota errors that should not be retried immediately."""
    msg = str(exc)
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower()

SYSTEM_PROMPT = """You are a scheduling assistant for a 24/7 Security Operations Center (SOC).
Your job is to parse natural language notes from a manager into structured JSON scheduling events.

Today's date is {today}.

The SOC has three shift types:
- "day": 06:00-14:00 UTC
- "evening": 14:00-22:00 UTC
- "night": 22:00-06:00 UTC

Respond ONLY with valid JSON matching this schema (no markdown, no explanation):
{{
  "events": [
    {{
      "type": "sick_leave" | "time_off" | "swap" | "late_arrival" | "early_departure" | "coverage_request",
      "employee": "string or null",
      "affected_dates": ["YYYY-MM-DD"],
      "affected_shifts": ["day" | "evening" | "night"] or null,
      "swap_target": "string or null",
      "notes": "brief summary",
      "urgency": "immediate" | "planned" | "unknown",
      "confidence": "high" | "medium" | "low"
    }}
  ]
}}

Rules:
- If an employee name is mentioned, extract it exactly as written.
- If dates are relative (e.g. "tomorrow", "next Monday"), resolve them from today's date.
- If no specific shift is mentioned, set affected_shifts to null.
- If multiple events are described, return multiple objects in the array.
- If something is ambiguous, set confidence to "low", and explain in notes.
- If conflicting instructions are found (e.g. "Alice is off Monday" and "Alice works Monday"),
  return both events with confidence "low" and note the conflict.
- If the input contains non-English text, do your best to interpret scheduling intent.
  Translate the relevant meaning into the notes field.
- If a name appears misspelled but is close to a known roster name, use the name as written
  and note the possible match in the notes field.
- Set confidence to "high" when type, employee, and dates are all clearly stated.
  Set "medium" when one element is inferred. Set "low" when ambiguous.
"""

def _make_fallback_event(message: str) -> dict:
    """Create a standardized fallback event for error cases."""
    return {
        "events": [
            {
                "type": None,
                "employee": None,
                "affected_dates": [],
                "affected_shifts": None,
                "swap_target": None,
                "notes": message,
                "urgency": "unknown",
                "confidence": "low",
            }
        ]
    }

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_date(d: str) -> bool:
    """Check that a string is a valid YYYY-MM-DD date."""
    if not _ISO_DATE_RE.match(d):
        return False
    try:
        datetime.strptime(d, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _sanitize_event(event: dict) -> dict:
    """Validate and fix a single parsed event, adding defaults for missing fields."""
    sanitized = {}

    # type — must be valid or default to None
    raw_type = str(event.get("type") or "").strip().lower()
    sanitized["type"] = raw_type if raw_type in EVENT_TYPES else None

    # employee
    emp = event.get("employee")
    sanitized["employee"] = str(emp).strip() if emp else None

    # affected_dates — keep only valid ISO dates
    raw_dates = event.get("affected_dates") or []
    if isinstance(raw_dates, str):
        raw_dates = [raw_dates]
    sanitized["affected_dates"] = [d for d in raw_dates if _validate_date(str(d))]

    # affected_shifts — keep only valid shift types
    raw_shifts = event.get("affected_shifts")
    if raw_shifts is None:
        sanitized["affected_shifts"] = None
    else:
        if isinstance(raw_shifts, str):
            raw_shifts = [raw_shifts]
        valid = [s for s in raw_shifts if s in SHIFT_TYPES]
        sanitized["affected_shifts"] = valid if valid else None

    # swap_target
    swap = event.get("swap_target")
    sanitized["swap_target"] = str(swap).strip() if swap else None

    # notes
    sanitized["notes"] = str(event.get("notes") or "").strip()

    # urgency
    raw_urg = str(event.get("urgency", "unknown")).strip().lower()
    sanitized["urgency"] = raw_urg if raw_urg in URGENCY_LEVELS else "unknown"

    # confidence (new in Iteration 2)
    raw_conf = str(event.get("confidence", "medium")).strip().lower()
    sanitized["confidence"] = raw_conf if raw_conf in ("high", "medium", "low") else "medium"

    return sanitized


def _validate_events(parsed: dict, roster: Sequence[str] | None = None) -> dict:
    """Validate and sanitize the full parsed output.

    - Ensures "events" is a list
    - Sanitizes every event
    - Applies fuzzy employee matching
    - Flags conflicting events (same employee, same date, contradictory types)
    """
    if not isinstance(parsed, dict) or "events" not in parsed:
        return _make_fallback_event("Response missing 'events' key")

    raw_events = parsed.get("events")
    if not isinstance(raw_events, list):
        return _make_fallback_event("'events' is not a list")

    if len(raw_events) == 0:
        return _make_fallback_event("No events parsed from the input")

    sanitized_events = []
    for raw in raw_events:
        if not isinstance(raw, dict):
            continue
        event = _sanitize_event(raw)

        # Apply fuzzy matching to employee and swap_target
        if event["employee"]:
            matched_emp, emp_note = fuzzy_match_employee(event["employee"], roster)
            event["employee"] = matched_emp
            if emp_note:
                event["notes"] = f"{event['notes']}. {emp_note}".strip(". ")

        if event["swap_target"]:
            matched_target, target_note = fuzzy_match_employee(event["swap_target"], roster)
            event["swap_target"] = matched_target
            if target_note:
                event["notes"] = f"{event['notes']}. {target_note}".strip(". ")

        sanitized_events.append(event)

    # Detect conflicts
    _flag_conflicts(sanitized_events)

    return {"events": sanitized_events}


def _flag_conflicts(events: list[dict]) -> None:
    """Mutate events in-place to flag contradictory instructions.

    An "away" event (sick_leave, time_off) on the same date as a "present"
    event (swap, late_arrival) for the same employee is flagged.
    """
    away_types = {"sick_leave", "time_off", "early_departure"}
    present_types = {"swap", "coverage_request", "late_arrival"}

    for i, a in enumerate(events):
        for j, b in enumerate(events):
            if j <= i:
                continue
            if not a["employee"] or a["employee"] != b["employee"]:
                continue
            overlap = set(a["affected_dates"]) & set(b["affected_dates"])
            if not overlap:
                continue

            a_away = a["type"] in away_types
            b_away = b["type"] in away_types
            a_present = a["type"] in present_types
            b_present = b["type"] in present_types

            if (a_away and b_present) or (a_present and b_away):
                conflict_note = (
                    f"Conflict: '{a['type']}' vs '{b['type']}' "
                    f"for {a['employee']} on {', '.join(sorted(overlap))}"
                )
                a["notes"] = f"{a['notes']}. {conflict_note}".strip(". ")
                b["notes"] = f"{b['notes']}. {conflict_note}".strip(". ")
                a["confidence"] = "low"
                b["confidence"] = "low"


def fuzzy_match_employee(
    name: str | None,
    roster: Sequence[str] | None = None,
) -> tuple[str | None, str | None]:
    """Fuzzy-match an employee name against a roster.

    Args:
        name: The employee name to match (can be None).
        roster: Optional list of known employee names.

    Returns:
        A tuple of (matched_name, note). If there's a match, note describes it.
        If no match or no roster, returns (name, None) or (None, None).
    """
    if name is None:
        return None, None

    if not roster:
        return name, None

    # Exact case-insensitive match
    for r_name in roster:
        if name.lower() == r_name.lower():
            return r_name, None

    # Fuzzy match: find the best scoring candidate
    best_match = None
    best_score = 0.0
    threshold = 0.6  # Require at least 60% similarity

    for r_name in roster:
        scorer = SequenceMatcher(None, name.lower(), r_name.lower())
        score = scorer.ratio()
        if score > best_score:
            best_score = score
            best_match = r_name

    if best_score >= threshold:
        note = f"Fuzzy matched '{name}' to '{best_match}' (score={best_score:.2f})"
        return best_match, note

    # No match above threshold
    note = f"No roster match for '{name}' (best={best_score:.2f})"
    return name, note


def parse_manager_note(
    note: str,
    model: None = None,
    today_override: str | None = None,
    employee_roster: Sequence[str] | None = None,
) -> dict:
    """Parse a natural language manager note into structured gap events.

    Args:
        note: The free-text manager note.
        model: Unused, kept for backwards compatibility.
        today_override: Optional date string to override today's date
                        (for deterministic testing).
        employee_roster: Optional list of known employee names for fuzzy matching.

    Returns:
        A dict with an "events" list of structured scheduling events.
    """
    if not note or not note.strip():
        return _make_fallback_event("Empty note provided")

    today = today_override or datetime.now().strftime("%Y-%m-%d (%A)")

    prompt = SYSTEM_PROMPT.format(today=today)

    # Retry loop for transient API errors (skips retry on rate limit)
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = _client.models.generate_content(
                model=MODEL_NAME,
                contents=note,
                config=types.GenerateContentConfig(
                    system_instruction=prompt,
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )
            break
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e):
                return _make_fallback_event(f"Rate limit exceeded: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS)
            continue
    else:
        return _make_fallback_event(f"API error after {MAX_RETRIES + 1} attempts: {last_error}")

    # Parse JSON response
    try:
        parsed = json.loads(response.text)
    except (json.JSONDecodeError, ValueError, AttributeError, TypeError) as e:
        raw = getattr(response, "text", "<no text>")
        return _make_fallback_event(f"Failed to parse response ({e}): {raw}")

    # Validate, sanitize, fuzzy-match, flag conflicts
    return _validate_events(parsed, roster=employee_roster)


async def parse_manager_note_async(
    note: str,
    today_override: str | None = None,
    employee_roster: Sequence[str] | None = None,
) -> dict:
    """Async version of parse_manager_note using the async genai client."""
    if not note or not note.strip():
        return _make_fallback_event("Empty note provided")

    today = today_override or datetime.now().strftime("%Y-%m-%d (%A)")
    prompt = SYSTEM_PROMPT.format(today=today)

    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = await _client.aio.models.generate_content(
                model=MODEL_NAME,
                contents=note,
                config=types.GenerateContentConfig(
                    system_instruction=prompt,
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )
            break
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e):
                return _make_fallback_event(f"Rate limit exceeded: {e}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS)
            continue
    else:
        return _make_fallback_event(f"API error after {MAX_RETRIES + 1} attempts: {last_error}")

    try:
        parsed = json.loads(response.text)
    except (json.JSONDecodeError, ValueError, AttributeError, TypeError) as e:
        raw = getattr(response, "text", "<no text>")
        return _make_fallback_event(f"Failed to parse response ({e}): {raw}")

    return _validate_events(parsed, roster=employee_roster)