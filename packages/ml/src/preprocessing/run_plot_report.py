"""
Entry point for preprocessing report plots.

Usage:
    uv run python -m src.preprocessing.run_plot_report
"""

from src.preprocessing.plot_report import plot_all

if __name__ == "__main__":
    plot_all()
