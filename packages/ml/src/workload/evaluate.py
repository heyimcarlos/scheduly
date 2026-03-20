"""
Evaluation and analysis for the trained Workload Forecaster LSTM.

Granularity: shift-type slot level (day / evening / night per UTC day).
One model variant: lag features (workload_lstm.keras).

Per-variant plots (saved to ml/reports/figures/<variant>/):
  1. Training history curves  — loss & MAE (train vs val per epoch)
  2. Predictions vs Actuals   — full val set timeline (slot index on x-axis)
  3. Predictions vs Actuals   — last-56-slot (last ~19 days) zoom
  4. Residuals                — histogram + Q-Q plot
  5. Error by shift type and day of week

Usage:
    uv run python -m src.workload.run_evaluate
"""

import os
import pickle
import json

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")  # non-interactive backend (safe on Windows headless)
import matplotlib.pyplot as plt
import scipy.stats as stats
import tensorflow as tf

from .config import (
    WORKLOAD_CSV,
    MODEL_SAVE_PATH,
    SCALER_SAVE_PATH,
    HISTORY_SAVE_PATH,
    SEQUENCE_LENGTH,
    FORECAST_HORIZON,
    TRAIN_RATIO,
    MODELS_DIR,
    SHIFT_TYPE_NAMES,
    SLOTS_PER_DAY,
)
from .dataset import build_datasets

# ── Output directories ────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPORTS_DIR = os.path.join(BASE_DIR, "reports")
FIGURES_DIR = os.path.join(REPORTS_DIR, "figures")

# ── Plot style ────────────────────────────────────────────────────────────────

STYLE = "seaborn-v0_8-whitegrid"
BLUE = "#2563EB"
ORANGE = "#F97316"
GREEN = "#16A34A"
RED = "#EF4444"
GRAY = "#6B7280"

VARIANT_COLOR = ORANGE


# ── Helpers ───────────────────────────────────────────────────────────────────


def _fig_dir(variant: str) -> str:
    d = os.path.join(FIGURES_DIR, variant)
    os.makedirs(d, exist_ok=True)
    return d


def _save(fig: plt.Figure, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=150, bbox_inches="tight")
    print(f"  Saved: {path}")


def _invert_target(scaled_values: np.ndarray, scaler) -> np.ndarray:
    """Invert MinMaxScaler for the target column (column 0) only."""
    dummy = np.zeros((len(scaled_values), scaler.n_features_in_))
    dummy[:, 0] = scaled_values
    return scaler.inverse_transform(dummy)[:, 0]


def _load_val_slot_info() -> pd.DataFrame:
    """
    Returns a DataFrame with (utc_date, shift_type, shift_type_ordinal) for
    each validation target slot — same ordering as the val set produced by
    build_datasets().
    """
    df = pd.read_csv(WORKLOAD_CSV, parse_dates=["utc_date"])
    df = df.sort_values(["utc_date", "shift_type_ordinal"]).reset_index(drop=True)
    n_sequences = len(df) - SEQUENCE_LENGTH - FORECAST_HORIZON + 1
    split = int(n_sequences * TRAIN_RATIO)
    indices = [
        SEQUENCE_LENGTH + split + i + FORECAST_HORIZON - 1
        for i in range(n_sequences - split)
    ]
    return (
        df[["utc_date", "shift_type", "shift_type_ordinal"]]
        .iloc[indices]
        .reset_index(drop=True)
    )


def _compute_metrics(actuals: np.ndarray, preds: np.ndarray) -> dict:
    mae = float(np.mean(np.abs(actuals - preds)))
    mse = float(np.mean((actuals - preds) ** 2))
    rmse = float(np.sqrt(mse))
    mask = actuals > 0.5
    mape = float(np.mean(np.abs((actuals[mask] - preds[mask]) / actuals[mask])) * 100)
    return {
        "mae_employees": mae,
        "mse_employees": mse,
        "rmse_employees": rmse,
        "mape_pct": mape,
        "n_val": len(actuals),
    }


