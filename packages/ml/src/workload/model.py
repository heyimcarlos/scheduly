"""
LSTM model definition for the Workload Forecaster.

Architecture:
  Input  → LSTM(64) → Dropout → LSTM(32) → Dropout → Dense(16, relu) → Dense(1)

Two stacked LSTM layers give the model enough capacity to learn both
short-term (intra-day) and longer-term (weekly) staffing patterns.
The output is a single scalar: the predicted (scaled) active_staff_count
for the next hour.
"""

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

from .config import (
    SEQUENCE_LENGTH,
    LSTM_UNITS_1,
    LSTM_UNITS_2,
    DROPOUT_RATE,
    DENSE_UNITS,
    LEARNING_RATE,
)
from .dataset import get_encoded_feature_columns, TARGET_COLUMN


def build_model(n_features: int | None = None) -> keras.Model:
    """
    Build and compile the workload LSTM model.

    Args:
        n_features: Number of input features per timestep.

    Returns:
        Compiled Keras model.
    """
    if n_features is None:
        encoded_cols = get_encoded_feature_columns()
        # target column is always included as a feature
        all_cols = [TARGET_COLUMN] + [c for c in encoded_cols if c != TARGET_COLUMN]
        n_features = len(all_cols)

    inputs = keras.Input(shape=(SEQUENCE_LENGTH, n_features), name="sequence_input")

    # First LSTM — return sequences so the second LSTM can attend to all timesteps
    x = layers.LSTM(LSTM_UNITS_1, return_sequences=True, name="lstm_1")(inputs)
    x = layers.Dropout(DROPOUT_RATE, name="dropout_1")(x)

    # Second LSTM — collapse the sequence to a single context vector
    x = layers.LSTM(LSTM_UNITS_2, return_sequences=False, name="lstm_2")(x)
    x = layers.Dropout(DROPOUT_RATE, name="dropout_2")(x)

    # Dense head
    x = layers.Dense(DENSE_UNITS, activation="relu", name="dense_hidden")(x)

    # Output: single continuous value (scaled staff count)
    output = layers.Dense(1, activation="linear", name="output")(x)

    model = keras.Model(inputs=inputs, outputs=output, name="workload_forecaster")

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss="mse",
        metrics=["mae"],
    )

    return model


def model_summary() -> None:
    """Print the model summary to stdout."""
    model = build_model()
    model.summary()
