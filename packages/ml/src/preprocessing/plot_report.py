"""
Visualise the preprocessing_report.json and the two processed CSVs.

Saved to: ml/reports/figures/preprocessing/

Plots
-----
01_match_quality.png            Pie  — exact vs inferred shift matches
02_position_distribution.png    Horizontal bar — shifts per position label
03_shift_type_distribution.png  Bar  — day / evening / night shift counts
04_shift_duration_dist.png      Histogram — shift duration (hours)
05_hours_by_employee.png        Bar  — total hours worked per employee
06_staffing_heatmap.png         Heatmap — avg active staff by hour-of-day × month
07_shift_type_by_employee.png   Stacked bar — day/evening/night mix per employee

Usage
-----
    uv run python -m src.preprocessing.plot_report
"""

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd

from .config import PROCESSED_DATA_PATH

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPORT_JSON = os.path.join(
    BASE_DIR, "..", "data", "processed", "preprocessing_report.json"
)
WORKLOAD_CSV = os.path.join(PROCESSED_DATA_PATH, "workload_training_data.csv")
FATIGUE_CSV = os.path.join(PROCESSED_DATA_PATH, "fatigue_training_data.csv")
FIGURES_DIR = os.path.join(BASE_DIR, "reports", "figures", "preprocessing")

# ── Style ──────────────────────────────────────────────────────────────────────

STYLE = "seaborn-v0_8-whitegrid"
BLUE = "#2563EB"
ORANGE = "#F97316"
GREEN = "#16A34A"
RED = "#EF4444"
GRAY = "#6B7280"
PURPLE = "#7C3AED"

SHIFT_COLORS = {"day": BLUE, "evening": ORANGE, "night": PURPLE}

DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTH_LABELS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]


def _save(fig: plt.Figure, filename: str) -> None:
    os.makedirs(FIGURES_DIR, exist_ok=True)
    path = os.path.join(FIGURES_DIR, filename)
    fig.savefig(path, dpi=150, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


# ── Plot 01 — Match quality ────────────────────────────────────────────────────


def plot_match_quality(report: dict) -> None:
    mq = report["match_quality"]
    labels = [f"Exact ({mq['exact']:,})", f"Inferred ({mq['inferred']:,})"]
    sizes = [mq["exact"], mq["inferred"]]
    colors = [GREEN, ORANGE]
    explode = (0.03, 0.06)

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(7, 5))
        wedges, texts, autotexts = ax.pie(
            sizes,
            labels=labels,
            colors=colors,
            explode=explode,
            autopct="%1.1f%%",
            startangle=90,
            pctdistance=0.75,
            wedgeprops=dict(linewidth=1.2, edgecolor="white"),
        )
        for at in autotexts:
            at.set_fontsize(11)
            at.set_fontweight("bold")
        ax.set_title(
            f"Shift Match Quality  (total {sum(sizes):,} shifts)",
            fontsize=13,
            fontweight="bold",
            pad=14,
        )
        fig.tight_layout()
    _save(fig, "01_match_quality.png")


# ── Plot 03 — Shift type distribution ─────────────────────────────────────────


def plot_shift_type_distribution(report: dict) -> None:
    st = report["shift_type_distribution"]
    types = list(st.keys())
    counts = list(st.values())
    colors = [SHIFT_COLORS.get(t, GRAY) for t in types]
    total = sum(counts)

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(7, 4))
        bars = ax.bar(
            types, counts, color=colors, edgecolor="white", alpha=0.88, width=0.5
        )
        for bar, cnt in zip(bars, counts):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 10,
                f"{cnt:,}\n({cnt / total * 100:.1f}%)",
                ha="center",
                va="bottom",
                fontsize=10,
            )
        ax.set_ylabel("Number of shifts")
        ax.set_title("Shift Type Distribution", fontsize=13, fontweight="bold")
        ax.set_ylim(0, max(counts) * 1.18)
        fig.tight_layout()
    _save(fig, "03_shift_type_distribution.png")


# ── Plot 04 — Shift duration distribution ─────────────────────────────────────


def plot_shift_duration(df_fatigue: pd.DataFrame) -> None:
    durations = df_fatigue["duration_hours"]
    avg = durations.mean()

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.hist(durations, bins=30, color=BLUE, edgecolor="white", alpha=0.88)
        ax.axvline(
            avg, color=RED, linewidth=1.5, linestyle="--", label=f"Mean = {avg:.2f} h"
        )
        ax.set_xlabel("Shift duration (hours)")
        ax.set_ylabel("Count")
        ax.set_title("Shift Duration Distribution", fontsize=13, fontweight="bold")
        ax.legend(frameon=True)
        fig.tight_layout()
    _save(fig, "04_shift_duration_dist.png")


# ── Plot 05 — Total hours worked per employee ─────────────────────────────────