def _compute_rounding_metrics(actuals: np.ndarray, preds: np.ndarray) -> dict:
    """
    Round both predictions and actuals to the nearest integer (staff counts are
    whole numbers; inversion may introduce tiny float noise on actuals too) and
    compute exact-match and off-by-N statistics.
    """
    act_r = np.round(actuals).astype(int)
    pred_r = np.round(preds).astype(int)
    diff = np.abs(pred_r - act_r)
    n = len(diff)
    exact = int(np.sum(diff == 0))
    off1 = int(np.sum(diff == 1))
    off2 = int(np.sum(diff == 2))
    off3p = int(np.sum(diff >= 3))
    return {
        "n_val": n,
        "exact_match": exact,
        "exact_match_pct": round(exact / n * 100, 2),
        "off_by_1": off1,
        "off_by_1_pct": round(off1 / n * 100, 2),
        "off_by_2": off2,
        "off_by_2_pct": round(off2 / n * 100, 2),
        "off_by_3plus": off3p,
        "off_by_3plus_pct": round(off3p / n * 100, 2),
    }


def _slot_dow_mae(
    actuals: np.ndarray,
    preds: np.ndarray,
    slot_info: pd.DataFrame,
) -> tuple:
    """
    Returns (slot_mae, dow_mae):
      - slot_mae: pd.Series indexed by shift_type_ordinal (0=day,1=evening,2=night)
      - dow_mae:  pd.Series indexed by day of week (0=Mon...6=Sun)
    """
    abs_err = np.abs(actuals - preds)
    slots = slot_info["shift_type_ordinal"].values
    dows = slot_info["utc_date"].dt.dayofweek.values
    slot_mae = pd.Series(abs_err).groupby(slots).mean()
    dow_mae = pd.Series(abs_err).groupby(dows).mean()
    return slot_mae, dow_mae


# ── Per-variant plots ─────────────────────────────────────────────────────────


def plot_training_history(history: dict, variant: str) -> plt.Figure:
    epochs = range(1, len(history["loss"]) + 1)
    color = VARIANT_COLOR

    with plt.style.context(STYLE):
        fig, axes = plt.subplots(1, 2, figsize=(13, 4))
        fig.suptitle(
            f"Workload LSTM [{variant}] — Training History",
            fontsize=14,
            fontweight="bold",
        )
        for ax, (train_key, val_key), title in zip(
            axes,
            [("loss", "val_loss"), ("mae", "val_mae")],
            ["Loss (MSE)", "MAE"],
        ):
            ax.plot(
                epochs, history[train_key], label="Train", color=color, linewidth=1.8
            )
            ax.plot(
                epochs,
                history[val_key],
                label="Val",
                color=GRAY,
                linewidth=1.8,
                linestyle="--",
            )
            best = int(np.argmin(history[val_key])) + 1
            ax.axvline(
                best, color=RED, linewidth=1.0, linestyle=":", label=f"Best ({best})"
            )
            ax.set_title(title)
            ax.set_xlabel("Epoch")
            ax.legend(frameon=True)
        fig.tight_layout()
    return fig


def plot_predictions_vs_actuals(
    actuals: np.ndarray,
    preds: np.ndarray,
    timestamps: pd.Series,
    variant: str,
) -> tuple[plt.Figure, plt.Figure]:
    color = VARIANT_COLOR
    with plt.style.context(STYLE):
        fig_full, ax = plt.subplots(figsize=(16, 4))
        ax.plot(
            timestamps, actuals, label="Actual", color=BLUE, linewidth=1.0, alpha=0.85
        )
        ax.plot(
            timestamps,
            preds,
            label="Predicted",
            color=color,
            linewidth=1.0,
            alpha=0.85,
            linestyle="--",
        )
        ax.set_title(
            f"Workload LSTM [{variant}] — Predictions vs Actuals (full val set)",
            fontweight="bold",
        )
        ax.set_xlabel("Time (local)")
        ax.set_ylabel("Active staff count")
        ax.legend(frameon=True)
        fig_full.tight_layout()

        zoom_n = min(336, len(actuals))
        fig_zoom, ax2 = plt.subplots(figsize=(14, 4))
        ax2.plot(
            timestamps.iloc[-zoom_n:],
            actuals[-zoom_n:],
            label="Actual",
            color=BLUE,
            linewidth=1.5,
        )
        ax2.plot(
            timestamps.iloc[-zoom_n:],
            preds[-zoom_n:],
            label="Predicted",
            color=color,
            linewidth=1.5,
            linestyle="--",
        )
        ax2.set_title(
            f"Workload LSTM [{variant}] — Predictions vs Actuals (last {zoom_n}h zoom)",
            fontweight="bold",
        )
        ax2.set_xlabel("Time (local)")
        ax2.set_ylabel("Active staff count")
        ax2.legend(frameon=True)
        fig_zoom.tight_layout()
    return fig_full, fig_zoom


