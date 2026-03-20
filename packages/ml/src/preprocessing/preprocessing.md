# Preprocessing Pipeline - Summary

## Overview
Successfully implemented the metadata injection preprocessing strategy for AI Scheduler.

## Architecture
- **The Body**: Humanity-Export 2025 (14 employees, 2,953 shifts, Jan-Dec 2025)
- **The Brain**: Schedule-2025 Shifts metadata (8 position definitions)
- **Strategy**: Inject position metadata from Schedule into Humanity timeline

## Output Files Generated

### 1. fatigue_training_data.csv
- **Purpose**: Training data for Fatigue Scorer LSTM
- **Records**: 2,953 shift records
- **Columns** (22 total):
  - Employee: `employee_id`, `location`
  - Time: `start_utc`, `end_utc`, `duration_hours`
  - Position: `position`, `shift_type`, `work_category`
  - Fatigue Features: `rest_hours`, `consecutive_days`, `hours_worked_last_7d`, `hours_worked_last_14d`, `shifts_last_7d`, `night_shifts_last_14d`
  - Temporal: `day_of_week`, `day_of_month`, `month`, `is_weekend`, `start_hour_local`
  - Placeholders: `estimated_ticket_load`, `workload_intensity`
  - Quality: `match_quality`

### 2. workload_training_data.csv
- **Purpose**: Training data for Workload Forecaster LSTM
- **Records**: 8,313 hourly records
- **Columns** (15 total):
  - Time: `timestamp_utc`
  - Target: `active_staff_count`
  - Breakdown: `day_shifts`, `night_shifts`, `evening_shifts`
  - Temporal: `hour_of_day`, `day_of_week`, `day_of_month`, `month`, `is_weekend`
  - Lag Features: `active_staff_1h_ago`, `active_staff_24h_ago`, `active_staff_7d_ago`, `avg_staff_last_24h`
  - Placeholders: `is_holiday`

### 3. preprocessing_report.json
- **Purpose**: Data quality metrics
- **Key Metrics**:
  - Total shifts: 2,953
  - Employees: 14
  - Date range: 2025-01-01 to 2026-01-01
  - Match quality: 97.2% exact matches (2,869), 2.8% inferred (84)
  - Position distribution: Top position is "9. Weekend1 CA MDR" (1,053 shifts)
  - Shift types: 1,440 day, 957 night, 556 evening
  - Average shift duration: 7.99 hours
  - Total hours worked: 23,588.88 hours

## Data Quality

### Match Quality
- **97.2% exact matches**: Time and duration matched precisely to defined positions
- **2.8% inferred**: Shifts that didn't match any defined position (classified by start hour heuristic)

### Position Distribution
1. **9. Weekend1 CA MDR** (1,053): Canada weekend morning shifts (8am-4pm)
2. **8. Weekend1 RCMT MDR** (498): Serbia weekend night shifts (12am-8am)
3. **7. Afternoon2 CA MDR** (438): Canada afternoon shifts (4pm-12am)
4. **2. Hybrid1 RCMT MDR** (406): Serbia hybrid shifts (4am-12pm)
5. **5. Morning3 CA MDR** (361): Canada late morning shifts (10am-6pm)

### Employees
All 14 employees processed successfully:
- Canada: CAN_01 through CAN_09 (9 employees)
- Serbia: SRB_01 through SRB_04 (4 employees)
- India: IND_01 (1 employee)

## Key Features

### Fatigue Scorer Features
- **Rest tracking**: Hours between shifts, consecutive working days
- **Workload history**: Rolling 7-day and 14-day totals
- **Shift intensity**: Night shift count, workload per hour
- **Temporal patterns**: Day of week, weekend flags, time of day

### Workload Forecaster Features
- **Staffing levels**: Active staff count per hour
- **Shift composition**: Breakdown by day/night/evening
- **Temporal patterns**: Hour, day, month, weekend flags
- **Lag features**: 1h, 24h, 7-day lookback, rolling averages

## Technical Details

### Timezone Handling
- All input times assumed to be EST (Toronto timezone, UTC-5)
- All output times converted to UTC
- Preserves `start_dt_local` for circadian rhythm analysis

### Metadata Injection Logic
1. Normalize time strings (remove `:00` from `4:00am` → `4am`)
2. Match by (start_time, duration) tuple
3. Disambiguate weekend vs weekday positions using day_of_week
4. Fallback to heuristic classification if no exact match

### Rolling Window Features
- Calculated per employee using 7 and 14 shift lookback windows
- Handles first shifts with default rest hours (48h)
- Tracks consecutive working days (resets when rest > 24h)

## Next Steps

1. **Review the data**:
   ```bash
   head data/processed/fatigue_training_data.csv
   head data/processed/workload_training_data.csv
   ```

2. **Build LSTM models**:
   - `ml/src/models/fatigue_lstm.py` - Predict fatigue score (0-1)
   - `ml/src/models/workload_lstm.py` - Predict active staff count

3. **Enhance features** (future):
   - Add holiday flags from `data/holidays/` JSON files
   - Replace `estimated_ticket_load` placeholder with real ticket volume data
   - Add employee seniority/role metadata

## Usage

Run the preprocessing pipeline:
```bash
cd ml/src/preprocessing
python run_preprocessing.py
```

Or use as a module:
```python
from src.preprocessing import main
main()
```

## File Structure
```
ml/src/preprocessing/
├── __init__.py              # Module exports
├── config.py                # Constants and paths
├── preprocessing.py         # Main pipeline logic
└── run_preprocessing.py     # Entry point script

data/processed/
├── fatigue_training_data.csv      # Employee timeline for Fatigue LSTM
├── workload_training_data.csv     # Hourly staffing for Workload LSTM
└── preprocessing_report.json      # Quality metrics
```

## Dependencies
- pandas >= 2.0.0
- numpy >= 1.24.0
- openpyxl >= 3.1.0 (for reading .xlsx files)
