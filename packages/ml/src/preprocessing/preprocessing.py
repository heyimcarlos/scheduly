"""
Main preprocessing pipeline for AI Scheduler.
Metadata Injection Strategy: Use Schedule-2025 as "The Brain" to enrich Humanity-Export "The Body".

UTC Architecture
----------------
- All raw times are EST (UTC-5) wall-clock — SME enters Toronto time for all employees.
- On ingest: EST → UTC (canonical operational truth).
- _est columns are kept as audit trail / UI layer.
- local_start_hour is derived from UTC using each employee's true local offset (DST-aware).
- shift_type is classified from local_start_hour, NOT from EST hour.
- system_config.json is the single source of truth for regions, DST rules, and shift thresholds.
"""

import calendar
import json
import math
import os
import warnings
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
import pandas as pd

from .config import (
    DEFAULT_FIRST_SHIFT_REST,
    FILES,
    PROCESSED_DATA_PATH,
    RAW_DATA_PATH,
    SYSTEM_CONFIG_PATH,
    TIME_MATCH_TOLERANCE,
)

# Suppress warnings
warnings.filterwarnings("ignore")


# ============================================================================
# SYSTEM CONFIG — loaded once at module level
# ============================================================================


def _load_system_config():
    """Load system_config.json. Raises if file is missing."""
    path = os.path.abspath(SYSTEM_CONFIG_PATH)
    with open(path, "r") as f:
        return json.load(f)


_CFG = _load_system_config()


# ============================================================================
# DST / TIMEZONE HELPERS
# ============================================================================


def _nth_weekday_of_month(year, month, weekday, n):
    """
    Return the date of the n-th occurrence of `weekday` (0=Mon … 6=Sun) in
    (year, month).  n=-1 means the last occurrence.

    Examples
    --------
    _nth_weekday_of_month(2025, 3, 6, -1)   # last Sunday of March 2025
    _nth_weekday_of_month(2025, 3, 6,  2)   # second Sunday of March 2025
    """
    if n == -1:
        # last occurrence: start from last day of month and walk backwards
        last_day = calendar.monthrange(year, month)[1]
        d = datetime(year, month, last_day)
        while d.weekday() != weekday:
            d -= timedelta(days=1)
        return d
    else:
        # n-th occurrence (1-based)
        d = datetime(year, month, 1)
        while d.weekday() != weekday:
            d += timedelta(days=1)
        d += timedelta(weeks=n - 1)
        return d


def _parse_day_token(token):
    """
    Convert a DST day token into (weekday_int, n) for _nth_weekday_of_month.

    Supported tokens:
        "last_sunday"   → (6, -1)
        "first_sunday"  → (6,  1)
        "second_sunday" → (6,  2)
    """
    WEEKDAY_MAP = {
        "monday": 0,
        "tuesday": 1,
        "wednesday": 2,
        "thursday": 3,
        "friday": 4,
        "saturday": 5,
        "sunday": 6,
    }
    ORDINAL_MAP = {"last": -1, "first": 1, "second": 2, "third": 3, "fourth": 4}

    parts = token.lower().split("_")
    if len(parts) != 2:
        raise ValueError(f"Unsupported DST day token: {token!r}")
    ordinal, weekday_name = parts
    return WEEKDAY_MAP[weekday_name], ORDINAL_MAP[ordinal]


def _is_dst(location, dt):
    """
    Return True if `dt` (naive datetime, UTC) falls inside DST for `location`.
    Returns False for regions with no DST (dst == null in config).
    Handles both Northern Hemisphere (start < end month) and
    Southern Hemisphere (start > end month) DST conventions.
    """
    region_cfg = _CFG["regions"].get(location)
    if region_cfg is None or region_cfg.get("dst") is None:
        return False

    dst_cfg = region_cfg["dst"]
    start_cfg = dst_cfg["dst_start"]
    end_cfg = dst_cfg["dst_end"]

    weekday_s, n_s = _parse_day_token(start_cfg["day"])
    weekday_e, n_e = _parse_day_token(end_cfg["day"])

    dst_start = _nth_weekday_of_month(dt.year, start_cfg["month"], weekday_s, n_s)
    dst_end = _nth_weekday_of_month(dt.year, end_cfg["month"], weekday_e, n_e)

    if dst_start < dst_end:
        # Northern Hemisphere: DST active between start and end
        return dst_start <= dt < dst_end
    else:
        # Southern Hemisphere: DST active outside start..end window
        return dt >= dst_start or dt < dst_end


