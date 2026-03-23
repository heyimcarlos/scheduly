# Project Index: Scheduler

**Generated:** 2026-03-23
**Type:** Monorepo (Turborepo)

## Project Structure

```
scheduler/
├── apps/
│   ├── api/          # FastAPI Python backend
│   │   ├── app/
│   │   │   ├── api/routes.py        # HTTP endpoints (/api/v1/)
│   │   │   ├── core/config.py       # pydantic-settings
│   │   │   ├── lib/optimizer.py     # OR-Tools CP-SAT solver
│   │   │   ├── models/schemas.py     # Pydantic models
│   │   │   ├── services/
│   │   │   │   ├── optimizer.py      # Orchestrator service
│   │   │   │   ├── demand.py         # DemandGenerator
│   │   │   │   ├── availability.py   # AvailabilityService (DST-aware UTC windows)
│   │   │   │   ├── recommendations.py # FatigueAwareRecommendationService
│   │   │   │   ├── validator.py       # ValidatorService
│   │   │   │   └── job_store.py      # In-memory async job queue
│   │   │   └── main.py               # FastAPI app + CORS
│   │   └── tests/                    # pytest
│   └── web/          # React + Vite frontend
│       └── src/
│           ├── App.tsx               # Router setup
│           ├── pages/                # Route pages
│           │   ├── Auth.tsx, Index.tsx, Employees.tsx
│           │   ├── employee/Schedule.tsx, Profile.tsx, Requests.tsx
│           │   └── manager/Onboarding.tsx, ManagerRequests.tsx
│           ├── components/
│           │   ├── scheduler/        # TimelineScheduler, CalendarGrid, ShiftCard
│           │   │   ├── RecommendationSheet.tsx
│           │   │   └── FatigueRing.tsx
│           │   ├── layout/           # AppLayout, EmployeeLayout
│           │   └── ui/              # Radix UI primitives
│           ├── hooks/               # React Query hooks
│           │   ├── useSchedulerData.ts
│           │   ├── useEmergencyRecommendations.ts
│           │   ├── useAbsenceImpact.ts
│           │   └── useRedistribute.ts
│           ├── lib/api.ts           # API client
│           └── integrations/supabase/ # Auth + client
├── packages/
│   ├── shared/
│   │   └── system_config.json  # Regions, shift slots, team profiles
│   ├── ml/                    # Fatigue (LSTM) + workload forecasting
│   │   └── src/
│   │       ├── fatigue/       # fatigue_scorer.py, fatigue_inference.py
│   │       ├── workload/      # LSTM model (deprecated)
│   │       └── preprocessing/
│   ├── ui/                   # Shared UI stubs
│   ├── eslint-config/
│   ├── typescript-config/
│   └── note_parser/          # SME note parsing
├── package.json              # Turborepo (pnpm)
├── turbo.json
└── pnpm-workspace.yaml
```

## Entry Points

| App | Command | Description |
|-----|---------|-------------|
| API | `cd apps/api && uv run fastapi dev` | FastAPI dev server |
| Web | `cd apps/web && bun dev` | Vite dev server (port 5173) |
| Tests | `cd apps/api && python -m pytest` | pytest |
| Build | `pnpm build` | Build all apps |

## API Endpoints (`/api/v1/`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/config` | System config (regions, slots, profiles) |
| POST | `/demand/transform` | Transform demand inputs |
| POST | `/availability/plan` | Build employee availability windows |
| POST | `/emergency/recommendations` | Fatigue-aware replacement ranking |
| POST | `/absence/impact` | Analyze absence coverage impact |
| POST | `/validation/plan` | Validate schedule constraints |
| POST | `/schedule/generate` | Sync schedule generation |
| POST | `/schedule/generate/async` | Async schedule generation (returns job_id) |
| GET | `/schedule/job/{job_id}` | Poll async job status |
| GET | `/schedule/health` | Health check |

## Core Services

- **OptimizerService** (`optimizer.py`) — Orchestrator, coordinates DemandGenerator, AvailabilityService, FatigueAwareRecommendationService, ValidatorService
- **DemandGenerator** (`demand.py`) — Normalizes shift/slot demand, expands workload templates
- **AvailabilityService** (`availability.py`) — Builds UTC availability windows with DST-aware conversion
- **FatigueAwareRecommendationService** (`recommendations.py`) — Ranks replacement candidates by region fit + overtime + fatigue
- **lib/optimizer.py** — OR-Tools CP-SAT two-pass solver (canonical → patch)

## Key Configuration

`packages/shared/system_config.json`:
- **Regions:** Canada (America/Toronto), Serbia (Europe/Belgrade), India (Asia/Kolkata)
- **Shift types:** day (5-11), evening (12-21), night (22-4) [local hours]
- **Shift slots:** Hybrid1, Morning1-3, Evening1-2, Night1
- **Team profiles:** `follow_the_sun_support` (default) — slot policies with region constraints

## Scheduling Contract

- All dates are UTC
- Demand = integer headcount per shift type per day
- Solver enforces: min rest hours (12h), days off required (4), weekly hours threshold (40h)
- Two-pass: canonical slots first, then non-canonical patching

## Tech Stack

| Layer | Technology |
|-------|------------|
| API | FastAPI, pydantic, ortools, pandas |
| Web | React 18, Vite, React Query, Supabase, Radix UI, Tailwind |
| ML | TensorFlow (LSTM), scikit-learn |
| Infra | Turborepo, pnpm |
