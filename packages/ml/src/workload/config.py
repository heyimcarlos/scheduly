"""
Workload forecaster config and constants.

Granularity change: the model now operates at shift-type slot level
(day / evening / night per UTC day) rather than hourly.

Timeline structure
------------------
Each row in workload_training_data.csv is one (utc_date, shift_type) slot.
Three slots per UTC day, ordered: day(0) → evening(1) → night(2).

SEQUENCE_LENGTH = 168 slots = 56 days × 3 slots/day.
This gives the model 8 full weeks of history per shift type, enough to
capture weekly cycles and month-boundary patterns.
"""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROCESSED_DATA_PATH = os.path.join(BASE_DIR, "..", "data", "processed")
MODELS_DIR = os.path.join(BASE_DIR, "models")

WORKLOAD_CSV = os.path.join(PROCESSED_DATA_PATH, "workload_training_data.csv")

MODEL_SAVE_PATH = os.path.join(MODELS_DIR, "workload_lstm.keras")
SCALER_SAVE_PATH = os.path.join(MODELS_DIR, "workload_scaler.pkl")
HISTORY_SAVE_PATH = os.path.join(MODELS_DIR, "workload_history.json")

# 168 shift-type slots = 56 days × 3 slots/day (day / evening / night)
# Each slot type gets 56 data points of same-type context in one window.
SEQUENCE_LENGTH = 168
SLOTS_PER_DAY = 3  # day, evening, night

# Predict the next shift-type slot's headcount (1 step ahead in the timeline)
FORECAST_HORIZON = 1

# ── Shift type ordering ───────────────────────────────────────────────────────
# Must match the ordinal assignment in preprocessing.py generate_workload_dataset()
# and the shift_types order in system_config.json.
SHIFT_TYPE_NAMES = ["day", "evening", "night"]  # ordinal: 0, 1, 2

# ── Feature columns ───────────────────────────────────────────────────────────
# These are the raw columns read from workload_training_data.csv before encoding.
# Cyclical columns (shift_type_ordinal, day_of_week, month) are replaced by
# sin/cos pairs in dataset.py — they appear here as the raw source names.

FEATURE_COLUMNS = [
    "headcount",  # Target — autoregressive input (also predicted output)
    "shift_type_ordinal",  # 0=day, 1=evening, 2=night (cyclical, period 3)
    "day_of_week",  # 0–6 (cyclical, period 7)
    "month",  # 1–12 (cyclical, period 12)
    "is_weekend",  # 0/1 binary
    "is_holiday",  # 0/1 binary
]

# Lag features — present in workload_training_data.csv.
# NaN rows at the start (first 28 slots for 28d lag) fall entirely inside
# the initial SEQUENCE_LENGTH lookback window, so filling with 0 is safe.
LAG_FEATURE_COLUMNS = [
    "headcount_same_slot_1d_ago",  # Same slot yesterday (3 positions back)
    "headcount_same_slot_7d_ago",  # Same slot last week (21 positions back)
    "headcount_same_slot_28d_ago",  # Same slot 4 weeks ago (84 positions back)
    "avg_headcount_last_4_same_slots",  # Rolling 4-slot mean for same shift type
]

TARGET_COLUMN = "headcount"
TRAIN_RATIO = 0.85

# ── Hyperparameters ───────────────────────────────────────────────────────────

LSTM_UNITS_1 = 64
LSTM_UNITS_2 = 32
DROPOUT_RATE = 0.2
DENSE_UNITS = 16

# Training config
BATCH_SIZE = 32
EPOCHS = 100
LEARNING_RATE = 1e-3
EARLY_STOPPING_PATIENCE = 10
REDUCE_LR_PATIENCE = 5
REDUCE_LR_FACTOR = 0.5
