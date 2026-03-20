"""
Training loop for the Workload Forecaster LSTM.

Callbacks:
  - EarlyStopping     : stops when val_loss stops improving
  - ReduceLROnPlateau : halves the LR when val_loss plateaus
  - ModelCheckpoint   : saves the best weights to disk
"""

import json
import os

import numpy as np
import tensorflow as tf
from tensorflow import keras

from .config import (
    MODELS_DIR,
    MODEL_SAVE_PATH,
    SCALER_SAVE_PATH,
    HISTORY_SAVE_PATH,
    BATCH_SIZE,
    EPOCHS,
    EARLY_STOPPING_PATIENCE,
    REDUCE_LR_PATIENCE,
    REDUCE_LR_FACTOR,
)
from .dataset import build_datasets
from .model import build_model


def train(verbose: bool = True) -> keras.callbacks.History:
    """
    Full training pipeline for the workload forecaster (lag features enabled).

    Returns:
        Keras History object.
    """
    os.makedirs(MODELS_DIR, exist_ok=True)

    if verbose:
        print(f"  Model path   : {MODEL_SAVE_PATH}")

    X_train, y_train, X_val, y_val, scaler = build_datasets(
        verbose=verbose,
        scaler_save_path=SCALER_SAVE_PATH,
    )

    n_features = X_train.shape[2]

    if verbose:
        print(f"\n  n_features = {n_features}")

    model = build_model(n_features=n_features)

    if verbose:
        model.summary()

    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=EARLY_STOPPING_PATIENCE,
            restore_best_weights=True,
            verbose=1,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=REDUCE_LR_FACTOR,
            patience=REDUCE_LR_PATIENCE,
            min_lr=1e-6,
            verbose=1,
        ),
        keras.callbacks.ModelCheckpoint(
            filepath=MODEL_SAVE_PATH,
            monitor="val_loss",
            save_best_only=True,
            verbose=1,
        ),
    ]

    if verbose:
        print(f"\n{'=' * 60}")
        print("TRAINING  [workload forecaster]")
        print(f"{'=' * 60}")

    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1 if verbose else 0,
    )

    if verbose:
        best_epoch = int(np.argmin(history.history["val_loss"])) + 1
        best_val_loss = min(history.history["val_loss"])
        best_val_mae = history.history["val_mae"][best_epoch - 1]
        target_range = scaler.data_range_[0]
        mae_original = best_val_mae * target_range

        print(f"\n{'=' * 60}")
        print("TRAINING COMPLETE  [workload forecaster]")
        print(f"{'=' * 60}")
        print(f"  Best epoch   : {best_epoch}")
        print(f"  Val MSE      : {best_val_loss:.6f}  (scaled)")
        print(f"  Val MAE      : {best_val_mae:.6f}  (scaled)")
        print(f"  Val MAE      : {mae_original:.3f} employees  (original scale)")
        print(f"  Model saved  : {MODEL_SAVE_PATH}")

    # Save history JSON so evaluate.py can plot training curves
    history_dict = {k: [float(v) for v in vals] for k, vals in history.history.items()}
    with open(HISTORY_SAVE_PATH, "w") as f:
        json.dump(history_dict, f, indent=2)
    if verbose:
        print(f"  History saved: {HISTORY_SAVE_PATH}")

    return history
