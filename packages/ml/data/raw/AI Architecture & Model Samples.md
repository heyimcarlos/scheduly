# **AI Technical Deep Dive: Models, Inputs, and Logic**

This document outlines the technical architecture, model specifics, and team organization for the AI Scheduler POC.

## **1\. System Communication Flow (The "Change" Event)**

When the SME (Manager) makes a change—for example, marking a Canadian employee off from Feb 16–20—the system components communicate in this specific sequence:

1. **UI Event (React):** The manager drags a shift or approves a time-off request. The UI sends a ChangeRequest JSON to the backend.
2. **Context Enrichment (API Layer):** The backend pulls global context. It calls the **Holiday API** to see if India/Serbia are available to help and pulls the **Staffing Database** (Time zones, skills).
3. **Predictive Scoring (LSTM/XGBoost):** The ML models run. The LSTM calculates the current **Fatigue Score** for every available employee to ensure we don't pick someone who is already exhausted.
4. **Optimization Request (OR-Tools):** The "Gap" (Feb 16-20) \+ "Candidate List" (with Fatigue Scores) is sent to the Constraint Solver.
5. **Solution Generation:** The Solver finds the "cheapest" path (minimum fatigue increase) and returns a ProposedSchedule.
6. **UI Update:** The React frontend displays the new shifts as "Pending" for the manager to finalize.

![][image1]

## **2\. Team Breakdown & Research Resources**

To launch the POC quickly, here is how you can divide the labor along with key research starting points for each role:

### **Engineer 1: The "Optimizer" (Lead)**

