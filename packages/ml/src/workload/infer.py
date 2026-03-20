"""
Forward-looking inference for the Workload Forecaster LSTM.

Produces required headcount per (utc_date, shift_type) slot for a future date
range by autoregressively rolling the trained model forward from the CSV tail.

Public API
----------
    from src.workload.infer import forecast_shift_demand

    points = forecast_shift_demand(
        start_date=date(2026, 4, 1),
        num_days=91,
    )
    # → [{"utc_date": "2026-04-01", "shift_type": "day",
    #     "required_headcount": 5, "source": "forecast"}, ...]

Algorithm
---------
1. Load trained model + scaler from ml/models/.
2. Read the last SEQUENCE_LENGTH (168) rows from workload_training_data.csv
   as the seed context window (already scaled via the saved scaler).
3. For each future slot (num_days × 3 steps):
   a. Build a feature row for the target date/shift_type using the same
      13-column schema the model was trained on:
        [headcount, is_weekend, is_holiday,
         slot_sin, slot_cos, dow_sin, dow_cos, month_sin, month_cos,
         lag_1d, lag_7d, lag_28d, avg_last_4]
      The headcount column is filled with the *previous prediction* (autoregressive).
      Lag features are derived from the rolling prediction history.
   b. Scale the row with the loaded scaler.
   c. Run model.predict on the rolling (1, SEQUENCE_LENGTH, 13) window.
   d. Invert-scale the prediction → round to nearest int, floor at 0.
   e. Append the new scaled row to the rolling window (drop oldest).
4. Return list of ShiftDemandPoint-compatible dicts.

Notes
-----
- is_holiday defaults to 0 for all future dates (no 2026 holiday file yet).
  This is conservative — the model will use lag/seasonal features for demand.
- The seed window uses actual 2025 data, so the first ~56 days of predictions
  benefit from real seasonal context.
- day_of_month is NOT a model feature (excluded during training), so it is not
  needed here.
"""

from __future__ import annotations

import os
import pickle
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from .config import (
    MODEL_SAVE_PATH,
    SCALER_SAVE_PATH,
    SEQUENCE_LENGTH,
    SHIFT_TYPE_NAMES,
    SLOTS_PER_DAY,
    WORKLOAD_CSV,
)
from .dataset import encode_cyclical_features, get_encoded_feature_columns

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Lag offsets in slot positions (3 slots/day)
_LAG_1D = 3  # same shift type, 1 day ago  = 3 slots back
_LAG_7D = 21  # same shift type, 7 days ago = 21 slots back
_LAG_28D = 84  # same shift type, 28 days ago = 84 slots back
_ROLLING_4 = 4  # rolling 4-slot mean (same shift type, so every 3rd position)

# Column index of headcount in the final scaled feature matrix (column 0)
_HC_COL = 0


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _load_artifacts() -> tuple[Any, Any]:
    """Load (model, scaler) from ml/models/. Raises FileNotFoundError if missing."""
    if not os.path.exists(MODEL_SAVE_PATH):
        raise FileNotFoundError(
            f"Workload LSTM model not found at {MODEL_SAVE_PATH}. "
            "Run `uv run python -m src.workload.run_training` first."
        )
    if not os.path.exists(SCALER_SAVE_PATH):
        raise FileNotFoundError(
            f"Workload scaler not found at {SCALER_SAVE_PATH}. "
            "Run `uv run python -m src.workload.run_training` first."
        )
    # Lazy import TensorFlow — only at call time, not at module import.
    import tensorflow as tf  # noqa: PLC0415

    model = tf.keras.models.load_model(MODEL_SAVE_PATH)
    with open(SCALER_SAVE_PATH, "rb") as fh:
        scaler = pickle.load(fh)
    return model, scaler


def _invert_headcount(scaled_val: float, scaler) -> int:
    """Invert MinMaxScaler for the headcount column (column 0) only."""
    dummy = np.zeros((1, scaler.n_features_in_))
    dummy[0, _HC_COL] = scaled_val
    raw = scaler.inverse_transform(dummy)[0, _HC_COL]
    return max(0, int(round(float(raw))))


