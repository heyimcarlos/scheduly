"""Subprocess entrypoint: reads a JSON payload from stdin, writes JSON result to stdout.

Expected stdin JSON:
  {
    "note": "...",
    "today_override": "YYYY-MM-DD" | null,
    "employee_roster": ["name", ...] | null
  }

Stdout: the parsed result dict ({"events": [...]})
Stderr: error messages if any
Exit code: 0 on success, 1 on failure
"""

from __future__ import annotations

import json
import sys


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON payload: {exc}", file=sys.stderr)
        sys.exit(1)

    from note_parser_module import parse_manager_note

    result = parse_manager_note(
        note=payload["note"],
        today_override=payload.get("today_override"),
        employee_roster=payload.get("employee_roster"),
    )

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