def _get_zoneinfo(location):
    region_cfg = _CFG["regions"].get(location)
    timezone_name = region_cfg.get("timezone") if region_cfg else None
    if not timezone_name:
        return None

    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return None


def get_utc_offset(location, dt):
    """
    Return the UTC offset (float hours) for `location` at datetime `dt` (naive, UTC).
    Reads DST rules from _CFG. Never hardcodes offsets.
    """
    region_cfg = _CFG["regions"].get(location)
    if region_cfg is None:
        return 0.0

    zone = _get_zoneinfo(location)
    if zone is not None:
        aware_utc = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        offset = aware_utc.astimezone(zone).utcoffset()
        if offset is not None:
            return offset.total_seconds() / 3600.0

    base_offset = region_cfg["utc_offset_standard"]
    if _is_dst(location, dt):
        return float(region_cfg["dst"]["utc_offset_dst"])
    return float(base_offset)


def est_to_utc(est_dt):
    """
    Convert a Toronto wall-clock datetime to naive UTC datetime.
    Uses the configured IANA timezone when available, falling back to the
    legacy raw_data_utc_offset for compatibility.
    """
    raw_timezone = _CFG.get("raw_data_timezone")
    if raw_timezone:
        try:
            localized = est_dt.replace(tzinfo=ZoneInfo(raw_timezone))
            return localized.astimezone(timezone.utc).replace(tzinfo=None)
        except ZoneInfoNotFoundError:
            pass

    offset_hours = abs(_CFG["raw_data_utc_offset"])
    return est_dt + timedelta(hours=offset_hours)


def utc_to_local_hour(utc_dt, location):
    """
    Return the employee's local hour (0-23, integer) for a given UTC datetime.
    Accounts for fractional offsets (e.g. India UTC+5.5).
    """
    offset = get_utc_offset(location, utc_dt)
    local_dt = utc_dt + timedelta(hours=offset)
    # Handle the fractional-hour case: floor to the hour for the hour label
    total_minutes = local_dt.hour * 60 + local_dt.minute
    return math.floor(total_minutes / 60) % 24


# ============================================================================
# SHIFT TYPE CLASSIFICATION (config-driven, handles night wraparound)
# ============================================================================


def classify_shift_type(local_hour):
    """
    Classify shift type based on an employee's local start hour.
    Reads shift_types array from _CFG — no hardcoded rules.
    Handles night wraparound (e.g. 22-4 spans midnight).
    """
    for rule in _CFG["shift_types"]:
        lo = rule["local_start_min"]
        hi = rule["local_start_max"]
        if lo <= hi:
            # Simple range (day, evening)
            if lo <= local_hour <= hi:
                return rule["name"]
        else:
            # Wraparound range (night: 22-4)
            if local_hour >= lo or local_hour <= hi:
                return rule["name"]
    # Fallback: return the last defined type
    return _CFG["shift_types"][-1]["name"]


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================


def parse_time_string(time_str):
    """Parse '8am', '4pm', '12am', '4:00am' to datetime object."""
    time_str = str(time_str).lower().strip()
    try:
        if ":" in time_str:
            return datetime.strptime(time_str, "%I:%M%p")
        else:
            return datetime.strptime(time_str, "%I%p")
    except ValueError:
        return datetime.strptime("12am", "%I%p")


def extract_work_category(position_name):
    """Extract work category from position name."""
    position_name = str(position_name).upper()
    if "CA" in position_name:
        return "canada"
    elif "RCMT" in position_name:
        return "remote"
    elif "ON CALL" in position_name or "ONCALL" in position_name:
        return "on-call"
    else:
        return "general"


