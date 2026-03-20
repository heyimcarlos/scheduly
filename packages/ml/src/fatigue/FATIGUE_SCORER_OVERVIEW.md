# Fatigue Scorer (AI Scheduler)

## 1) Module purpose

The **Fatigue Scorer** produces a per-shift fatigue signal in **[0, 1]** that the Scheduler can use as an input for:
- feasibility checks (e.g., avoid assignments when fatigue is high),
- optimization objectives/constraints (e.g., fairness / load balancing),
- monitoring and reporting (fatigue snapshots per employee).

The scorer combines two layers:

1) **Rules-based baseline** (`fatigue_index`): an interpretable pseudo-label built from shift patterns such as rest time, consecutive days, night/weekend load, and recent hours.  
2) **Sequence model** (`predicted_fatigue`): an LSTM trained to predict the rules fatigue_index from the **last 14 shifts** of each employee. This smooths the baseline signal and yields a model-ready score for downstream integration.

---

## 2) Data

**Source file**
- `fatigue_training_data.csv` (exported scheduler training set)

**Observed dataset size (from latest run outputs)**
- Total shifts (rules-scored): **2953**
- Employees: **14**
- Shifts with LSTM predictions (windowed sequences): **2771** (**93.8%** coverage)

Coverage is < 100% because the LSTM requires a full history window of 14 shifts; early shifts per employee do not form a complete sequence.

---

## 3) Feature engineering + leakage-safe rollups

All feature work is centralized in `fatigue_data.py`:

### Core shift features
Per shift we use (or recompute) fields such as:
- `duration_hours`, `rest_hours`
- `start_hour` (prefers local hour from the CSV)
- `is_weekend`
- `consecutive_days_lag` (lagged to avoid “counting today” in today’s features)

### Leakage-safe rolling aggregates
The CSV includes rolling aggregates, but those typically include the *current* shift.  
To avoid “label leakage” into the baseline and into the LSTM inputs, this implementation recomputes:

- `hours_worked_last_7d`: rolling sum of **past** hours in the prior 7 days (excluding the current shift)  
- `night_shifts_last_14d`: rolling sum of **past** night shifts in the prior 14 days  
- `weekend_shifts_last_14d`: rolling sum of **past** weekend shifts in the prior 14 days  

These are implemented with a “shift-by-1 then rolling window” approach.

### One-hot shift type
For the LSTM, shift type is encoded into:
- `shift_day`, `shift_evening`, `shift_night`

---

## 4) Rules-based fatigue_index (pseudo-label)

The baseline fatigue score is a weighted sum of penalty components (each clipped to [0,1]):

- **Rest penalty** (short rest increases fatigue)
- **Consecutive-days penalty** (long streak increases fatigue)
- **Night-load penalty** (more nights in last 14 days increases fatigue)
- **Hours-load penalty** (more hours in last 7 days increases fatigue)
- **Weekend-load penalty**
- **Immediate shift-type penalty** (small nudge for evening/night)

Current weights:
- rest 0.40, consec 0.25, night 0.20, hours7d 0.10, weekend 0.03, shift 0.02

**Distribution (rules)**
- `fatigue_index`: min=0.000, mean=0.116, max=0.690

---

## 5) LSTM model

### Configuration (current run)
- Window length: **14**
- Epochs: **30**
- Batch size: **32**
- Validation fraction: **0.20** (time-based split)
- Seed: **42**
- Early stopping: **patience=5**, restores best weights (best epoch ≈ 26)

### Architecture
- LSTM(64) → Dense(32, ReLU) → Dense(1, Sigmoid)
- Optimizer: Adam
- Loss: MSE
- Metric: MAE

### Train/validation split strategy
Validation is **time-based**: the last 20% of sequences by `start_utc` are used for validation. This better matches a real deployment scenario than random shuffling.

---

## 6) Outputs

The scorer writes three files to `./outputs/`:

1) `fatigue_scored_shifts.csv`  
   All shifts with `fatigue_index` (plus component penalties).

2) `fatigue_predicted_shifts.csv`  
   The subset of shifts that have full 14-shift sequences, with `predicted_fatigue`.

3) `fatigue_current_by_employee.csv`  
   Latest snapshot per employee for scheduler usage.

---

## 7) Result analysis (latest run)

### Training curve (high-level)
- Training loss decreases from ~0.0368 → ~0.0008 across 30 epochs.
- Validation MAE stabilizes around **~0.023–0.024** by the end.
- Best validation performance occurs around **epoch ~26** (weights restored).

### Predicted fatigue distribution
- `predicted_fatigue`: min=0.002, mean=0.117, max=0.527, std=0.111

The predicted score tracks the rules mean closely (mean ~0.116 vs ~0.117) and shows slightly lower extreme max than the rules baseline.

### Fit vs pseudo-label (all predicted rows)
- MAE: **0.0183**
- RMSE: **0.0322**
- R²: **0.9192**
- Pearson correlation: **0.9591**

**Time split metrics**
- Train: n=2216, MAE=0.0171, RMSE=0.0294, R²=0.9329, corr=0.9662
- Val:   n=555, MAE=0.0232, RMSE=0.0416, R²=0.8639, corr=0.9320

### Quantiles (rules vs predicted)
|   quantile |   fatigue_index |   predicted_fatigue |
|-----------:|----------------:|--------------------:|
|       0.05 |           0     |               0.015 |
|       0.25 |           0.029 |               0.022 |
|       0.5  |           0.057 |               0.054 |
|       0.75 |           0.239 |               0.247 |
|       0.95 |           0.282 |               0.285 |

### Current snapshot (top 5 by latest fatigue_index)
| employee_id   |   fatigue_index |   predicted_fatigue |
|:--------------|----------------:|--------------------:|
| SRB_04        |        0.282143 |            0.269807 |
| SRB_02        |        0.282143 |            0.253906 |
| IND_01        |        0.253571 |            0.20783  |
| SRB_01        |        0.238571 |            0.258851 |
| SRB_03        |        0.176667 |            0.236379 |

---

## 8) Limitations and room for improvement

1) **The model learns a pseudo-label, not true fatigue**  
   Today the LSTM is trained to reproduce the rules-based fatigue_index. That’s still useful (smooth score + learnable function),
   but it does not validate against real-world fatigue outcomes (errors, injuries, self-report, absenteeism, etc.).

2) **Missing baseline comparisons**  
   Because the pseudo-label is deterministic given engineered features, a simpler model (linear regression / small MLP) might match
   performance without sequence modeling. Adding a baseline gives a strong “why LSTM” justification.

3) **Validation strategy is time-based but still from the same employees**  
   This tests generalization over time, but not generalization to new employees. A second evaluation mode (employee-holdout) could
   be useful if the scheduler will frequently onboard new staff.

4) **Limited feature set for context**  
   The current features are schedule-derived only. Potential future additions:
   - role / station type, shift difficulty
   - time since last *night* shift, or consecutive nights
   - “short-turn” flags (e.g., closing → opening)
   - PTO/absence signals, or shift swaps
   - workload intensity proxies (if available)

5) **Calibration + interpretability for business usage**  
   The predicted score is smooth, but business users usually want interpretable triggers (“why is fatigue high today?”).
   A small explanation layer can be added:
   - expose the top contributing penalties from the rules baseline
   - show trendlines for hours7d, nights14d, rest_hours per employee

