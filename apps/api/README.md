# Scheduler Backend API

FastAPI backend for the scheduler platform.

## How to run

```bash
cd apps/api
uv sync
uv run fastapi dev
```

## Current backend slice

This branch implements the first clean integration contract between the workload forecaster and the optimizer:

- workload stays **UTC + hourly**
- optimizer consumes **integer UTC hourly demand**
- region assignment is deferred to the next layer
- schedule generation endpoint currently returns a planning-ready demand payload

## Endpoints

- `GET /health`
- `GET /api/v1/config`
- `POST /api/v1/demand/transform`
- `POST /api/v1/schedule/generate`
- `GET /api/v1/schedule/health`

## Tests

```bash
cd apps/api
python -m pytest
```
