# LLM Note Parser — Optimizer Integration

## 1. Problem Statement

The Scheduly platform has two independent subsystems that need to communicate:

1. **LLM Note Parser** — Uses Google Gemini to convert free-text manager notes (e.g., "Alice is sick tomorrow") into structured `SchedulingEvent[]` objects.
2. **OR-Tools CP-SAT Optimizer** — Generates optimal shift schedules via a `ScheduleRequest` payload containing employee rosters, demand, and absence data.

These subsystems were disconnected. The note parser displayed parsed events in the sidebar UI, but the `handleProcessNotes` callback in `SchedulerLayout.tsx` was a no-op. Parsed events never reached the optimizer.

### Payload Mismatch

| Dimension | Note Parser Output | Optimizer Input |
|---|---|---|
| Employee identity | `employee: string` (name) | `employee_id: number` (array index) |
| Date format | `affected_dates: string[]` (discrete ISO dates) | `AbsenceEventWindow: { employee_id, start_date, end_date, reason }` (contiguous ranges) |
| Event semantics | `type: "sick_leave" \| "time_off" \| "swap" \| ...` | `reason: "sick" \| "vacation" \| "unavailable" \| "other"` |
| Unsupported types | `swap`, `coverage_request` | No direct equivalent in optimizer |

---

## 2. Architecture Decision

**Transformation lives in the frontend**, not as a new backend endpoint.

Rationale:
- Employee name-to-ID resolution depends on `teamMembers` state already available in `SchedulerLayout.tsx` (loaded via `useTeamMembers()` hook from Supabase).
- The transformation is pure and deterministic — no database queries or LLM calls required.
- A manager review step (approve/reject parsed events) can operate entirely on local React state without extra API round-trips.
- The backend already accepts `AbsenceEventWindow[]` in `ScheduleRequest.absence_events` — no schema changes needed.

### Data Flow

```
Manager enters free-text note
        |
        v
SMENotesPanel calls useNoteParser() mutation
        |
        v
POST /api/v1/notes/parse  -->  Gemini LLM  -->  SchedulingEvent[]
        |
        v
ParsedEventsReview component (manager review step)
        |  - converts events via noteEventsToScheduleInput.ts
        |  - shows checkboxes, warnings, skip reasons
        |  - manager confirms selected events
        v
AbsenceEventWindow[] stored in SchedulerLayout state
        |
        v
Manager clicks "AI Redistribute"
        |
        v
absence_events merged into ScheduleRequest
        |
        v
POST /api/v1/schedule/generate/async  -->  OR-Tools CP-SAT Solver
        |
        v
Solved schedule rendered as ghost shifts in timeline
```

---

## 3. Implementation

### 3.1 Conversion Utility

**File:** `apps/web/src/lib/noteEventsToScheduleInput.ts`

Pure functions with no React dependencies:

#### `resolveEmployeeId(name, roster): number | null`

Resolves a name string to a roster array index (used as `employee_id` by the optimizer). Uses two-pass matching:
1. **Exact match** (case-insensitive) — `"alice chen"` matches `"Alice Chen"`
2. **Substring match** — `"Alice"` matches `"Alice Chen"` if unambiguous

Returns `null` if no match or multiple matches (ambiguous).

#### `groupDatesIntoWindows(dates): {start_date, end_date}[]`

Groups discrete ISO date strings into contiguous date ranges. Consecutive dates (gap <= 1 day) are merged into a single window.

```
Input:  ["2026-03-15", "2026-03-16", "2026-03-20"]
Output: [
  { start_date: "2026-03-15", end_date: "2026-03-16" },
  { start_date: "2026-03-20", end_date: "2026-03-20" }
]
```

#### `mapEventTypeToReason(type): string | null`

Maps note parser event types to optimizer absence reasons:

| Parser Event Type | Optimizer Reason | Notes |
|---|---|---|
| `sick_leave` | `"sick"` | Direct mapping |
| `time_off` | `"vacation"` | Direct mapping |
| `late_arrival` | `"unavailable"` | Full-day absence (optimizer has no partial-day concept) |
| `early_departure` | `"unavailable"` | Full-day absence |
| `swap` | `null` | Handled specially — see below |
| `coverage_request` | `null` | Skipped (future work) |

#### `convertEventsToScheduleInput(events, teamMembers): ConversionResult`

Main orchestrator that produces:

```typescript
interface ConversionResult {
  absenceEvents: AbsenceEventWindow[];   // Ready for optimizer
  warnings: ConversionWarning[];          // Non-blocking issues
  skippedEvents: SkippedEvent[];          // Events that couldn't be converted
}
```

**Skip conditions** (event goes to `skippedEvents`):
- `type` is `null` — unrecognized event
- `type` is `coverage_request` — not yet supported
- `employee` is `null` — no employee specified
- Employee name doesn't match any roster entry
- No `affected_dates` specified

**Swap handling:**
- The original employee is marked absent on the affected dates (reason: `"other"`)
- A warning is emitted noting the swap target — the optimizer will naturally reassign coverage

**Partial-day handling:**
- `late_arrival` and `early_departure` are treated as full-day absences with a warning, since the optimizer operates at day granularity

### 3.2 Review Component

