"""Note parser module for parsing manager scheduling notes."""

from .main import (
    EVENT_TYPES,
    REQUIRED_EVENT_FIELDS,
    SHIFT_TYPES,
    URGENCY_LEVELS,
    _make_fallback_event,
    parse_manager_note,
)

__all__ = [
    "EVENT_TYPES",
    "REQUIRED_EVENT_FIELDS",
    "SHIFT_TYPES",
    "URGENCY_LEVELS",
    "_make_fallback_event",
    "parse_manager_note",
]
