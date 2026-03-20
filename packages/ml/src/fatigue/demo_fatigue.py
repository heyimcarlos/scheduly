import json
import os
import sys
from pathlib import Path

# Force CPU-only TF (reduces environment-related GPU issues for unit tests)
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"  # hides INFO/WARN/ERROR TF logs

# Ensure imports work if you run from project root
FATIGUE_DIR = Path(__file__).resolve().parent
if str(FATIGUE_DIR) not in sys.path:
    sys.path.insert(0, str(FATIGUE_DIR))

from fatigue_inference import predict_fatigue


# Example payload (single employee, 14 shifts across Mar 1–Mar 14, 2026).
# Shift mix:
#   - 8 day shifts (mostly 08:00–16:00; one is 10:00–18:00)
#   - 4 evening shifts (14:00–22:00 and 16:00–00:00)
#   - 2 night shifts (22:00–06:00, overnight)
# Consecutive days: 14 (one shift per calendar day in this example)
# Rest gaps between consecutive shifts (hours): 16, 22, 10, 16, 30, 10, 10, 14, 22, 10, 16, 30, 10
payload_example = {
    "employee_id": "E1",
    "shifts": [
        {"start_utc": "2026-03-01T08:00:00Z", "end_utc": "2026-03-01T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-02T08:00:00Z", "end_utc": "2026-03-02T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-03T14:00:00Z", "end_utc": "2026-03-03T22:00:00Z", "shift_type": "evening"},
        {"start_utc": "2026-03-04T08:00:00Z", "end_utc": "2026-03-04T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-05T08:00:00Z", "end_utc": "2026-03-05T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-06T22:00:00Z", "end_utc": "2026-03-07T06:00:00Z", "shift_type": "night"},
        {"start_utc": "2026-03-07T16:00:00Z", "end_utc": "2026-03-08T00:00:00Z", "shift_type": "evening"},
        {"start_utc": "2026-03-08T10:00:00Z", "end_utc": "2026-03-08T18:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-09T08:00:00Z", "end_utc": "2026-03-09T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-10T14:00:00Z", "end_utc": "2026-03-10T22:00:00Z", "shift_type": "evening"},
        {"start_utc": "2026-03-11T08:00:00Z", "end_utc": "2026-03-11T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-12T08:00:00Z", "end_utc": "2026-03-12T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-13T22:00:00Z", "end_utc": "2026-03-14T06:00:00Z", "shift_type": "night"},
        {"start_utc": "2026-03-14T16:00:00Z", "end_utc": "2026-03-15T00:00:00Z", "shift_type": "evening"},
    ],
}

# "Well-rested" example payload:
# - 14 shifts spread across 16 consecutive calendar days (2 rest days)
# - No night shifts
# - Mostly day shifts (08:00–16:00), with 2 evening shifts (14:00–22:00)
# - 1 rest day each week
# - Typical rest between workdays is ~16h (and much longer across rest days: ~40h)
payload_well_rested = {
    "employee_id": "E2",
    "shifts": [
        {"start_utc": "2026-03-01T08:00:00Z", "end_utc": "2026-03-01T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-02T08:00:00Z", "end_utc": "2026-03-02T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-03T08:00:00Z", "end_utc": "2026-03-03T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-04T08:00:00Z", "end_utc": "2026-03-04T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-05T14:00:00Z", "end_utc": "2026-03-05T22:00:00Z", "shift_type": "evening"},
        {"start_utc": "2026-03-06T08:00:00Z", "end_utc": "2026-03-06T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-07T08:00:00Z", "end_utc": "2026-03-07T16:00:00Z", "shift_type": "day"},
        # Rest day (no shift on 2026-03-08)
        {"start_utc": "2026-03-09T08:00:00Z", "end_utc": "2026-03-09T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-10T08:00:00Z", "end_utc": "2026-03-10T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-11T08:00:00Z", "end_utc": "2026-03-11T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-12T08:00:00Z", "end_utc": "2026-03-12T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-13T08:00:00Z", "end_utc": "2026-03-13T16:00:00Z", "shift_type": "day"},
        {"start_utc": "2026-03-14T14:00:00Z", "end_utc": "2026-03-14T22:00:00Z", "shift_type": "evening"},
        # Rest day (no shift on 2026-03-15)
        {"start_utc": "2026-03-16T08:00:00Z", "end_utc": "2026-03-16T16:00:00Z", "shift_type": "day"},
    ],
}

# Real example from fatigue_scored_shifts / fatigue_predicted_shifts
# Known true label (pseudo-label) for the *last* shift in this payload:
true_label_fatigue_index = 0.03595238095238096  # from fatigue_current_by_employee.csv

payload_real_example = {
    "employee_id": "CAN_04",
    "shifts": [
        {"start_utc": "2025-12-09T13:00:00Z", "end_utc": "2025-12-09T21:00:00Z", "shift_type": "day"},
        {"start_utc": "2025-12-10T13:00:00Z", "end_utc": "2025-12-10T21:00:00Z", "shift_type": "day"},
        {"start_utc": "2025-12-15T21:00:00Z", "end_utc": "2025-12-16T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-16T21:00:00Z", "end_utc": "2025-12-17T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-17T21:00:00Z", "end_utc": "2025-12-18T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-18T21:00:00Z", "end_utc": "2025-12-19T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-19T21:00:00Z", "end_utc": "2025-12-20T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-22T21:00:00Z", "end_utc": "2025-12-23T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-23T21:00:00Z", "end_utc": "2025-12-24T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-24T21:00:00Z", "end_utc": "2025-12-25T04:59:00Z", "shift_type": "evening"},
        {"start_utc": "2025-12-28T13:00:00Z", "end_utc": "2025-12-28T21:00:00Z", "shift_type": "day"},
        {"start_utc": "2025-12-29T13:00:00Z", "end_utc": "2025-12-29T21:00:00Z", "shift_type": "day"},
        {"start_utc": "2025-12-30T13:00:00Z", "end_utc": "2025-12-30T21:00:00Z", "shift_type": "day"},
        {"start_utc": "2025-12-31T13:00:00Z", "end_utc": "2025-12-31T21:00:00Z", "shift_type": "day"},
    ],
}


def main():
    """
    Demo expects real artifacts in: <project_root>/models/
      - fatigue_lstm.keras
      - fatigue_preprocess.pkl

    Generate them (once) by running:
      python src/fatigue/fatigue_scorer.py
    """
    print("\n=== Fatigue Scorer Example ===")

    result = predict_fatigue(payload_example)

    print("\n'Burnt-out' prediction:")
    print(json.dumps(result, indent=2))
    print("")

    result_well_rested = predict_fatigue(payload_well_rested)

    print("\n'Well-Rested' prediction:")
    print(json.dumps(result_well_rested, indent=2))

    result_real = predict_fatigue(payload_real_example)

    print("\nReal Example (with known true label):")
    print(json.dumps(result_real, indent=2))
    print(f"True fatigue_index: {true_label_fatigue_index:.3f}")
    print(f"Predicted fatigue:  {result_real['predicted_fatigue']:.3f}")
    print(f"Absolute error:     {abs(result_real['predicted_fatigue'] - true_label_fatigue_index):.3f}")


if __name__ == "__main__":
    main()