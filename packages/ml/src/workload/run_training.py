"""
Entry point for workload LSTM training.

Usage:
    uv run python -m src.workload.run_training
"""

from src.workload.train import train

if __name__ == "__main__":
    train(verbose=True)
