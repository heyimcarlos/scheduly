"""
Dataset builder for the Workload Forecaster LSTM.

Granularity: one row per (utc_date, shift_type) slot — three rows per UTC day,
ordered chronologically: day(0) → evening(1) → night(2).

Responsibilities:
  1. Load workload_training_data.csv
  2. Encode cyclical features: shift_type_ordinal (period 3), day_of_week (period 7),
     month (period 12) → sin/cos pairs
  3. Include lag features (same-slot 1d/7d/28d ago, rolling 4-slot mean)
  4. Scale all features with MinMaxScaler
  5. Slice into (X, y) sequences of length SEQUENCE_LENGTH (168 slots = 56 days)
  6. Split into train / val sets preserving chronological order
"""

import os
import pickle

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler

from .config import (
    FEATURE_COLUMNS,
    FORECAST_HORIZON,
    LAG_FEATURE_COLUMNS,
    MODELS_DIR,
    SCALER_SAVE_PATH,
    SEQUENCE_LENGTH,
    SHIFT_TYPE_NAMES,
    TARGET_COLUMN,
    TRAIN_RATIO,
    WORKLOAD_CSV,
)


# ── Cyclical encoding helpers ─────────────────────────────────────────────────


def _sin_cos(series: pd.Series, period: float):
    """Encode a cyclic feature as (sin, cos) pair."""
    angle = 2 * np.pi * series / period
    return np.sin(angle), np.cos(angle)


