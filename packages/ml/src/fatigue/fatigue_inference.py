import pickle
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import numpy as np
import pandas as pd
import tensorflow as tf

from fatigue_data import engineer_shift_features, compute_fatigue_index, build_sequences


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODELS_DIR = PROJECT_ROOT / "models"


def load_artifacts(models_dir: Path = DEFAULT_MODELS_DIR) -> tuple[tf.keras.Model, Dict[str, Any]]:
    model = tf.keras.models.load_model(models_dir / "fatigue_lstm.keras")
    with open(models_dir / "fatigue_preprocess.pkl", "rb") as f:
        preprocess = pickle.load(f)
    return model, preprocess


def _ensure_min_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Make the input robust for service usage:
    Required-ish: employee_id, start_utc, end_utc, shift_type
    Optional: duration_hours, start_hour_local, is_weekend, rest_hours, consecutive_days
    If optional fields are missing, compute simple versions.
    """
    out = df.copy()

    # Parse timestamps (allow strings or datetimes)
    out["start_utc"] = pd.to_datetime(out["start_utc"], utc=True)
    out["end_utc"] = pd.to_datetime(out["end_utc"], utc=True)

    if "duration_hours" not in out.columns:
        out["duration_hours"] = (out["end_utc"] - out["start_utc"]).dt.total_seconds() / 3600.0

    if "start_hour_local" not in out.columns:
        # If you don't have local time, UTC hour is a reasonable fallback for demo
        out["start_hour_local"] = out["start_utc"].dt.hour

    if "is_weekend" not in out.columns:
        out["is_weekend"] = (out["start_utc"].dt.weekday >= 5).astype(int)

    # Sort per employee before computing streak/rest
    out = out.sort_values(["employee_id", "start_utc"]).reset_index(drop=True)

    if "rest_hours" not in out.columns:
        prev_end = out.groupby("employee_id")["end_utc"].shift(1)
        rest = (out["start_utc"] - prev_end).dt.total_seconds() / 3600.0
        out["rest_hours"] = rest.fillna(16.0)

    if "consecutive_days" not in out.columns:
        # Simple consecutive-day streak based on date difference of starts
        out["start_date"] = out["start_utc"].dt.date
        prev_date = out.groupby("employee_id")["start_date"].shift(1)
        day_diff = (pd.to_datetime(out["start_date"]) - pd.to_datetime(prev_date)).dt.days

        streak = []
        current = 1
        for d in day_diff.fillna(9999).tolist():
            if d == 1:
                current += 1
            else:
                current = 1
            streak.append(float(current))
        out["consecutive_days"] = streak
        out = out.drop(columns=["start_date"])

    return out


def _scale_sequence(seq_14xF: np.ndarray, preprocess: Dict[str, Any]) -> np.ndarray:
    window = int(preprocess["window"])
    means = np.asarray(preprocess["means"], dtype=np.float32)
    stds = np.asarray(preprocess["stds"], dtype=np.float32)
    numeric_idx = list(preprocess["numeric_feature_indices"])

    if seq_14xF.shape[0] != window:
        raise ValueError(f"Expected window={window} timesteps, got {seq_14xF.shape[0]}")
    if seq_14xF.shape[1] != means.shape[0]:
        raise ValueError(f"Expected F={means.shape[0]} features, got {seq_14xF.shape[1]}")

    x = seq_14xF.astype(np.float32, copy=True)
    for j in numeric_idx:
        x[:, j] = (x[:, j] - means[j]) / (stds[j] + 1e-6)

    return x.reshape(1, window, x.shape[1])


def predict_fatigue(payload: Dict[str, Any], models_dir: Path = DEFAULT_MODELS_DIR) -> Dict[str, Any]:
    """
    Payload shape (JSON):
    {
      "employee_id": "E1",
      "shifts": [
        {"start_utc": "...", "end_utc": "...", "shift_type": "day", ...},
        ...
      ]
    }

    Returns:
    {
      "employee_id": "...",
      "predicted_fatigue": 0.123,
      "window_used": 14
    }
    """
    model, preprocess = load_artifacts(models_dir=models_dir)
    window = int(preprocess["window"])

    emp_id = payload.get("employee_id")
    shifts = payload.get("shifts")

    if not emp_id or not shifts:
        raise ValueError("payload must include 'employee_id' and non-empty 'shifts'")

    df = pd.DataFrame(shifts)
    df["employee_id"] = emp_id  # force consistent employee_id

    df = _ensure_min_columns(df)

    if len(df) < window:
        raise ValueError(f"Need at least {window} shifts, got {len(df)}")

    # Use the same feature pipeline as training
    df2 = engineer_shift_features(df)
    df2 = compute_fatigue_index(df2)

    X, _, meta, feature_names, _ = build_sequences(df2, window=window)

    # Feature order safety check
    if feature_names != list(preprocess["feature_names"]):
        raise ValueError("Feature order mismatch between artifacts and pipeline.")

    # Pick the latest sequence
    last_idx = meta["start_utc"].sort_values().index[-1]
    seq = X[last_idx]  # (14, F)

    x_scaled = _scale_sequence(seq, preprocess)
    pred = float(model.predict(x_scaled, verbose=0).reshape(-1)[0])

    return {"employee_id": emp_id, "predicted_fatigue": pred, "window_used": window}