def standardize_employee_id(name):
    """
    Convert e.g. 'Canada 1' → ('CAN_01', 'Canada').
    Fully dynamic — reads prefix from _CFG["regions"].
    """
    name = str(name).strip()
    for region_name, region_cfg in _CFG["regions"].items():
        if region_name in name:
            num = name.split()[-1].zfill(2)
            prefix = region_cfg["prefix"]
            return f"{prefix}_{num}", region_name
    return f"UNK_{name}", "Unknown"


# ============================================================================
# STEP 1: LOAD SHIFT METADATA (The Brain)
# ============================================================================


def load_shift_metadata():
    """
    Load shift definitions from Schedule-2025 Shifts sheet.
    shift_type here is classified from EST start hour — this is intentional.
    The shift template library uses Toronto wall-clock time as defined by the SME.
    Per-employee local classification happens in process_humanity_data().

    Returns: dict with (start_time_str, duration_hours) -> (shift_template, shift_type, category)
    """
    print("Loading Shift Metadata (The Brain)...")
    path = os.path.join(RAW_DATA_PATH, FILES["schedule"])

    try:
        df = pd.read_excel(path, sheet_name="Shifts")
    except Exception as e:
        print(f"Error loading shifts: {e}")
        return {}

    # Filter out non-working shifts (Free, PTO, Sick, Training)
    working_shifts = df[
        ~df["Positions"].str.contains("Free|PTO|Sick|Training", case=False, na=False)
    ].copy()

    metadata_lookup = {}

    for _, row in working_shifts.iterrows():
        shift_template = row["Positions"]
        start_str = str(row["Start time"]).lower().strip()
        end_str = str(row["End time"]).lower().strip()

        try:
            start_dt = parse_time_string(start_str)
            end_dt = parse_time_string(end_str)

            if end_dt <= start_dt:
                end_dt += timedelta(days=1)

            duration = (end_dt - start_dt).total_seconds() / 3600

            # Template-level shift_type uses EST hour (Toronto SME view — intentional)
            shift_type = classify_shift_type(start_dt.hour)

            category = extract_work_category(shift_template)

            key = (start_str, round(duration, 1))
            metadata_lookup[key] = (shift_template, shift_type, category)

        except Exception as e:
            print(f"  Warning: Could not parse shift '{shift_template}': {e}")
            continue

    print(f"  [OK] Loaded {len(metadata_lookup)} shift definitions")
    return metadata_lookup


def find_weekend_variant(lookup, start_str, duration):
    """Find weekend version of a shift if it exists."""
    for key, (pos, _, _) in lookup.items():
        if key[0] == start_str and abs(key[1] - duration) < TIME_MATCH_TOLERANCE:
            if "Weekend" in pos:
                return key
    return None


# ============================================================================
# STEP 2: PROCESS HUMANITY DATA (Metadata Injection)
# ============================================================================


