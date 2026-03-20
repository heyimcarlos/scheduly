# fatigue_scorer.py
"""
Script for the Fatigue Scorer:
- Uses fatigue_data.py to load + preprocess + compute a rules-based fatigue_index
- Trains a small TensorFlow/Keras LSTM to predict fatigue_index from the last 14 shifts
- Writes outputs for the team + optimizer integration

Outputs (created inside ./outputs/):
- fatigue_scored_shifts.csv
- fatigue_predicted_shifts.csv
- fatigue_current_by_employee.csv
"""

from __future__ import annotations

import os
from pathlib import Path
import pickle
from typing import List, Tuple

# Configure TensorFlow to use CPU only to avoid CuDNN version mismatch
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks

from fatigue_data import prepare_fatigue_data
from plotting import plot_training_history, plot_pred_vs_true, plot_employee_timeseries

tf.config.set_visible_devices([], 'GPU')

# ----------------------------
# Config
# ----------------------------

WINDOW = 14
EPOCHS = 30
BATCH_SIZE = 32
VAL_FRAC = 0.20
SEED = 42

OUTPUT_DIR = Path(__file__).parent / "outputs"
ML_DIR = Path(__file__).resolve().parents[2]
MODELS_DIR = ML_DIR / "models"


# ----------------------------
# Helpers: split + scaling
# ----------------------------

def time_based_split(meta: pd.DataFrame, val_frac: float = 0.20) -> Tuple[np.ndarray, np.ndarray]:
    """
    Time-aware split: last X% of sequences (by start_utc) become validation.
    """
    m = meta.sort_values("start_utc").reset_index(drop=True)
    split_idx = int(len(m) * (1.0 - val_frac))
    idx_train = m.index < split_idx
    # Return boolean masks aligned to meta's ORIGINAL order
    # We'll just build masks by comparing timestamps to split time:
    split_time = m.loc[split_idx - 1, "start_utc"] if split_idx > 0 else m["start_utc"].min()
    train_mask = meta["start_utc"] <= split_time
    val_mask = meta["start_utc"] > split_time
    return train_mask.values, val_mask.values