def plot_residuals(actuals: np.ndarray, preds: np.ndarray, variant: str) -> plt.Figure:
    residuals = actuals - preds
    color = VARIANT_COLOR
    with plt.style.context(STYLE):
        fig, axes = plt.subplots(1, 2, figsize=(13, 4))
        fig.suptitle(
            f"Workload LSTM [{variant}] — Residual Analysis",
            fontsize=14,
            fontweight="bold",
        )

        ax = axes[0]
        ax.hist(residuals, bins=40, color=color, edgecolor="white", alpha=0.85)
        ax.axvline(0, color=RED, linewidth=1.2, linestyle="--")
        ax.set_title("Residual Distribution")
        ax.set_xlabel("Actual - Predicted (employees)")
        ax.set_ylabel("Count")
        ax.text(
            0.97,
            0.95,
            f"mean={residuals.mean():.3f}\nstd={residuals.std():.3f}",
            transform=ax.transAxes,
            ha="right",
            va="top",
            fontsize=9,
            bbox=dict(boxstyle="round,pad=0.3", facecolor="white", edgecolor="#ccc"),
        )

        ax2 = axes[1]
        (osm, osr), (slope, intercept, _) = stats.probplot(residuals, dist="norm")
        ax2.scatter(osm, osr, s=6, alpha=0.5, color=color)
        line_x = np.array([osm[0], osm[-1]])
        ax2.plot(line_x, slope * line_x + intercept, color=RED, linewidth=1.5)
        ax2.set_title("Q-Q Plot (Normal)")
        ax2.set_xlabel("Theoretical quantiles")
        ax2.set_ylabel("Sample quantiles")
        fig.tight_layout()
    return fig


def plot_error_patterns_single(
    actuals: np.ndarray,
    preds: np.ndarray,
    slot_info: pd.DataFrame,
    variant: str,
) -> plt.Figure:
    slot_mae, dow_mae = _slot_dow_mae(actuals, preds, slot_info)
    color = VARIANT_COLOR
    dow_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    with plt.style.context(STYLE):
        fig, axes = plt.subplots(1, 2, figsize=(14, 4))
        fig.suptitle(
            f"Workload LSTM [{variant}] — MAE by Time Segment",
            fontsize=14,
            fontweight="bold",
        )
        axes[0].bar(
            slot_mae.index, slot_mae.values, color=color, edgecolor="white", alpha=0.85
        )
        axes[0].set_title("Mean |Error| by Shift Type")
        axes[0].set_xlabel("Shift type")
        axes[0].set_ylabel("MAE (employees)")
        axes[0].set_xticks(range(len(SHIFT_TYPE_NAMES)))
        axes[0].set_xticklabels(SHIFT_TYPE_NAMES)
        axes[1].bar(
            dow_mae.index, dow_mae.values, color=color, edgecolor="white", alpha=0.85
        )
        axes[1].set_title("Mean |Error| by Day of Week")
        axes[1].set_xlabel("Day")
        axes[1].set_ylabel("MAE (employees)")
        axes[1].set_xticks(range(7))
        axes[1].set_xticklabels(dow_labels)
        fig.tight_layout()
    return fig