def process_humanity_data(metadata_lookup):
    """
    Load Humanity export and inject shift metadata.
    - Columns parsed as _est (SME wall-clock, audit trail).
    - _utc columns added as canonical operational truth.
    - local_start_hour = employee's true local hour (DST-aware).
    - shift_type corrected to use local_start_hour (fixes India/Serbia bias).
    - position renamed to shift_template (metadata only, not a model feature).

    Returns: DataFrame with enriched columns.
    """
    print("Processing Humanity Data (The Body + Injection)...")
    path = os.path.join(RAW_DATA_PATH, FILES["humanity"])

    try:
        df = pd.read_excel(path)
    except Exception as e:
        print(f"Error loading Humanity data: {e}")
        return pd.DataFrame()

    # Step 1: Standardize Employee IDs
    df[["employee_id", "location"]] = df["employee"].apply(
        lambda x: pd.Series(standardize_employee_id(x))
    )

    # Step 2: Parse Date-Times — named _est (SME wall-clock, Toronto EST)
    df["start_est"] = pd.to_datetime(
        df["start_day"] + " " + df["start_time"], format="%m/%d/%Y %I:%M%p"
    )
    df["end_est"] = pd.to_datetime(
        df["end_day"] + " " + df["end_time"], format="%m/%d/%Y %I:%M%p"
    )

    # Handle overnight shifts
    overnight_mask = df["end_est"] < df["start_est"]
    df.loc[overnight_mask, "end_est"] += pd.Timedelta(days=1)

    # Step 3: Compute UTC columns (canonical operational truth)
    df["start_utc"] = df["start_est"].map(est_to_utc)
    df["end_utc"] = df["end_est"].map(est_to_utc)

    # Step 4: Calculate Duration
    df["duration_hours"] = (df["end_est"] - df["start_est"]).dt.total_seconds() / 3600

    # Step 5: Metadata Injection
    enriched_rows = []

    for _, row in df.iterrows():
        start_time_str = str(row["start_time"]).lower().strip()
        duration = round(float(row["duration_hours"]), 1)
        day_of_week = row["start_est"].dayofweek  # 0=Monday, 6=Sunday
        is_weekend = bool(day_of_week >= 5)

        # Compute employee's true local start hour (DST-aware) from UTC
        local_start_hour = utc_to_local_hour(row["start_utc"], row["location"])

        # Correct shift_type using employee's local hour (fixes India/Serbia bias)
        corrected_shift_type = classify_shift_type(local_start_hour)

        # Normalize time string for metadata lookup (remove :00)
        normalized_time = start_time_str.replace(":00", "")

        key = (normalized_time, duration)
        metadata = metadata_lookup.get(key)

        if not metadata:
            key = (start_time_str, duration)
            metadata = metadata_lookup.get(key)

        if metadata:
            shift_template, _template_shift_type, category = metadata

            # Disambiguate weekend vs weekday positions
            if is_weekend and "Weekend" not in shift_template:
                weekend_key = find_weekend_variant(
                    metadata_lookup, start_time_str, duration
                )
                if weekend_key:
                    shift_template, _, category = metadata_lookup[weekend_key]
                    match_quality = "exact_weekend"
                else:
                    match_quality = "exact"
            else:
                match_quality = "exact"
        else:
            shift_template = "Custom/Unmatched"
            category = "unmatched"
            match_quality = "inferred"

        enriched_rows.append(
            {
                "employee_id": row["employee_id"],
                "location": row["location"],
                # EST columns — SME wall-clock, audit trail + UI only
                "start_est": row["start_est"],
                "end_est": row["end_est"],
                # UTC columns — canonical operational truth
                "start_utc": row["start_utc"],
                "end_utc": row["end_utc"],
                "duration_hours": row["duration_hours"],
                # shift_template replaces "position" — metadata only, not a model feature
                "shift_template": shift_template,
                # shift_type corrected to employee's local biological hour
                "shift_type": corrected_shift_type,
                "work_category": category,
                "match_quality": match_quality,
                "day_of_week": day_of_week,
                "is_weekend": is_weekend,
                # Employee's true local start hour (biological, for fatigue modeling)
                "local_start_hour": local_start_hour,
            }
        )

    enriched_df = pd.DataFrame(enriched_rows)

    print(f"  [OK] Processed {len(enriched_df)} shift records")
    print(f"  [OK] Employees: {enriched_df['employee_id'].nunique()}")
    print(f"  [OK] Match quality:")
    for quality, count in enriched_df["match_quality"].value_counts().items():
        print(f"      {quality}: {count}")

    # Bias-fix verification
    print("  [OK] shift_type by location (post-correction):")
    breakdown = (
        enriched_df.groupby(["location", "shift_type"]).size().reset_index(name="count")
    )
    for _, r in breakdown.iterrows():
        print(f"      {r['location']:10s} {r['shift_type']:8s}: {r['count']}")

    return enriched_df


# ============================================================================
# STEP 3: GENERATE FATIGUE TRAINING DATA (Pipeline 1)
# ============================================================================


