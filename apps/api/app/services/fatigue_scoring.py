"""Fatigue scoring service — bridges LSTM model and heuristic to the scheduler."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

# Resolve ML package path
_WORKSPACE_ROOT = Path(__file__).resolve().parents[4]  # app/services -> app -> apps/api -> apps -> workspace
_ML_FATIGUE_DIR = _WORKSPACE_ROOT / "packages" / "ml" / "src" / "fatigue"

# Threshold above which an employee is considered "elevated fatigue"
HIGH_FATIGUE_THRESHOLD = 0.6

@dataclass
class FatigueDay:
    """One day's fatigue data."""
    worked_t_minus_2: int  # 1/0 - worked two days ago
    worked_t_minus_1: int  # 1/0 - worked yesterday
    fatigue_score: float   # 0.0-1.0 fatigue level entering today


class FatigueScoringService:
    """Computes per-employee fatigue trajectories for the scheduling window.

    Uses the LSTM model when available and sufficient history exists,
    otherwise falls back to a fast heuristic.
    """

    def __init__(self, system_config: Dict[str, Any]) -> None:
        self.system_config = system_config
        self._ml_available = self._check_ml_available()

    def _check_ml_available(self) -> bool:
        """Check if the ML package and LSTM model are available."""
        model_path = _ML_FATIGUE_DIR / "fatigue_lstm.keras"
        preprocess_path = _ML_FATIGUE_DIR / "fatigue_preprocess.pkl"
        return model_path.exists() and preprocess_path.exists()

    def score_team_fatigue(
        self,
        employees: List[Dict[str, Any]],
        start_date: Any,  # date
        num_days: int,
        recent_shifts: List[Dict[str, Any]],  # HistoricalShiftAssignment[]
        prefer_model: bool = True,
    ) -> Dict[int, List[float]]:
        """Compute fatigue scores [0,1] for each employee for each day in the window.

        Args:
            employees: List of employee dicts with employee_id, region, employee_name
            start_date: First day of the scheduling window
            num_days: Number of days to score
            recent_shifts: Historical shift assignments (from DB or request) to build fatigue from
            prefer_model: If True and ML model available, use LSTM; otherwise heuristic

        Returns:
            Dict[employee_id, List[float]] — one fatigue score per day (aligned with start_date)
        """
        # Build per-employee shift history sorted by start_utc
        employee_shifts: Dict[int, List[Dict[str, Any]]] = {}
        for emp in employees:
            employee_shifts[int(emp["employee_id"])] = []

        for shift in recent_shifts:
            eid = int(shift["employee_id"])
            if eid in employee_shifts:
                employee_shifts[eid].append(shift)

        # Sort each employee's shifts by start time
        for eid in employee_shifts:
            employee_shifts[eid].sort(key=lambda s: s["start_utc"])

        result: Dict[int, List[float]] = {}
        for emp in employees:
            eid = int(emp["employee_id"])
            shifts = employee_shifts.get(eid, [])
            scores = self._score_employee_fatigue(
                shifts, start_date, num_days, prefer_model
            )
            result[eid] = scores

        return result

    def _score_employee_fatigue(
        self,
        shifts: List[Dict[str, Any]],
        start_date: Any,
        num_days: int,
        prefer_model: bool,
    ) -> List[float]:
        """Score one employee's fatigue across the scheduling window.

        Uses LSTM model when prefer_model=True and at least 14 shifts of history exist.
        Otherwise falls back to heuristic.
        """
        scores: List[float] = []
        for day_offset in range(num_days):
            current_date = start_date + timedelta(days=day_offset)
            score = self._score_day_fatigue(
                shifts, current_date, prefer_model
            )
            scores.append(score)
        return scores

    def _score_day_fatigue(
        self,
        shifts: List[Dict[str, Any]],
        current_date: Any,
        prefer_model: bool,
    ) -> float:
        """Score fatigue for one employee on one day.

        If prefer_model=True and ML available and we have 14+ shifts, use LSTM.
        Always falls back to heuristic if model fails.
        """
        if prefer_model and self._ml_available:
            model_score = self._try_model_score(shifts, current_date)
            if model_score is not None:
                return model_score
        return self._heuristic_fatigue(shifts, current_date)

    def _try_model_score(
        self,
        shifts: List[Dict[str, Any]],
        current_date: Any,
    ) -> Optional[float]:
        """Try to score using LSTM. Returns None if insufficient history."""
        try:
            import numpy as np
            from tensorflow import keras

            model_path = _ML_FATIGUE_DIR / "fatigue_lstm.keras"
            preprocess_path = _ML_FATIGUE_DIR / "fatigue_preprocess.pkl"

            if not model_path.exists() or not preprocess_path.exists():
                return None

            import pickle
            with open(preprocess_path, "rb") as f:
                preprocess = pickle.load(f)

            # Build the 14-shift window ending at current_date
            window_shifts = self._build_shift_window(shifts, current_date, window_size=14)
            if len(window_shifts) < 14:
                return None

            # Preprocess to feature vector
            features = self._shifts_to_features(window_shifts, preprocess)
            if features is None:
                return None

            model = keras.models.load_model(str(model_path), compile=False)
            pred = float(model.predict(features, verbose=0)[0, 0])
            return max(0.0, min(1.0, pred))
        except Exception:
            return None

    def _build_shift_window(
        self,
        shifts: List[Dict[str, Any]],
        current_date: Any,
        window_size: int = 14,
    ) -> List[Dict[str, Any]]:
        """Extract the last `window_size` shifts that ended before or at current_date."""
        past_shifts = [s for s in shifts if s["start_utc"].date() <= current_date]
        return past_shifts[-window_size:] if len(past_shifts) >= window_size else []

    def _shifts_to_features(
        self,
        window_shifts: List[Dict[str, Any]],
        preprocess: Dict[str, Any],
    ) -> Optional["np.ndarray"]:
        """Convert a 14-shift window into the 14x8 feature matrix expected by LSTM."""
        import numpy as np

        if len(window_shifts) != 14:
            return None

        feature_names = preprocess.get("feature_names", [])
        means = preprocess.get("means", [])
        stds = preprocess.get("stds", [])
        numeric_idx = preprocess.get("numeric_feature_indices", [])

        matrix = np.zeros((14, 8), dtype=np.float32)
        for t, shift in enumerate(window_shifts):
            for fi, fname in enumerate(feature_names):
                val = self._extract_feature(shift, fname)
                matrix[t, fi] = val

        # Standardize numeric features
        for fi in numeric_idx:
            if fi < 8 and stds[fi] > 0:
                matrix[:, fi] = (matrix[:, fi] - means[fi]) / stds[fi]

        return matrix.reshape(1, 14, 8)

    def _extract_feature(self, shift: Dict[str, Any], fname: str) -> float:
        """Extract one feature value from a shift dict."""
        from datetime import datetime

        start = shift["start_utc"]
        end = shift["end_utc"]
        duration_hours = (end - start).total_seconds() / 3600.0

        if fname == "duration_hours":
            return duration_hours
        elif fname == "start_hour":
            return float(start.hour + start.minute / 60.0)
        elif fname == "is_weekend":
            return 1.0 if start.date().weekday() >= 5 else 0.0
        elif fname == "shift_day":
            return 1.0 if shift.get("shift_type") == "day" else 0.0
        elif fname == "shift_evening":
            return 1.0 if shift.get("shift_type") == "evening" else 0.0
        elif fname == "shift_night":
            return 1.0 if shift.get("shift_type") == "night" else 0.0
        return 0.0

    def _heuristic_fatigue(
        self,
        shifts: List[Dict[str, Any]],
        current_date: Any,
    ) -> float:
        """Fast rules-based fatigue score (0-1).

        Based on: rest hours, consecutive days worked, weekly hours, night shifts.
        """
        past_shifts = [s for s in shifts if s["start_utc"].date() < current_date]
        past_shifts.sort(key=lambda s: s["start_utc"], reverse=True)

        if not past_shifts:
            return 0.0

        last_shift = past_shifts[0]
        rest_hours = (current_date - last_shift["end_utc"].replace(tzinfo=None)).total_seconds() / 3600.0
        rest_hours = max(0.0, rest_hours)

        # Count consecutive days worked (backward from yesterday)
        consecutive = 0
        check_date = current_date - timedelta(days=1)
        for shift in past_shifts:
            shift_date = shift["start_utc"].date()
            if shift_date == check_date:
                consecutive += 1
                check_date -= timedelta(days=1)
            elif shift_date < check_date:
                break

        # Hours in last 7 days
        week_start = current_date - timedelta(days=7)
        weekly_hours = 0.0
        for shift in past_shifts:
            if week_start <= shift["start_utc"].date() < current_date:
                weekly_hours += (shift["end_utc"] - shift["start_utc"]).total_seconds() / 3600.0

        # Night shifts in last 14 days
        two_week_start = current_date - timedelta(days=14)
        night_count = 0
        for shift in past_shifts:
            if two_week_start <= shift["start_utc"].date() < current_date:
                if shift.get("shift_type") == "night":
                    night_count += 1

        rest_penalty = max(0.0, (12.0 - rest_hours) / 12.0) * 0.40 if rest_hours < 12 else 0.0
        consec_penalty = max(0.0, min(1.0, (consecutive - 3) / 4.0)) * 0.25
        weekly_penalty = max(0.0, min(1.0, (weekly_hours - 40.0) / 20.0)) * 0.20
        night_penalty = min(0.10, night_count * 0.02)

        baseline = 0.05
        return min(1.0, baseline + rest_penalty + consec_penalty + weekly_penalty + night_penalty)

    def get_fatigue_trajectory_for_employee(
        self,
        employee_id: int,
        shifts: List[Dict[str, Any]],
        start_date: Any,
        num_days: int,
        prefer_model: bool = True,
    ) -> List[float]:
        """Convenience method for single employee fatigue trajectory."""
        return self._score_employee_fatigue(shifts, start_date, num_days, prefer_model)
