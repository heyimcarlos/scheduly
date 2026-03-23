# Requirements Specification: API Shifts Integration

**Date:** 2026-03-23
**Status:** Approved

---

## 1. Architecture

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Web App   │──────▶│  FastAPI    │──────▶│  Supabase   │
│  (React)    │       │   API       │       │  (DB)       │
└─────────────┘       └─────────────┘       └─────────────┘
     │                    │
     │ Shifts READ        │ Shifts WRITE
     │ (direct)            │ (from solver)
     ▼                    │
  Supabase ◀──────────────┘
```

### Data Flow

1. **Schedule Generation:** Web → API (demand + employees) → API runs OR-Tools solver → API writes shifts to Supabase
2. **Schedule Display:** Web reads shifts from Supabase (direct)

### Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Web App** | Reads shifts from Supabase, sends schedule request to API |
| **FastAPI API** | Runs OR-Tools solver, writes shifts to Supabase |
| **Supabase** | Stores shifts, auth, profiles, team data |

---

## 2. API Shifts Write Operations

The FastAPI API writes shifts to Supabase using `supabase-py`.

### Operations

| Operation | Table | Trigger |
|----------|-------|---------|
| `create_shifts_bulk` | `shifts` | After schedule generation |
| `update_shift` | `shifts` | Manual shift edit |
| `delete_shift` | `shifts` | Shift deletion |

---

## 3. Implementation Requirements

### 3.1 Python API (supabase-py)

**FR-001:** API must use `supabase-py` to write shifts to Supabase
**FR-002:** API must have service role key for admin database access
**FR-003:** API client must be memoized (created once, reused)

### 3.2 Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key for writing shifts |

### 3.3 Shifts Table Schema (reference)

```sql
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES team_members(id),
  shift_type text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  is_pending boolean DEFAULT false,
  is_conflict boolean DEFAULT false,
  is_efficient boolean DEFAULT true,
  is_high_fatigue boolean DEFAULT false,
  has_rest_violation boolean,
  title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

---

## 4. Non-Functional Requirements

**NFR-001:** Shifts written by API must match the solver output exactly
**NFR-002:** API must handle Supabase write failures gracefully
**NFR-003:** Client creation must be memoized (no re-creation per request)

---

## 5. Acceptance Criteria

- [ ] API uses `supabase-py` to write shifts after schedule generation
- [ ] API has service role key configured
- [ ] Web app reads shifts from Supabase directly
- [ ] No shifts written directly from web app