# ── Rounding / integer-accuracy plots ────────────────────────────────────────


def plot_rounding_single(rounding: dict, variant: str) -> plt.Figure:
    """
    Stacked horizontal bar showing exact-match vs off-by-1/2/3+ share for one
    variant.
    """
    labels = ["Exact match", "Off by 1", "Off by 2", "Off by >=3"]
    pcts = [
        rounding["exact_match_pct"],
        rounding["off_by_1_pct"],
        rounding["off_by_2_pct"],
        rounding["off_by_3plus_pct"],
    ]
    colors = [GREEN, BLUE, ORANGE, RED]

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(10, 3))
        left = 0.0
        for label, pct, color in zip(labels, pcts, colors):
            bar = ax.barh(
                0,
                pct,
                left=left,
                color=color,
                edgecolor="white",
                height=0.5,
                label=f"{label} ({pct:.1f}%)",
            )
            if pct >= 2.0:
                ax.text(
                    left + pct / 2,
                    0,
                    f"{pct:.1f}%",
                    ha="center",
                    va="center",
                    fontsize=10,
                    color="white",
                    fontweight="bold",
                )
            left += pct

        ax.set_xlim(0, 100)
        ax.set_xlabel("% of validation predictions")
        ax.set_yticks([])
        ax.legend(loc="lower right", frameon=True, fontsize=9)
        ax.set_title(
            f"Workload LSTM [{variant}] — Integer rounding accuracy "
            f"(n={rounding['n_val']:,})",
            fontsize=13,
            fontweight="bold",
        )
        fig.tight_layout()
    return fig


def plot_rounding_comparison(rounding_b: dict, rounding_l: dict) -> plt.Figure:
    """
    Side-by-side grouped bars: exact/off-by-1/off-by-2/off-by-3+ for each
    variant.
    """
    categories = ["Exact\nmatch", "Off\nby 1", "Off\nby 2", "Off\nby >=3"]
    vals_b = [
        rounding_b["exact_match_pct"],
        rounding_b["off_by_1_pct"],
        rounding_b["off_by_2_pct"],
        rounding_b["off_by_3plus_pct"],
    ]
    vals_l = [
        rounding_l["exact_match_pct"],
        rounding_l["off_by_1_pct"],
        rounding_l["off_by_2_pct"],
        rounding_l["off_by_3plus_pct"],
    ]

    x = np.arange(len(categories))
    w = 0.35

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(10, 5))
        bars_b = ax.bar(x - w / 2, vals_b, w, label="Baseline", color=BLUE, alpha=0.85)
        bars_l = ax.bar(
            x + w / 2, vals_l, w, label="Lag features", color=ORANGE, alpha=0.85
        )

        for bars, color in [(bars_b, BLUE), (bars_l, ORANGE)]:
            for bar in bars:
                h = bar.get_height()
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    h + 0.3,
                    f"{h:.1f}%",
                    ha="center",
                    va="bottom",
                    fontsize=9,
                    color=color,
                )

        ax.set_xticks(x)
        ax.set_xticklabels(categories)
        ax.set_ylabel("% of validation predictions")
        ax.set_title(
            "Workload LSTM — Integer rounding accuracy: Baseline vs Lag Features",
            fontsize=13,
            fontweight="bold",
        )
        ax.legend(frameon=True)
        fig.tight_layout()
    return fig


# ── Single-variant evaluation ─────────────────────────────────────────────────