def _scale_row(row: np.ndarray, scaler) -> np.ndarray:
    """Scale a single feature row using the fitted scaler (transform only)."""
    return scaler.transform(row.reshape(1, -1))[0]


def _build_seed_window(scaler) -> np.ndarray:
    """
    Load the last SEQUENCE_LENGTH rows from workload_training_data.csv,
    apply the same feature engineering used during training, and scale them.

    Returns: shape (SEQUENCE_LENGTH, n_features) float32 array.
    """
    from .config import FEATURE_COLUMNS, LAG_FEATURE_COLUMNS  # noqa: PLC0415

    df = pd.read_csv(WORKLOAD_CSV, parse_dates=["utc_date"])
    df = df.sort_values(["utc_date", "shift_type_ordinal"]).reset_index(drop=True)

    # Take the last SEQUENCE_LENGTH rows as seed
    seed_df = df.tail(SEQUENCE_LENGTH).copy()

    # Apply same feature pipeline as dataset.py
    seed_df = seed_df[FEATURE_COLUMNS + LAG_FEATURE_COLUMNS].copy()
    seed_df[LAG_FEATURE_COLUMNS] = seed_df[LAG_FEATURE_COLUMNS].fillna(0)
    seed_df["is_weekend"] = seed_df["is_weekend"].astype(int)
    seed_df["is_holiday"] = seed_df["is_holiday"].astype(int)
    seed_df = encode_cyclical_features(seed_df)

    # Reorder columns to match training order
    from .dataset import get_encoded_feature_columns  # noqa: PLC0415
    from .config import TARGET_COLUMN  # noqa: PLC0415

    encoded_cols = get_encoded_feature_columns()
    cols_ordered = [TARGET_COLUMN] + [c for c in encoded_cols if c != TARGET_COLUMN]
    seed_df = seed_df[cols_ordered]

    # Scale using the loaded (already-fitted) scaler — transform only, not fit
    scaled = scaler.transform(seed_df.values.astype(float))
    return scaled.astype(np.float32)