* **Focus:** Core Logic (Google OR-Tools).
* **Task:** Define the hard constraints (24/7 coverage, max hours) and the soft constraints (fairness). This person builds the "engine" that fills the grid.
* **Research Resources:**
  * [Google OR-Tools Employee Scheduling Guide](https://developers.google.com/optimization/scheduling/employee_scheduling?_gl=1*58mxp3*_up*MQ..*_ga*MTg3MjY5NjQ3NC4xNzY5MDk3NTY2*_ga_SM8HXJ53K2*czE3NjkwOTc1NjYkbzEkZzAkdDE3NjkwOTc1NjYkajYwJGwwJGgw)
  * [Shift Scheduling Python Example (GitHub)](https://github.com/google/or-tools/blob/main/examples/python/shift_scheduling_sat.py)
  * [OR-Tools Main Repository](https://github.com/google/or-tools)

### **Engineer 2: The "ML Architect"**

* **Focus:** Predictive Models (LSTM/XGBoost).
* **Task:** Data preprocessing, model training on synthetic data, and creating the FatigueScore API endpoint.
* **Research Resources:**
  * Look into TensorFlow/Keras for LSTM implementations and XGBoost documentation for tabular probability predictions.

###

### **Engineer 3: The "Frontend/UX"**

* **Focus:** The Intelligent Calendar (React).
* **Task:** Build the drag-and-drop calendar view. Implement the "Red/Yellow/Green" visual feedback for shift conflicts.

### **Engineer 4: The "Backend/Integrations"**

* **Focus:** API & Data Flow (Python/FastAPI).
* **Task:** Connect the Holiday API, manage the Global Clock (UTC), and handle the JSON communication between ML models and the Solver.
* **Research Resources:**
  * [FastAPI Documentation & Repo](https://github.com/fastapi/fastapi)

### **Engineer 5: The "Data & SME Liaison"**

* **Focus:** Data Engineering & System Validation.
* **Task:** Generate high-quality synthetic data for training. They turn the SME’s "Notes" into mathematical constraints.

## **3\. Predictive Models (The "Human" Layer)**

### **A. The Burnout/Fatigue Predictor (LSTM)**

* **Input:** A 14-day sliding window of shift data: \[hours, shift\_type, rest\_time\].
* **Prediction:** FatigueScore (0.0 to 1.0).
* **Action:** If Score \> 0.8, the solver excludes this person from overtime.

### **B. The Availability Predictor (XGBoost)**

* **Input:** \[EmployeeID, DayOfWeek, Month, IsHoliday\].
* **Prediction:** ProbabilityOfCallOut.

## **4\. Sample Model Input/Output for POC**

**LSTM Input (One Employee):**
```
[
  {"day": 1, "hours": 8, "rest": 16, "type": "day"},
  {"day": 2, "hours": 12, "rest": 8, "type": "night"}
]
```

**LSTM Output:** {"fatigue\_index": 0.72}

**Solver Output (The Redistribution):**
```
{
  "gap_filled": "Feb 16 - 20",
  "assignments": [
    {"staff_id": "IND_05", "shift": "08:00-16:00 UTC", "reason": "Low fatigue score"},
    {"staff_id": "SRB_02", "shift": "16:00-00:00 UTC", "reason": "Timezone overlap"}
  ]
}
```

**5\. Project Structure**
For a team of 5, a monorepo ensures that Engineer 4 (Backend) can easily integrate the work of Engineer 1 (Optimizer) and Engineer 2 (ML).

```
/ai-scheduler-poc
├── backend/                \# Engineer 4 (Lead) \- FastAPI/Python
│   ├── app/
│   │   ├── api/            \# Route handlers
│   │   ├── services/       \# Glue logic connecting ML and Solver
│   │   └── main.py
│   └── requirements.txt
├── frontend/               \# Engineer 3 \- React
│   ├── src/
│   │   ├── components/     \# Calendar, Drag-and-drop
│   │   └── hooks/          \# API communication
│   └── package.json
├── ml/                     \# Engineer 2 \- Training & Research
│   ├── notebooks/          \# Exploratory Data Analysis (EDA)
│   ├── src/
│   │   ├── preprocessing.py
│   │   ├── synthetic\_data.py
│   │   └── train\_lstm.py
│   └── models/             \# Saved .h5 or .pkl files
├── optimizer/              \# Engineer 1 \- OR-Tools Logic
│   ├── constraints.py      \# Hard and Soft rules
│   └── solver.py           \# The CP-SAT implementation
├── data/                   \# Engineer 5 \- SME Data & Validation
│   ├── raw/                \# Original SME notes/logs
│   ├── processed/          \# Cleaned data for ML
│   └── holidays/           \# JSON files for India/Serbia/Canada 2026
└── shared/                 \# JSON Schemas & Type Definitions
    └── schemas.json        \# The "Contract" all engineers follow
```

**6\. Data**

**Engineer 3 (Frontend)** knows exactly what fields to send when a manager clicks "Time Off."
**Engineer 2 (ML)** knows that the Fatigue Score must be a number between 0 and 1\.
**Engineer 4 (Backend)** knows to convert all times to **UTC** before passing them to **Engineer 1 (Optimizer)**.

```
{
  "$schema": "http://json-schema.org/draft-07/schema\#",
  "title": "AI Scheduler Shared Schema",
  "description": "The standardized data contract for Frontend, Backend, ML, and Solver components.",
  "definitions": {
    "employee": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "example": "CAN\_01" },
        "name": { "type": "string" },
        "location": { "type": "string", "enum": \["Canada", "India", "Serbia"\] },
        "timezone": { "type": "string", "example": "UTC-5" },
        "role": { "type": "string", "enum": \["Junior", "Senior", "Manager"\] },
        "max\_weekly\_hours": { "type": "integer", "default": 40 },
        "fatigue\_score": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": \["id", "location", "timezone"\]
    },
    "shift": {
      "type": "object",
      "properties": {
        "shift\_id": { "type": "string" },
        "employee\_id": { "type": "string" },
        "start\_time\_utc": { "type": "string", "format": "date-time" },
        "end\_time\_utc": { "type": "string", "format": "date-time" },
        "type": { "type": "string", "enum": \["day", "night", "on-call"\] }
      },
      "required": \["employee\_id", "start\_time\_utc", "end\_time\_utc"\]
    },
    "holiday": {
      "type": "object",
      "properties": {
        "date": { "type": "string", "format": "date" },
        "country": { "type": "string" },
        "name": { "type": "string" }
      }
    }
  },
  "main\_requests": {
    "change\_request": {
      "description": "Sent from Frontend to Backend when a manager modifies a schedule.",
      "type": "object",
      "properties": {
        "request\_type": { "type": "string", "enum": \["TIME\_OFF", "SHIFT\_SWAP", "AUTO\_FILL"\] },
        "target\_employee\_id": { "type": "string" },
        "start\_date": { "type": "string", "format": "date" },
        "end\_date": { "type": "string", "format": "date" }
      }
    },
    "solver\_payload": {
      "description": "The final package sent from Backend to Engineer 1's Optimizer.",
      "type": "object",
      "properties": {
        "unassigned\_gaps": {
          "type": "array",
          "items": { "$ref": "\#/definitions/shift" }
        },
        "available\_candidates": {
          "type": "array",
          "items": { "$ref": "\#/definitions/employee" }
        },
        "active\_holidays": {
          "type": "array",
          "items": { "$ref": "\#/definitions/holiday" }
        }
      }
    }
  }
}
```