def evaluate_variant(
    variant: str,
    model_path: str,
    scaler_path: str,
    history_path: str,
    slot_info: pd.DataFrame,
) -> tuple[dict, dict, np.ndarray, np.ndarray]:
    """
    Evaluate the model. Saves per-variant plots.
    Returns (metrics, rounding_metrics, actuals_inv, preds_inv).
    """
    print(f"\n  [{variant}] Loading model and scaler...")
    model = tf.keras.models.load_model(model_path)
    with open(scaler_path, "rb") as f:
        scaler = pickle.load(f)

    print(f"  [{variant}] Rebuilding validation set...")
    _, _, X_val, y_val, _ = build_datasets(verbose=False, scaler_save_path=scaler_path)

    print(f"  [{variant}] Running inference...")
    y_pred_scaled = model.predict(X_val, batch_size=64, verbose=0).flatten()

    y_val_inv = _invert_target(y_val, scaler)
    y_pred_inv = _invert_target(y_pred_scaled, scaler)

    metrics = _compute_metrics(y_val_inv, y_pred_inv)
    rounding = _compute_rounding_metrics(y_val_inv, y_pred_inv)

    print(f"\n  [{variant}] Metrics:")
    print(f"    MAE  : {metrics['mae_employees']:.3f} employees")
    print(f"    RMSE : {metrics['rmse_employees']:.3f} employees")
    print(f"    MAPE : {metrics['mape_pct']:.2f}%")
    print(f"\n  [{variant}] Integer rounding accuracy (n={rounding['n_val']:,}):")
    print(
        f"    Exact match : {rounding['exact_match']:,} ({rounding['exact_match_pct']:.1f}%)"
    )
    print(
        f"    Off by 1    : {rounding['off_by_1']:,} ({rounding['off_by_1_pct']:.1f}%)"
    )
    print(
        f"    Off by 2    : {rounding['off_by_2']:,} ({rounding['off_by_2_pct']:.1f}%)"
    )
    print(
        f"    Off by >=3  : {rounding['off_by_3plus']:,} ({rounding['off_by_3plus_pct']:.1f}%)"
    )

    # Save metrics JSON
    os.makedirs(REPORTS_DIR, exist_ok=True)
    m_path = os.path.join(REPORTS_DIR, f"workload_eval_metrics_{variant}.json")
    with open(m_path, "w") as f:
        json.dump({**metrics, "rounding": rounding}, f, indent=2)
    print(f"    Metrics saved: {m_path}")

    # Per-variant plots — use utc_date as x-axis for predictions
    vdir = _fig_dir(variant)
    val_dates = pd.Series(slot_info["utc_date"].values)

    if os.path.exists(history_path):
        with open(history_path) as f:
            hist = json.load(f)
        fig = plot_training_history(hist, variant)
        _save(fig, os.path.join(vdir, "01_training_history.png"))
        plt.close(fig)
    else:
        print(f"  [{variant}] [SKIP] No history at {history_path}")

    fig_full, fig_zoom = plot_predictions_vs_actuals(
        y_val_inv, y_pred_inv, val_dates, variant
    )
    _save(fig_full, os.path.join(vdir, "02a_predictions_full.png"))
    _save(fig_zoom, os.path.join(vdir, "02b_predictions_zoom.png"))
    plt.close(fig_full)
    plt.close(fig_zoom)

    fig_res = plot_residuals(y_val_inv, y_pred_inv, variant)
    _save(fig_res, os.path.join(vdir, "03_residuals.png"))
    plt.close(fig_res)

    fig_err = plot_error_patterns_single(y_val_inv, y_pred_inv, slot_info, variant)
    _save(fig_err, os.path.join(vdir, "04_error_by_time.png"))
    plt.close(fig_err)

    fig_round = plot_rounding_single(rounding, variant)
    _save(fig_round, os.path.join(vdir, "05_rounding_accuracy.png"))
    plt.close(fig_round)

    return metrics, rounding, y_val_inv, y_pred_inv


# ── Main entry ────────────────────────────────────────────────────────────────


def evaluate() -> None:
    os.makedirs(FIGURES_DIR, exist_ok=True)

    print("\n[1] Deriving validation slot info...")
    slot_info = _load_val_slot_info()

    print("\n[2] Evaluating model...")
    evaluate_variant(
        variant="lag",
        model_path=MODEL_SAVE_PATH,
        scaler_path=SCALER_SAVE_PATH,
        history_path=HISTORY_SAVE_PATH,
        slot_info=slot_info,
    )

    print(f"\nDone. Figures saved to: {FIGURES_DIR}")