def _feature_row_unscaled(
    target_date: date,
    shift_type_ordinal: int,
    predicted_headcount: float,
    pred_history: list[
        float
    ],  # raw (unscaled) headcount predictions so far, oldest first
) -> np.ndarray:
    """
    Build a single unscaled feature row for (target_date, shift_type_ordinal).

    Column order must match the training schema (TARGET_COLUMN first, then others):
      [headcount, is_weekend, is_holiday,
       slot_sin, slot_cos, dow_sin, dow_cos, month_sin, month_cos,
       lag_1d, lag_7d, lag_28d, avg_last_4]
    Total: 13 columns.

    pred_history: list of raw headcount predictions appended in chronological
    slot order (newest last). Used to compute lag features during rollout.
    We index from the END:
      lag_1d  = pred_history[-3]  (same shift type, 1 day back = 3 slots back)
      lag_7d  = pred_history[-21]
      lag_28d = pred_history[-84]
      avg_4   = mean of pred_history[-3], pred_history[-6], pred_history[-9], pred_history[-12]
                (same shift type, last 4 occurrences = every 3rd slot)
    """
    dow = target_date.weekday()  # 0=Mon … 6=Sun
    month = target_date.month  # 1–12
    is_weekend = int(dow >= 5)
    is_holiday = 0  # default — no 2026 holiday file available

    # Cyclical encodings
    slot_sin = float(np.sin(2 * np.pi * shift_type_ordinal / 3))
    slot_cos = float(np.cos(2 * np.pi * shift_type_ordinal / 3))
    dow_sin = float(np.sin(2 * np.pi * dow / 7))
    dow_cos = float(np.cos(2 * np.pi * dow / 7))
    month_sin = float(np.sin(2 * np.pi * (month - 1) / 12))
    month_cos = float(np.cos(2 * np.pi * (month - 1) / 12))

    def _lag(n: int) -> float:
        """Return pred_history[-(n)] if available, else 0."""
        if len(pred_history) >= n:
            return pred_history[-n]
        return 0.0

    lag_1d = _lag(_LAG_1D)
    lag_7d = _lag(_LAG_7D)
    lag_28d = _lag(_LAG_28D)

    # Rolling mean of the 4 most-recent same-shift-type occurrences
    same_type_lags = [_lag(_LAG_1D * i) for i in range(1, _ROLLING_4 + 1)]
    avg_last_4 = float(np.mean(same_type_lags))

    return np.array(
        [
            predicted_headcount,  # headcount (autoregressive — will be replaced by prediction)
            is_weekend,
            is_holiday,
            slot_sin,
            slot_cos,
            dow_sin,
            dow_cos,
            month_sin,
            month_cos,
            lag_1d,
            lag_7d,
            lag_28d,
            avg_last_4,
        ],
        dtype=np.float64,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def forecast_shift_demand(
    start_date: date,
    num_days: int,
) -> list[dict]:
    """
    Run the trained Workload LSTM forward for `num_days` days starting from
    `start_date` and return per-slot headcount forecasts.

    Args:
        start_date: First UTC date to forecast (inclusive).
        num_days:   Number of calendar days to forecast. Each day produces
                    3 rows (day / evening / night).

    Returns:
        List of dicts, one per (utc_date, shift_type) slot, ordered
        chronologically (day → evening → night within each day):
        [
          {
            "utc_date":           "2026-04-01",
            "shift_type":         "day",       # "day" | "evening" | "night"
            "required_headcount": 5,           # non-negative integer
            "source":             "forecast",
          },
          ...
        ]

    Raises:
        FileNotFoundError: if model or scaler files are not present.
    """
    model, scaler = _load_artifacts()

    # Seed rolling window from CSV tail
    window: np.ndarray = _build_seed_window(scaler)  # (SEQUENCE_LENGTH, 13)

    # Raw (unscaled) prediction history — used to build lag features during rollout.
    # Pre-populate from the seed window by inverting the headcount column.
    raw_history: list[float] = [
        _invert_headcount(float(window[i, _HC_COL]), scaler) for i in range(len(window))
    ]

    results: list[dict] = []
    total_slots = num_days * SLOTS_PER_DAY

    for step in range(total_slots):
        day_offset = step // SLOTS_PER_DAY
        slot_ordinal = step % SLOTS_PER_DAY  # 0=day, 1=evening, 2=night
        target_date = start_date + timedelta(days=day_offset)
        shift_type = SHIFT_TYPE_NAMES[slot_ordinal]

        # ── Build unscaled feature row using last raw prediction as headcount seed
        last_raw_hc = raw_history[-1] if raw_history else 0.0
        unscaled_row = _feature_row_unscaled(
            target_date=target_date,
            shift_type_ordinal=slot_ordinal,
            predicted_headcount=last_raw_hc,
            pred_history=raw_history,
        )

        # ── Scale the row
        scaled_row = _scale_row(unscaled_row, scaler)  # (13,)

        # ── Append to rolling window, drop oldest
        window = np.vstack(
            [window[1:], scaled_row[np.newaxis, :]]
        )  # (SEQUENCE_LENGTH, 13)

        # ── Predict next headcount from the updated window
        X = window[np.newaxis, :, :].astype(np.float32)  # (1, 168, 13)
        y_scaled = float(model.predict(X, verbose=0)[0, 0])

        # ── Invert scale → round to int
        y_raw = _invert_headcount(y_scaled, scaler)
        raw_history.append(float(y_raw))

        results.append(
            {
                "utc_date": target_date.isoformat(),
                "shift_type": shift_type,
                "required_headcount": y_raw,
                "source": "forecast",
            }
        )

    return results


# ---------------------------------------------------------------------------
# CLI smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from datetime import date as _date
    import json

    print("Running forecast_shift_demand smoke test (7 days)...")
    pts = forecast_shift_demand(start_date=_date(2026, 4, 1), num_days=7)
    print(f"Produced {len(pts)} slot forecasts:")
    print(json.dumps(pts, indent=2))