def encode_cyclical_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Replace raw cyclical integer columns with their sin/cos encodings.

    Columns encoded:
      - shift_type_ordinal (period 3): day=0, evening=1, night=2
        Ensures the model sees night(2) as adjacent to day(0) of the next day.
      - day_of_week (period 7): Monday=0 ... Sunday=6
      - month (period 12): Jan=1 ... Dec=12

    Raw integer columns are dropped after encoding.
    """
    df = df.copy()

    sin_slot, cos_slot = _sin_cos(df["shift_type_ordinal"], 3)
    df["slot_sin"] = sin_slot
    df["slot_cos"] = cos_slot

    sin_dow, cos_dow = _sin_cos(df["day_of_week"], 7)
    df["dow_sin"] = sin_dow
    df["dow_cos"] = cos_dow

    sin_month, cos_month = _sin_cos(df["month"], 12)
    df["month_sin"] = sin_month
    df["month_cos"] = cos_month

    # Drop the raw integer versions — represented by sin/cos pairs
    df = df.drop(columns=["shift_type_ordinal", "day_of_week", "month"])

    return df


def get_encoded_feature_columns() -> list[str]:
    """
    Returns the final list of feature column names after cyclical encoding.

    Replaces 3 raw cyclical columns with 6 sin/cos columns, appends lag columns.
    Total: (len(FEATURE_COLUMNS) - 3 raw cyclical + 6 sin/cos) + len(LAG_FEATURE_COLUMNS)
         = (6 - 3 + 6) + 4 = 13 features
    """
    base = [
        c
        for c in FEATURE_COLUMNS
        if c not in ("shift_type_ordinal", "day_of_week", "month")
    ]
    cyclical = ["slot_sin", "slot_cos", "dow_sin", "dow_cos", "month_sin", "month_cos"]
    return base + cyclical + LAG_FEATURE_COLUMNS


def load_and_prepare(
    verbose: bool = True,
    scaler_save_path: str | None = None,
) -> tuple[np.ndarray, np.ndarray, MinMaxScaler]:
    """
    Load CSV, engineer features, scale, and return:
      - feature_array : shape (T, n_features)  — all encoded+scaled features
      - target_array  : shape (T,)              — scaled headcount
      - scaler        : fitted MinMaxScaler (needed to invert predictions later)

    The target (headcount) is the FIRST column in feature_array so sequence
    slicing remains simple and consistent with the original design.

    NaN rows at the start of the lag columns fall entirely within the first
    SEQUENCE_LENGTH rows used only as lookback context and never appear as
    prediction targets, so filling them with 0 is safe.

    Args:
        scaler_save_path: Override where the scaler is pickled.
    """
    save_path = scaler_save_path or SCALER_SAVE_PATH

    df = pd.read_csv(WORKLOAD_CSV, parse_dates=["utc_date"])
    df = df.sort_values(["utc_date", "shift_type_ordinal"]).reset_index(drop=True)

    if verbose:
        n_days = df["utc_date"].nunique()
        print(
            f"  Rows: {len(df)}  |  UTC days: {n_days}"
            f"  |  Date range: {df['utc_date'].min().date()} to {df['utc_date'].max().date()}"
        )

    # ── Select feature + lag columns
    df = df[FEATURE_COLUMNS + LAG_FEATURE_COLUMNS].copy()

    # ── Fill NaNs in lag columns with 0
    df[LAG_FEATURE_COLUMNS] = df[LAG_FEATURE_COLUMNS].fillna(0)
    if verbose:
        print(f"  Lag features: {LAG_FEATURE_COLUMNS} (NaNs filled with 0)")

    # ── Cast booleans to int
    df["is_weekend"] = df["is_weekend"].astype(int)
    df["is_holiday"] = df["is_holiday"].astype(int)

    # ── Cyclical encoding
    df = encode_cyclical_features(df)

    # ── Confirm column order: target first, then everything else
    encoded_cols = get_encoded_feature_columns()
    cols_ordered = [TARGET_COLUMN] + [c for c in encoded_cols if c != TARGET_COLUMN]
    df = df[cols_ordered]

    if verbose:
        print(f"  Features ({len(cols_ordered)}): {cols_ordered}")

    # ── Scale all features to [0, 1]
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled = scaler.fit_transform(df.values)

    # ── Save scaler so inference can invert the target scaling
    os.makedirs(MODELS_DIR, exist_ok=True)
    with open(save_path, "wb") as f:
        pickle.dump(scaler, f)

    if verbose:
        print(f"  Scaler saved: {save_path}")

    feature_array = scaled  # (T, n_features)
    target_array = scaled[:, 0]  # (T,) — scaled headcount

    return feature_array, target_array, scaler


# ── Sequence windowing ────────────────────────────────────────────────────────


def make_sequences(
    feature_array: np.ndarray,
    target_array: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Slice into overlapping windows.

    For each timestep t (starting at SEQUENCE_LENGTH):
      X[i] = feature_array[t - SEQUENCE_LENGTH : t]   shape: (SEQUENCE_LENGTH, n_features)
      y[i] = target_array[t]                           shape: scalar

    At 3 slots/day, SEQUENCE_LENGTH=168 means each window spans 56 days of
    context — 8 full weeks of history for every shift type.

    Returns:
      X : (n_samples, SEQUENCE_LENGTH, n_features)
      y : (n_samples,)
    """
    X, y = [], []
    for t in range(SEQUENCE_LENGTH, len(feature_array) - FORECAST_HORIZON + 1):
        X.append(feature_array[t - SEQUENCE_LENGTH : t])
        y.append(target_array[t + FORECAST_HORIZON - 1])

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


# ── Train / Val split ─────────────────────────────────────────────────────────


def train_val_split(
    X: np.ndarray,
    y: np.ndarray,
    verbose: bool = True,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Chronological split — no shuffling.
    Returns (X_train, y_train, X_val, y_val).
    """
    split = int(len(X) * TRAIN_RATIO)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    if verbose:
        print(f"  Train sequences: {len(X_train)}")
        print(f"  Val   sequences: {len(X_val)}")

    return X_train, y_train, X_val, y_val


def build_datasets(
    verbose: bool = True,
    scaler_save_path: str | None = None,
):
    """
    Run the full dataset pipeline.

    Args:
        scaler_save_path: Override scaler save path.

    Returns:
        X_train, y_train, X_val, y_val, scaler
    """
    feature_array, target_array, scaler = load_and_prepare(
        verbose=verbose,
        scaler_save_path=scaler_save_path,
    )
    X, y = make_sequences(feature_array, target_array)

    if verbose:
        print(f"\n  Total sequences: {len(X)}")
        print(
            f"  Sequence shape:  {X.shape}  (samples, timesteps={SEQUENCE_LENGTH}, features)"
        )

    X_train, y_train, X_val, y_val = train_val_split(X, y, verbose=verbose)

    return X_train, y_train, X_val, y_val, scaler
