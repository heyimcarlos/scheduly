"""
Entry point for workload LSTM evaluation.

Usage:
    uv run python -m src.workload.run_evaluate           # lag model only
    uv run python -m src.workload.run_evaluate --both    # both + comparison plots
"""

import argparse
from src.workload.evaluate import evaluate

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate workload LSTM model(s).")
    parser.add_argument(
        "--both",
        action="store_true",
        help="Evaluate both baseline and lag models and generate comparison plots.",
    )
    args = parser.parse_args()
    evaluate()