**File:** `apps/web/src/components/scheduler/ParsedEventsReview.tsx`

Interactive review UI shown after the LLM parses a note. Each parsed event is rendered as a compact card with:

- **Checkbox** — default checked for high/medium confidence, unchecked for low confidence
- **Event icon and label** — reuses the icon set from `NoteParser.tsx` (`UserX`, `Coffee`, `Users`, etc.)
- **Resolved employee name** — shows the matched roster entry, or a red warning if unresolved
- **Computed absence windows** — date ranges derived from `groupDatesIntoWindows()`
- **Inline warnings** — partial-day warnings, swap notes, low confidence flags
- **Skip reasons** — shown for events that couldn't be converted

Actions:
- **Confirm (N)** — collects `AbsenceEventWindow[]` from checked events only, calls `onConfirm`
- **Cancel** — dismisses the review, returns to note input

### 3.3 SMENotesPanel Updates

**File:** `apps/web/src/components/scheduler/SMENotesPanel.tsx`

New props:
- `teamMembers: TeamMember[]` — passed to `ParsedEventsReview` for name resolution
- `onConfirmParsedEvents: (absenceEvents: AbsenceEventWindow[]) => void` — called when manager confirms

Behavior change:
- **Before:** parsed events were discarded after a toast notification; `onProcessNotes` received raw text
- **After:** parsed events are stored in local state and displayed in `ParsedEventsReview`; on confirm, `AbsenceEventWindow[]` are passed up via `onConfirmParsedEvents`

The `employee_roster` is now derived from `teamMembers.map(m => m.name)` and passed to the parse request, enabling the LLM to output exact roster names.

### 3.4 Sidebar Prop Threading

**File:** `apps/web/src/components/scheduler/SchedulerSidebar.tsx`

Prop change:
- Removed: `onProcessNotes: (notes: string) => void`
- Added: `onConfirmParsedEvents: (absenceEvents: AbsenceEventWindow[]) => void`

`teamMembers` (already a prop) is now threaded through to `SMENotesPanel`.

### 3.5 SchedulerLayout Wiring

**File:** `apps/web/src/components/scheduler/SchedulerLayout.tsx`

New state:
```typescript
const [parsedAbsenceEvents, setParsedAbsenceEvents] = useState<AbsenceEventWindow[]>([]);
```

Replaced the no-op `handleProcessNotes` with `handleConfirmParsedEvents` which sets this state.

In `handleRedistribute`, the `parsedAbsenceEvents` are merged into the `ScheduleRequest`:

```typescript
redistribute.trigger({
  start_date: startDateStr,
  num_days: 30,
  employees,
  team_profile_id: ...,
  team_profile_config: ...,
  ...(parsedAbsenceEvents.length > 0 && { absence_events: parsedAbsenceEvents }),
}, { memberIdsByEmployeeId });
```

After triggering, `parsedAbsenceEvents` is cleared. The toast message indicates how many absence events from parsed notes were included.

---

## 4. Files Changed

| File | Action | Description |
|---|---|---|
| `apps/web/src/lib/noteEventsToScheduleInput.ts` | Created | Pure conversion utility (name resolution, date grouping, type mapping) |
| `apps/web/src/components/scheduler/ParsedEventsReview.tsx` | Created | Manager review UI with checkboxes, warnings, confirm/cancel |
| `apps/web/src/components/scheduler/SMENotesPanel.tsx` | Modified | Added `teamMembers` and `onConfirmParsedEvents` props; shows review UI after parse |
| `apps/web/src/components/scheduler/SchedulerSidebar.tsx` | Modified | Updated prop interface; threads `teamMembers` to `SMENotesPanel` |
| `apps/web/src/components/scheduler/SchedulerLayout.tsx` | Modified | Added `parsedAbsenceEvents` state; merges into `ScheduleRequest` on redistribute |

No backend changes were required.

---

## 5. Verification

### Type Safety
- `npx tsc --noEmit` passes with zero errors after all changes.

### Manual E2E Test
1. Enter a note: _"Alice is sick tomorrow and won't make her night shift. Bob wants to swap Monday with Carlos."_
2. Click **Process Notes** — events appear in `ParsedEventsReview`
3. Verify: Alice's sick leave is checked (high confidence), swap event shows warning about Carlos
4. Click **Confirm** — toast shows N absence events queued
5. Click **AI Redistribute** — check Network tab to confirm `absence_events` is present in the `POST /schedule/generate/async` payload
6. Verify the solved schedule accounts for Alice's absence

### Edge Cases
- Low confidence events are unchecked by default
- Unresolved employee names show a red warning and are skipped in the output
- Partial-day events (`late_arrival`, `early_departure`) show a warning about full-day treatment
- `coverage_request` events are skipped with an explanation
- Empty employee or date fields result in skipped events with clear reasons

---

## 6. Future Work

- **Coverage requests:** Convert to `ShiftDemandPoint` entries with increased `minimum_headcount` for affected dates/shifts
- **Partial-day absences:** If the optimizer gains sub-day availability windows, map `affected_shifts` to specific shift slots
- **Manual employee override:** Add a dropdown in the review UI to manually select a team member when name resolution fails
- **Persistence:** Optionally save confirmed absence events to a database table so they persist across page reloads
