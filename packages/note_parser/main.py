import json
from dotenv import load_dotenv
import os
from datetime import datetime

import google.generativeai as genai

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError(
        "GEMINI_API_KEY environment variable is not set or is empty. "
        "Please set it before running this script."
    )

genai.configure(api_key=api_key)

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
    "unknown",
]

URGENCY_LEVELS = ["immediate", "planned", "unknown"]

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
      "type": "sick_leave" | "time_off" | "swap" | "late_arrival" | "early_departure" | "coverage_request" | "unknown",
      "employee": "string or null",
      "affected_dates": ["YYYY-MM-DD"],
      "affected_shifts": ["day" | "evening" | "night" | null],
      "swap_target": "string or null",
      "notes": "brief summary",
      "urgency": "immediate" | "planned" | "unknown"
    }}
  ]
}}

Rules:
- If an employee name is mentioned, extract it exactly as written.
- If dates are relative (e.g. "tomorrow", "next Monday"), resolve them from today's date.
- If no specific shift is mentioned, set affected_shifts to null.
- If multiple events are described, return multiple objects in the array.
- If something is ambiguous, set type to "unknown" and explain in notes.
"""

REQUIRED_EVENT_FIELDS = {
    "type",
    "employee",
    "affected_dates",
    "affected_shifts",
    "swap_target",
    "notes",
    "urgency",
}


def _make_fallback_event(message: str) -> dict:
    """Create a standardized fallback event for error cases."""
    return {
        "events": [
            {
                "type": "unknown",
                "employee": None,
                "affected_dates": [],
                "affected_shifts": None,
                "swap_target": None,
                "notes": message,
                "urgency": "unknown",
            }
        ]
    }

def parse_manager_note(
    note: str,
    model: genai.GenerativeModel | None = None,
    today_override: str | None = None,
) -> dict:
    """Parse a natural language manager note into structured gap events.

    Args:
        note: The free-text manager note.
        model: Optional pre-configured GenerativeModel (for testing).
        today_override: Optional date string to override today's date
                        (for deterministic testing).

    Returns:
        A dict with an "events" list of structured scheduling events.
    """
    today = today_override or datetime.now().strftime("%Y-%m-%d (%A)")
    prompt = SYSTEM_PROMPT.format(today=today)

    if model is None:
        model = genai.GenerativeModel(
            model_name=MODEL_NAME,
            system_instruction=prompt,
        )

    try:
        response = model.generate_content(
            note,
            generation_config=genai.GenerationConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        )
    except Exception as e:
        return _make_fallback_event(
            f"API error while generating content: {e}"
        )

    try:
        parsed = json.loads(response.text)
    except (json.JSONDecodeError, ValueError, AttributeError) as e:
        raw = getattr(response, "text", "<no text>")
        return _make_fallback_event(
            f"Failed to parse response ({e}): {raw}"
        )

    return parsed


def main() -> None:
    test_notes = [
        "Alice is sick tomorrow, she won't make her night shift.",
        "Bob wants to swap his Monday day shift with Carlos.",
        "Priya from India will be on vacation Feb 20 to Feb 25.",
        "We need extra coverage this Saturday evening — it's a holiday in Serbia.",
        "John is running late today, he'll miss the first 2 hours of his day shift. "
        "Also, Maria requested next Friday off.",
    ]

    for note in test_notes:
        print(f"\n{'='*60}")
        print(f"INPUT: {note}")
        print("-" * 60)

        result = parse_manager_note(note)
        print("OUTPUT:")
        print(json.dumps(result, indent=2))

        for event in result.get("events", []):
            etype = event.get("type", "unknown")
            emp = event.get("employee", "unknown")
            dates = event.get("affected_dates", [])
            shifts = event.get("affected_shifts")
            urgency = event.get("urgency", "unknown")
            print(
                f"  → [{etype.upper()}] {emp} | "
                f"dates={dates} shifts={shifts} urgency={urgency}"
            )


if __name__ == "__main__":
    main()