def calculate_consecutive_days(df):
    """Calculate consecutive working days per employee."""
    consecutive = []
    current_streak = 0
    prev_employee = None

    for _, row in df.iterrows():
        if row["employee_id"] != prev_employee:
            current_streak = 1
            prev_employee = row["employee_id"]
        else:
            if row["rest_hours"] < 24:
                current_streak += 1
            else:
                current_streak = 1

        consecutive.append(current_streak)

    return consecutive


def add_rolling_features(df):
    """
    Add rolling window features with BOTH shift-based and time-based lookback.
    Shift-based: Last N shifts (regardless of time gap).
    Time-based:  Last N calendar days (includes rest days).
    """
    df = df.sort_values(["employee_id", "start_est"]).reset_index(drop=True)

    df["hours_worked_last_7_shifts"] = 0.0
    df["hours_worked_last_14_shifts"] = 0.0
    df["night_shifts_last_14_shifts"] = 0
    df["hours_worked_last_7_days"] = 0.0
    df["hours_worked_last_14_days"] = 0.0
    df["night_shifts_last_14_days"] = 0

    for emp_id in df["employee_id"].unique():
        emp_mask = df["employee_id"] == emp_id
        emp_indices = df[emp_mask].index
        emp_df = df.loc[emp_indices].copy()

        # Shift-based rolling (by row count)
        df.loc[emp_indices, "hours_worked_last_7_shifts"] = (
            df.loc[emp_indices, "duration_hours"]
            .rolling(window=7, min_periods=1)
            .sum()
            .values
        )

        df.loc[emp_indices, "hours_worked_last_14_shifts"] = (
            df.loc[emp_indices, "duration_hours"]
            .rolling(window=14, min_periods=1)
            .sum()
            .values
        )

        night_mask = df.loc[emp_indices, "shift_type"] == "night"
        df.loc[emp_indices, "night_shifts_last_14_shifts"] = (
            night_mask.astype(int).rolling(window=14, min_periods=1).sum().values
        )

        # Time-based rolling (by calendar days)
        for idx in emp_indices:
            current_time = df.loc[idx, "start_est"]

            time_window_7d = current_time - pd.Timedelta(days=7)
            recent_7d = emp_df[
                (emp_df["start_est"] > time_window_7d)
                & (emp_df["start_est"] <= current_time)
            ]
            df.loc[idx, "hours_worked_last_7_days"] = recent_7d["duration_hours"].sum()

            time_window_14d = current_time - pd.Timedelta(days=14)
            recent_14d = emp_df[
                (emp_df["start_est"] > time_window_14d)
                & (emp_df["start_est"] <= current_time)
            ]
            df.loc[idx, "hours_worked_last_14_days"] = recent_14d[
                "duration_hours"
            ].sum()

            night_14d = recent_14d[recent_14d["shift_type"] == "night"]
            df.loc[idx, "night_shifts_last_14_days"] = len(night_14d)

    return df


