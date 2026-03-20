"""
Configuration constants for preprocessing pipeline.
"""

import os

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW_DATA_PATH = os.path.join(BASE_DIR, "..", "data", "raw")
PROCESSED_DATA_PATH = os.path.join(BASE_DIR, "..", "data", "processed")

# System config path (source of truth for regions, timezones, shift type rules)
SYSTEM_CONFIG_PATH = os.path.join(BASE_DIR, "..", "shared", "system_config.json")

# File names
FILES = {"humanity": "humanity-export-2025.xlsx", "schedule": "schedule-2025.xlsx"}

# Match tolerance for fuzzy matching (in hours)
TIME_MATCH_TOLERANCE = 0.5  # ±30 minutes

# Default rest hours for first shift per employee
DEFAULT_FIRST_SHIFT_REST = 48.0