def plot_hours_by_employee(df_fatigue: pd.DataFrame) -> None:
    hours = (
        df_fatigue.groupby("employee_id")["duration_hours"]
        .sum()
        .sort_values(ascending=True)
    )

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(10, 5))
        bars = ax.barh(
            hours.index, hours.values, color=BLUE, edgecolor="white", alpha=0.88
        )
        ax.bar_label(bars, fmt="%.0f h", padding=4, fontsize=9)
        ax.set_xlabel("Total hours worked")
        ax.set_title(
            "Total Hours Worked per Employee (2025)", fontsize=13, fontweight="bold"
        )
        fig.tight_layout()
    _save(fig, "05_hours_by_employee.png")


# ── Plot 06 — Staffing heatmap (hour-of-day × month) ─────────────────────────


def plot_staffing_heatmap(df_workload: pd.DataFrame) -> None:
    pivot = (
        df_workload.groupby(["month", "hour_of_day"])["active_staff_count"]
        .mean()
        .unstack(level="hour_of_day")  # columns = hours 0-23
    )
    # Ensure all months and hours present
    pivot = pivot.reindex(range(1, 13)).reindex(columns=range(24))

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(16, 6))
        im = ax.imshow(pivot.values, aspect="auto", cmap="YlOrRd", origin="upper")
        cbar = fig.colorbar(im, ax=ax, fraction=0.02, pad=0.01)
        cbar.set_label("Avg active staff", fontsize=10)

        ax.set_xticks(range(24))
        ax.set_xticklabels(range(24), fontsize=8)
        ax.set_yticks(range(12))
        month_labels = [MONTH_LABELS[m - 1] for m in pivot.index]
        ax.set_yticklabels(month_labels)
        ax.set_xlabel("Hour of day (local EST)")
        ax.set_ylabel("Month")
        ax.set_title(
            "Average Active Staff Count — Hour of Day × Month (2025)",
            fontsize=13,
            fontweight="bold",
        )

        # Annotate cells
        for i in range(pivot.shape[0]):
            for j in range(pivot.shape[1]):
                val = pivot.values[i, j]
                if not np.isnan(val):
                    ax.text(
                        j,
                        i,
                        f"{val:.1f}",
                        ha="center",
                        va="center",
                        fontsize=6.5,
                        color="black" if val < pivot.values.max() * 0.7 else "white",
                    )

        fig.tight_layout()
    _save(fig, "06_staffing_heatmap.png")


# ── Plot 07 — Shift type mix per employee ─────────────────────────────────────


def plot_shift_type_by_employee(df_fatigue: pd.DataFrame) -> None:
    pivot = (
        df_fatigue.groupby(["employee_id", "shift_type"]).size().unstack(fill_value=0)
    )
    # Normalise to pct
    pivot_pct = pivot.div(pivot.sum(axis=1), axis=0) * 100
    # Sort by day-shift share descending
    if "day" in pivot_pct.columns:
        pivot_pct = pivot_pct.sort_values("day", ascending=True)

    shift_types = [t for t in ["day", "evening", "night"] if t in pivot_pct.columns]
    colors = [SHIFT_COLORS[t] for t in shift_types]

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(11, 5))
        bottom = np.zeros(len(pivot_pct))
        for stype, color in zip(shift_types, colors):
            vals = pivot_pct[stype].values
            bars = ax.barh(
                pivot_pct.index,
                vals,
                left=bottom,
                color=color,
                edgecolor="white",
                alpha=0.88,
                label=stype.capitalize(),
            )
            for bar, val in zip(bars, vals):
                if val >= 5:
                    ax.text(
                        bar.get_x() + bar.get_width() / 2,
                        bar.get_y() + bar.get_height() / 2,
                        f"{val:.0f}%",
                        ha="center",
                        va="center",
                        fontsize=8,
                        color="white",
                        fontweight="bold",
                    )
            bottom += vals

        ax.set_xlim(0, 100)
        ax.set_xlabel("% of shifts")
        ax.set_title("Shift Type Mix per Employee", fontsize=13, fontweight="bold")
        ax.legend(loc="lower right", frameon=True)
        fig.tight_layout()
    _save(fig, "07_shift_type_by_employee.png")


# ── Main ───────────────────────────────────────────────────────────────────────


def plot_all() -> None:
    print("\nLoading data...")
    with open(REPORT_JSON) as f:
        report = json.load(f)

    df_workload = pd.read_csv(WORKLOAD_CSV, parse_dates=["timestamp_est"])
    df_fatigue = pd.read_csv(FATIGUE_CSV)

    print("\nGenerating preprocessing report plots...")
    plot_match_quality(report)
    plot_shift_type_distribution(report)
    plot_shift_duration(df_fatigue)
    plot_hours_by_employee(df_fatigue)
    plot_staffing_heatmap(df_workload)
    plot_shift_type_by_employee(df_fatigue)

    print(f"\nDone. All figures saved to: {FIGURES_DIR}")


if __name__ == "__main__":
    plot_all()