def generate_fatigue_dataset(enriched_df):
    """
    Pipeline 1: Employee-centric timeline for Fatigue LSTM.
    Target: Predict fatigue score (0-1) based on work history.
    """
    print("\nGenerating Fatigue Training Data (Pipeline 1)...")
    df = enriched_df.copy()

    df = df.sort_values(["employee_id", "start_est"]).reset_index(drop=True)

    # Calculate rest hours between shifts
    df["prev_end_est"] = df.groupby("employee_id")["end_est"].shift(1)
    df["rest_hours"] = (df["start_est"] - df["prev_end_est"]).dt.total_seconds() / 3600
    df["rest_hours"] = df["rest_hours"].fillna(DEFAULT_FIRST_SHIFT_REST)

    df["days_since_last_shift"] = df["rest_hours"] / 24.0

    df["consecutive_days"] = calculate_consecutive_days(df)

    df["shift_sequence_number"] = df.groupby("employee_id").cumcount() + 1

    df = add_rolling_features(df)

    # Temporal features
    df["day_of_month"] = df["start_est"].dt.day
    df["month"] = df["start_est"].dt.month
    df["week_of_year"] = df["start_est"].dt.isocalendar().week

    # local_start_hour is already on the enriched_df (correct biological hour)

    df["estimated_ticket_load"] = 1.0
    df["workload_intensity"] = df["estimated_ticket_load"] / df[
        "duration_hours"
    ].replace(0, 1)

    output_columns = [
        "employee_id",
        "location",
        "start_est",
        "end_est",
        "start_utc",
        "end_utc",
        "duration_hours",
        "shift_template",
        "shift_type",
        "work_category",
        "shift_sequence_number",
        "rest_hours",
        "days_since_last_shift",
        "consecutive_days",
        "hours_worked_last_7_shifts",
        "hours_worked_last_14_shifts",
        "hours_worked_last_7_days",
        "hours_worked_last_14_days",
        "night_shifts_last_14_shifts",
        "night_shifts_last_14_days",
        "day_of_week",
        "day_of_month",
        "month",
        "week_of_year",
        "is_weekend",
        "local_start_hour",
        "estimated_ticket_load",
        "workload_intensity",
        "match_quality",
    ]

    out_path = os.path.join(PROCESSED_DATA_PATH, "fatigue_training_data.csv")
    df[output_columns].to_csv(out_path, index=False)
    print(f"  [OK] Fatigue Data: {out_path}")
    print(f"  [OK] Total records: {len(df)}")

    return df


# ============================================================================
# STEP 4: GENERATE WORKLOAD TRAINING DATA (Pipeline 2)
# ============================================================================


def _parse_utc_time(time_str: str) -> int:
    """Parse 'HH:MM' string to integer hour (0-23)."""
    return int(time_str.split(":")[0])


def _assign_shift_type(local_start_hour: float, shift_types: list) -> str:
    """
    Return shift type name for a given local start hour using system_config rules.
    Mirrors the logic in availability.py _classify_shift_type.
    """
    for st in shift_types:
        lo = float(st["local_start_min"])
        hi = float(st["local_start_max"])
        if lo <= hi:
            if lo <= local_start_hour <= hi:
                return st["name"]
        else:
            # Wraps midnight (e.g. night: 22–4)
            if local_start_hour >= lo or local_start_hour <= hi:
                return st["name"]
    return "unknown"


