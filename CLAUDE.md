# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scheduler is a scheduling platform with AI-powered shift optimization. It uses OR-Tools CP-SAT solver for scheduling and LSTM models for fatigue prediction.

## Monorepo Structure

```
apps/
  api/          - FastAPI Python backend
  web/          - React + Vite frontend
packages/
  ml/           - Fatigue scoring (LSTM) and workload forecasting models
  shared/       - Shared config (system_config.json with regions, shift slots, team profiles)
  ui/           - Shared UI component stubs
  note_parser/  - SME note parsing utility
  eslint-config/ - Shared ESLint config
  typescript-config/ - Shared TypeScript configs
```

## Common Commands

### Root (Turborepo)
```bash
pnpm build      # Build all apps
pnpm dev       # Run all apps in dev mode
pnpm lint      # Lint all apps
pnpm format    # Format with Prettier
```

### API (FastAPI)
```bash
cd apps/api
uv sync                         # Install dependencies
uv run fastapi dev              # Run dev server
uv run fastapi run              # Run production server
python -m pytest                # Run all tests
python -m pytest tests/test_x.py  # Run specific test file
```

### Web (React + Vite)
```bash
cd apps/web
bun install                     # Install dependencies
bun dev                         # Run dev server (port 5173)
bun build                       # Production build
bun test                        # Run tests with Vitest
bun test --watch                # Watch mode
```

### ML Package
```bash
cd packages/ml
uv sync
```

## Architecture

### API Layer (`apps/api/app/`)
- `main.py` - FastAPI app setup, CORS middleware
- `api/routes.py` - All HTTP endpoints under `/api/v1/`
- `models/schemas.py` - Pydantic request/response models
- `core/config.py` - Settings using pydantic-settings
- `services/` - Business logic layer:
  - `optimizer.py` - Main orchestrator, calls demand/availability/recommendations
  - `demand.py` - DemandGenerator for shift/slot demand
  - `availability.py` - AvailabilityService for employee availability windows
  - `recommendations.py` - FatigueAwareRecommendationService for emergency replacements
  - `validator.py` - ValidatorService for schedule validation
- `lib/optimizer.py` - OR-Tools CP-SAT solver integration

### Web Layer (`apps/web/src/`)
- `App.tsx` - Main router setup
- `pages/` - Route pages (Auth, Index, Employees, employee/*, manager/*)
- `components/scheduler/` - Core scheduling components (TimelineScheduler, CalendarGrid, etc.)
- `components/ui/` - Radix UI primitives with Tailwind
- `hooks/` - React Query hooks (useSchedulerData, useEmergencyRecommendations, useAbsenceImpact)
- `lib/api.ts` - API client functions
- `integrations/supabase/` - Supabase auth and client

### Shared Config (`packages/shared/system_config.json`)
Defines regions (Canada, Serbia, India), shift types (day/evening/night), shift slots with UTC times, and team profiles with coverage rules and region assignments.

### ML Package (`packages/ml/`)
- `src/fatigue/` - Fatigue scoring using LSTM model
- `src/workload/` - Workload forecasting LSTM model - Currently deprecated (might use it after launch)
- `src/preprocessing/` - Data preprocessing pipeline

## Key Patterns

### API Request Flow
`routes.py` → `OptimizerService` → `DemandGenerator`/`AvailabilityService`/`RecommendationsService` → `lib/optimizer.py` (CP-SAT solver)

### Web → API Communication
React Query hooks call `lib/api.ts` functions which fetch from `http://localhost:8000/api/v1/`

### Scheduling Contract
- All dates are UTC
- Demand is specified as integer headcount per shift type per day
- Team profiles define slot policies with region constraints and penalties
- Solver produces assignments respecting min rest hours and days off requirements
