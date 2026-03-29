"""CLI entrypoint for running the LLM note parser on one note input."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Parse one manager note and write structured events to JSON.",
    )
    note_group = parser.add_mutually_exclusive_group(required=True)
    note_group.add_argument(
        "--note",
        help="Raw note text to parse.",
    )
    note_group.add_argument(
        "--note-file",
        type=Path,
        help="Path to a UTF-8 text file containing the note to parse.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Path to write the parsed JSON output.",
    )
    return parser


def _parse_note(note: str) -> dict:
    """Import lazily so test code can patch parser behavior without API setup."""
    from note_parser_module import parse_manager_note
    return parse_manager_note(note)


def _load_note_text(args: argparse.Namespace, parser: argparse.ArgumentParser) -> str:
    if args.note is not None:
        note_text = args.note.strip()
        if not note_text:
            parser.error("--note cannot be empty.")
        return note_text

    try:
        note_text = args.note_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        parser.error(f"Error reading {args.note_file}: {exc}")

    if not note_text:
        parser.error(f"Note file {args.note_file} is empty.")
    return note_text


def main(args: Sequence[str] | None = None) -> None:
    parser = _build_parser()
    parsed_args = parser.parse_args(args)

    note_text = _load_note_text(parsed_args, parser)

    try:
        result = _parse_note(note_text)
    except Exception as exc:
        print(f"Failed to parse note: {exc}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(parsed_args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write events
    events = result.get("events", [])
    output_path.write_text(json.dumps(events, indent=2), encoding="utf-8")
    print(f"Wrote {len(events)} event(s) to {output_path}")


if __name__ == "__main__":
    main()