def generate_workload_dataset(enriched_df):
    """
    Pipeline 2: Per-shift-type slot staffing levels for Workload LSTM.

    Produces one row per (shift_type, utc_date) tuple — three rows per UTC day
    (day / evening / night), ordered chronologically as a continuous timeline:
        day_slot_day1 → evening_slot_day1 → night_slot_day1 → day_slot_day2 → …

    The LSTM reads this as a continuous story: each slot's headcount leads into
    the next, allowing the model to learn cross-slot spillover patterns.

    UTC alignment
    -------------
    - shift_type is classified from the employee's local start hour (already
      stored in enriched_df["shift_type"], corrected per-region in Step 2).
    - utc_date is derived from start_utc — the canonical operational timestamp.
    - Shifts crossing UTC midnight are attributed to the UTC date of their start.

    Slot ordering within a UTC day
    --------------------------------
    day (0) → evening (1) → night (2)
    This reflects the real chronological order of UTC windows:
        day:     ~13:00–21:00 UTC
        evening: ~21:00–05:00 UTC
        night:   ~05:00–13:00 UTC  (belongs to the *next* UTC day's morning)
    """
    print("\nGenerating Workload Training Data (Pipeline 2)...")

    shift_types = _CFG["shift_types"]
    utc_offset_hours = _CFG["raw_data_utc_offset"]  # e.g. -5 for EST

    # ── 1. Build one record per (employee, shift occurrence) keyed by UTC date + shift_type
    slot_records = []
    for _, row in enriched_df.iterrows():
        # start_utc is already on enriched_df (added by process_humanity_data)
        utc_date = row["start_utc"].date()
        shift_type = row["shift_type"]  # already corrected to local biological hour
        slot_records.append(
            {
                "utc_date": utc_date,
                "shift_type": shift_type,
                "employee_id": row["employee_id"],
            }
        )

    slot_df = pd.DataFrame(slot_records)

    # ── 2. Aggregate headcount per (utc_date, shift_type)
    workload_df = (
        slot_df.groupby(["utc_date", "shift_type"])
        .agg(headcount=("employee_id", "nunique"))
        .reset_index()
    )

    # ── 3. Ensure every (utc_date, shift_type) combination exists — fill gaps with 0
    #       so the timeline is perfectly regular (no missing slots breaks the LSTM window)
    all_dates = pd.date_range(
        start=workload_df["utc_date"].min(),
        end=workload_df["utc_date"].max(),
        freq="D",
    ).date
    slot_type_names = [st["name"] for st in shift_types]  # ["day", "evening", "night"]

    full_index = pd.MultiIndex.from_product(
        [all_dates, slot_type_names], names=["utc_date", "shift_type"]
    )
    workload_df = (
        workload_df.set_index(["utc_date", "shift_type"])
        .reindex(full_index, fill_value=0)
        .reset_index()
    )

    # ── 4. Assign shift_type_ordinal for cyclical encoding (day=0, evening=1, night=2)
    ordinal_map = {name: i for i, name in enumerate(slot_type_names)}
    workload_df["shift_type_ordinal"] = workload_df["shift_type"].map(ordinal_map)

    # ── 5. Convert utc_date to datetime for temporal feature extraction
    workload_df["utc_date"] = pd.to_datetime(workload_df["utc_date"])

    # ── 6. Temporal features (derived from UTC date — canonical scheduling view)
    workload_df["day_of_week"] = workload_df["utc_date"].dt.dayofweek
    workload_df["day_of_month"] = workload_df["utc_date"].dt.day
    workload_df["month"] = workload_df["utc_date"].dt.month
    workload_df["is_weekend"] = (workload_df["day_of_week"] >= 5).astype(int)

    # ── 7. Sort into continuous chronological timeline: day → evening → night per UTC day
    workload_df = workload_df.sort_values(
        ["utc_date", "shift_type_ordinal"]
    ).reset_index(drop=True)

    # ── 8. Lag features — per shift_type stream (same-type slot N days ago)
    #       Group by shift_type so lags are within the same slot type's own series.
    #       shift_pos = position within sorted timeline; within each type the stride = 3 slots/day.
    SLOTS_PER_DAY = len(slot_type_names)  # 3

    def _same_type_lag(series: pd.Series, days: int) -> pd.Series:
        """Shift by days * SLOTS_PER_DAY positions within the same shift_type group."""
        return series.shift(days * SLOTS_PER_DAY)

    for shift_type_name in slot_type_names:
        mask = workload_df["shift_type"] == shift_type_name
        col = workload_df.loc[mask, "headcount"].copy()

        workload_df.loc[mask, "headcount_same_slot_1d_ago"] = _same_type_lag(
            col, 1
        ).values
        workload_df.loc[mask, "headcount_same_slot_7d_ago"] = _same_type_lag(
            col, 7
        ).values
        workload_df.loc[mask, "headcount_same_slot_28d_ago"] = _same_type_lag(
            col, 28
        ).values
        workload_df.loc[mask, "avg_headcount_last_4_same_slots"] = (
            col.rolling(window=4, min_periods=1).mean().values
        )

    # ── 9. Holiday placeholder (wired to data/holidays/ in a future PR)
    workload_df["is_holiday"] = 0

    # ── 10. Column ordering — target first (matches dataset.py convention)
    output_columns = [
        "utc_date",
        "shift_type",
        "shift_type_ordinal",
        "headcount",
        "day_of_week",
        "day_of_month",
        "month",
        "is_weekend",
        "is_holiday",
        "headcount_same_slot_1d_ago",
        "headcount_same_slot_7d_ago",
        "headcount_same_slot_28d_ago",
        "avg_headcount_last_4_same_slots",
    ]
    workload_df = workload_df[output_columns]

    out_path = os.path.join(PROCESSED_DATA_PATH, "workload_training_data.csv")
    workload_df.to_csv(out_path, index=False)
    print(f"  [OK] Workload Data: {out_path}")
    print(
        f"  [OK] Total slot records: {len(workload_df)} ({len(workload_df) // SLOTS_PER_DAY} UTC days × {SLOTS_PER_DAY} shift types)"
    )

    return workload_df


