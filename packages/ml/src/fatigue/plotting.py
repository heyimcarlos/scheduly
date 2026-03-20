# plotting.py
"""
Matplotlib plotting utilities for the Fatigue Scorer.

This module writes plots as PNGs into the provided output directory.

Plots included:
- Training curves (loss + MAE): train vs validation
- Predicted vs True scatter + residual histogram
- Per-employee time series (true vs predicted) for top-N employees by latest fatigue
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from pandas.api.types import is_datetime64_any_dtype, is_datetime64tz_dtype

import matplotlib
matplotlib.use("Agg")  # headless-safe backend for servers/CI
import matplotlib.pyplot as plt


def plot_training_history(history: dict[str, Any], outdir: Path) -> None:
    """
    Saves training curves (loss + MAE) for train/validation into outdir as PNGs.

    Expected keys in `history` are the standard Keras History.history keys, such as:
      - "loss", "val_loss"
      - "mae", "val_mae"
    """
    outdir.mkdir(parents=True, exist_ok=True)

    # Loss curve (MSE)
    if "loss" in history:
        plt.figure()
        plt.plot(history.get("loss", []), label="train_loss")
        plt.plot(history.get("val_loss", []), label="val_loss")
        plt.xlabel("epoch")
        plt.ylabel("loss (mse)")
        plt.legend()
        plt.tight_layout()
        plt.savefig(outdir / "training_loss.png", dpi=150)
        plt.close()

    # MAE curve
    if "mae" in history:
        plt.figure()
        plt.plot(history.get("mae", []), label="train_mae")
        plt.plot(history.get("val_mae", []), label="val_mae")
        plt.xlabel("epoch")
        plt.ylabel("mae")
        plt.legend()
        plt.tight_layout()
        plt.savefig(outdir / "training_mae.png", dpi=150)
        plt.close()


def plot_pred_vs_true(meta: pd.DataFrame, preds: np.ndarray, outdir: Path, tag: str) -> None:
    """
    Saves:
      - scatter plot of true fatigue_index vs predicted_fatigue
      - residual histogram (pred - true)

    Parameters
    ----------
    meta:
        Must contain column: "fatigue_index". Optionally contains "start_utc" for context.
    preds:
        Predicted fatigue values aligned 1:1 with meta rows.
    outdir:
        Output directory for images.
    tag:
        Used in filenames so you can create multiple variants (e.g., "all", "val").
    """
    outdir.mkdir(parents=True, exist_ok=True)

    if len(meta) == 0:
        return

    true = meta["fatigue_index"].to_numpy(dtype=float)
    pred = np.asarray(preds, dtype=float)

    # Scatter: predicted vs true
    plt.figure()
    plt.scatter(true, pred, s=10, alpha=0.6)
    mn = float(min(true.min(), pred.min()))
    mx = float(max(true.max(), pred.max()))
    plt.plot([mn, mx], [mn, mx], linestyle="--")  # y=x reference
    plt.xlabel("true fatigue_index (pseudo-label)")
    plt.ylabel("predicted_fatigue")
    plt.title(f"Predicted vs True ({tag})")
    plt.tight_layout()
    plt.savefig(outdir / f"pred_vs_true_{tag}.png", dpi=150)
    plt.close()

    # Residual histogram
    residual = pred - true
    plt.figure()
    plt.hist(residual, bins=40)
    plt.xlabel("residual (pred - true)")
    plt.ylabel("count")
    plt.title(f"Residuals ({tag})")
    plt.tight_layout()
    plt.savefig(outdir / f"residuals_{tag}.png", dpi=150)
    plt.close()


def plot_employee_timeseries(meta: pd.DataFrame, preds: np.ndarray, outdir: Path, top_n: int = 3) -> None:
    """
    Saves per-employee time series plots (true vs predicted) for the top_n employees
    with the highest *latest* fatigue_index.

    Produces files:
      - employee_timeseries_<EMPID>.png

    Parameters
    ----------
    meta:
        Must contain: "employee_id", "start_utc", "fatigue_index"
    preds:
        Predictions aligned with meta.
    outdir:
        Directory to write plots into.
    top_n:
        Number of employees to plot (ranked by latest fatigue_index).
    """
    outdir.mkdir(parents=True, exist_ok=True)

    if len(meta) == 0:
        return

    dfp = meta[["employee_id", "start_utc", "fatigue_index"]].copy()
    dfp["predicted_fatigue"] = np.asarray(preds, dtype=float)

    # Ensure datetime for plotting (handles tz-aware dtype like datetime64[ns, UTC])
    s = dfp["start_utc"]
    if not (is_datetime64_any_dtype(s) or is_datetime64tz_dtype(s)):
        dfp["start_utc"] = pd.to_datetime(dfp["start_utc"], errors="coerce", utc=True)

    # Find top_n by latest fatigue_index
    latest = dfp.sort_values(["employee_id", "start_utc"]).groupby("employee_id", as_index=False).tail(1)
    top_emp = (
        latest.sort_values("fatigue_index", ascending=False)["employee_id"]
        .head(top_n)
        .tolist()
    )

    for emp in top_emp:
        g = dfp[dfp["employee_id"] == emp].sort_values("start_utc")
        if len(g) < 2:
            continue

        plt.figure()
        plt.plot(g["start_utc"], g["fatigue_index"], label="true fatigue_index")
        plt.plot(g["start_utc"], g["predicted_fatigue"], label="predicted_fatigue")
        plt.xlabel("start_utc")
        plt.ylabel("fatigue")
        plt.title(f"Fatigue over time: {emp}")
        plt.legend()
        plt.tight_layout()
        plt.savefig(outdir / f"employee_timeseries_{emp}.png", dpi=150)
        plt.close()