def standardize_features(
    X: np.ndarray,
    train_mask: np.ndarray,
    numeric_idx: List[int],
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Standardize only the numeric features across all timesteps.
    Returns scaled X plus mean/std for potential reuse.
    """
    Xs = X.copy()
    # Flatten only train sequences for mean/std
    train_X = Xs[train_mask]  # (N_train, window, F)

    means = np.zeros((Xs.shape[2],), dtype=np.float32)
    stds = np.ones((Xs.shape[2],), dtype=np.float32)

    for j in numeric_idx:
        vals = train_X[:, :, j].reshape(-1)
        means[j] = float(vals.mean())
        stds[j] = float(vals.std() + 1e-6)

        Xs[:, :, j] = (Xs[:, :, j] - means[j]) / stds[j]

    return Xs, means, stds


# ----------------------------
# Model
# ----------------------------

def build_lstm_model(window: int, num_features: int) -> tf.keras.Model:
    """
    Simple LSTM regressor:
    Input: last `window` shifts with engineered features
    Output: predicted fatigue_index for the final (current) shift
    """
    inp = layers.Input(shape=(window, num_features))
    x = layers.LSTM(64)(inp)
    x = layers.Dense(32, activation="relu")(x)
    out = layers.Dense(1, activation="sigmoid")(x)

    model = models.Model(inp, out)
    model.compile(optimizer="adam", loss="mse", metrics=["mae"])
    return model


# ----------------------------
# Main
# ----------------------------

def main() -> None:
    np.random.seed(SEED)
    tf.random.set_seed(SEED)

    # Locate CSV (default: fatigue_training_data.csv in same folder)
    csv_path = Path(__file__).parent / "fatigue_training_data.csv"

    prepared = prepare_fatigue_data(str(csv_path), window=WINDOW)
    df = prepared.df
    X = prepared.X
    y = prepared.y
    meta = prepared.meta
    numeric_idx = prepared.numeric_feature_indices

    if len(X) == 0:
        raise RuntimeError("No sequences produced. Check window size and input data.")

    train_mask, val_mask = time_based_split(meta, val_frac=VAL_FRAC)
    Xs, means, stds = standardize_features(X, train_mask=train_mask, numeric_idx=numeric_idx)

    # Build model
    model = build_lstm_model(window=WINDOW, num_features=Xs.shape[2])

    # Train
    es = callbacks.EarlyStopping(
        monitor="val_loss",
        patience=5,
        restore_best_weights=True,
        verbose=1,
    )

    history = model.fit(
        Xs[train_mask],
        y[train_mask],
        validation_data=(Xs[val_mask], y[val_mask]),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        verbose=2,
        callbacks=[es],
    )

    # Predict per-shift (one prediction per sequence/target shift)
    pred = model.predict(Xs, verbose=0).reshape(-1)

    meta_out = meta.copy()
    meta_out["predicted_fatigue"] = pred

    # Merge back to shifts: assign prediction to matching (employee_id, start_utc, end_utc)
    scored = df.merge(
        meta_out[["employee_id", "start_utc", "end_utc", "predicted_fatigue"]],
        on=["employee_id", "start_utc", "end_utc"],
        how="left",
    )

    # Output folder
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    scored_path = OUTPUT_DIR / "fatigue_scored_shifts.csv"
    predicted_path = OUTPUT_DIR / "fatigue_predicted_shifts.csv"
    current_path = OUTPUT_DIR / "fatigue_current_by_employee.csv"

    scored.to_csv(scored_path, index=False)
    meta_out.to_csv(predicted_path, index=False)

    # Save model + preprocess artifacts for inference
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    model.save(MODELS_DIR / "fatigue_lstm.keras")

    preprocess = {
        "window": WINDOW,
        "feature_names": prepared.feature_names,
        "numeric_feature_indices": numeric_idx,
        "means": means,
        "stds": stds,
    }

    with open(MODELS_DIR / "fatigue_preprocess.pkl", "wb") as f:
        pickle.dump(preprocess, f)

    print(f"Saved model to: {MODELS_DIR / 'fatigue_lstm.keras'}")
    print(f"Saved preprocess to: {MODELS_DIR / 'fatigue_preprocess.pkl'}")

    # Diagnostics plots
    plot_training_history(history.history, OUTPUT_DIR)

    # All sequences
    plot_pred_vs_true(meta, pred, OUTPUT_DIR, tag="all")

    # Validation-only sequences (time-based split)
    plot_pred_vs_true(meta[val_mask], pred[val_mask], OUTPUT_DIR, tag="val")

    # Time series for top-N employees by latest fatigue_index
    plot_employee_timeseries(meta, pred, OUTPUT_DIR, top_n=3)

    # Latest fatigue per employee
    latest = scored.sort_values(["employee_id", "start_utc"]).groupby("employee_id").tail(1)
    latest = latest[["employee_id", "fatigue_index", "predicted_fatigue"]].sort_values("predicted_fatigue", ascending=False)
    latest.to_csv(current_path, index=False)

    # Console summary
    print("=" * 60)
    print("SUMMARY (Fatigue Scorer)")
    print("=" * 60)
    print(f"Total shifts: {len(df)}")
    print(f"Total employees: {df['employee_id'].nunique()}")
    print(f"Fatigue index: min={df['fatigue_index'].min():.3f}, mean={df['fatigue_index'].mean():.3f}, max={df['fatigue_index'].max():.3f}")
    print(f"Predicted fatigue: min={pred.min():.3f}, mean={pred.mean():.3f}, max={pred.max():.3f}, std={pred.std():.3f}\n")

    print("Top 5 employees by latest fatigue_index:")
    print(latest.head(5).to_string(index=False))

    print(f"\nDone. Outputs written to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