# ============================================================================
# STEP 5: GENERATE QUALITY REPORT
# ============================================================================


def generate_quality_report(enriched_df):
    """Generate data quality metrics."""
    print("\nGenerating Quality Report...")

    # shift_type breakdown per location (key verification metric)
    shift_type_by_location = {}
    for loc in enriched_df["location"].unique():
        loc_df = enriched_df[enriched_df["location"] == loc]
        shift_type_by_location[loc] = loc_df["shift_type"].value_counts().to_dict()

    report = {
        "total_shifts": int(len(enriched_df)),
        "employees": int(enriched_df["employee_id"].nunique()),
        "date_range": {
            "start": enriched_df["start_est"].min().strftime("%Y-%m-%d"),
            "end": enriched_df["end_est"].max().strftime("%Y-%m-%d"),
        },
        "match_quality": enriched_df["match_quality"].value_counts().to_dict(),
        "shift_type_distribution": enriched_df["shift_type"].value_counts().to_dict(),
        "shift_type_by_location": shift_type_by_location,
        "avg_shift_duration": float(enriched_df["duration_hours"].mean()),
        "total_hours_worked": float(enriched_df["duration_hours"].sum()),
        "unmapped_shifts_count": int(
            (enriched_df["shift_template"] == "Custom/Unmatched").sum()
        ),
        "employees_list": sorted(enriched_df["employee_id"].unique().tolist()),
    }

    report_path = os.path.join(PROCESSED_DATA_PATH, "preprocessing_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"  [OK] Quality Report: {report_path}")

    # Print the key bias-fix verification table
    print("  [OK] shift_type_by_location summary:")
    for loc, dist in shift_type_by_location.items():
        print(f"      {loc}: {dist}")

    return report


# ============================================================================
# MAIN ORCHESTRATOR
# ============================================================================


def main():
    """Run full preprocessing pipeline."""
    print("=" * 70)
    print("AI SCHEDULER - PREPROCESSING PIPELINE")
    print("=" * 70)
    print()

    os.makedirs(PROCESSED_DATA_PATH, exist_ok=True)

    print("[1/5] Loading shift metadata from Schedule-2025...")
    metadata_lookup = load_shift_metadata()
    print()

    print("[2/5] Processing Humanity export & injecting metadata...")
    enriched_df = process_humanity_data(metadata_lookup)

    if enriched_df.empty:
        print("ERROR: No data to process. Exiting.")
        return

    print()

    print("[3/5] Generating Fatigue training dataset...")
    fatigue_df = generate_fatigue_dataset(enriched_df)

    print("[4/5] Generating Workload training dataset...")
    workload_df = generate_workload_dataset(enriched_df)

    print("[5/5] Generating quality report...")
    report = generate_quality_report(enriched_df)

    print()
    print("=" * 70)
    print("PREPROCESSING COMPLETE!")
    print("=" * 70)
    print(f"Fatigue Dataset:  {len(fatigue_df)} shift records")
    print(f"Workload Dataset: {len(workload_df)} slot records")
    print(
        f"Date Range: {report['date_range']['start']} to {report['date_range']['end']}"
    )
    print(f"Employees: {report['employees']}")
    print()
    print("Output files:")
    print(f"  • {os.path.join(PROCESSED_DATA_PATH, 'fatigue_training_data.csv')}")
    print(f"  • {os.path.join(PROCESSED_DATA_PATH, 'workload_training_data.csv')}")
    print(f"  • {os.path.join(PROCESSED_DATA_PATH, 'preprocessing_report.json')}")
    print()
    print("Next steps:")
    print("  1. Review preprocessing_report.json — check shift_type_by_location")
    print("  2. Build Fatigue LSTM in ml/src/fatigue/")


if __name__ == "__main__":
    main()
