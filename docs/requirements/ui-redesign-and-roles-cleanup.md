# Requirements: UI Redesign & Roles Cleanup

**Date:** 2026-03-29
**Status:** Draft
**Authors:** Brainstorm session

---

## 1. Overview

Two independent but related initiatives:

1. **UI Redesign**: Make the Schedule (timeline) view the primary entry point, with Calendar as a drill-down side panel
2. **Roles Cleanup**: Implement team-scoped roles — a user can be manager of one team and employee of another, with admin having hierarchical access to all manager capabilities

---

## 2. UI: Schedule-First Navigation

### 2.1 Rename Views

| Old Name | New Name | Route | Description |
|---|---|---|---|
| `TimelineScheduler` | `ScheduleView` | `/manager` (default) | Horizontal timeline, employees as rows, days as columns |
| `SchedulerLayout` (Calendar) | `CalendarView` | `/manager/calendar` | Week/month calendar grid (existing behavior) |

- Sidebar nav: "Schedule" links to `/manager`, "Calendar" links to `/manager/calendar`
- URL change: `/manager/timeline` is removed (timeline is now the default at `/manager`)

### 2.2 Schedule View — Click Day → Calendar Side Panel

**Trigger:** User clicks any day cell in the Schedule view (empty or with shifts).

**Behavior:**
1. A `Sheet` (Radix `SheetContent`, right-side) opens showing that day's shifts in a calendar-like format
2. The sheet is titled with the date: "Monday, March 23"
3. The sheet shows all shifts for that day across all employees (not just the filtered employee row)
4. Each shift card in the sheet is clickable → opens `ShiftFormModal` for editing
5. Empty slot click in the sheet → opens `ShiftFormModal` pre-filled with that day/hour
6. Sheet has a "View full calendar" link/button that navigates to `/manager/calendar?date=YYYY-MM-DD`

**Existing pattern to replicate:** `RecommendationSheet` in `TimelineScheduler` (lines 405–415) — same `useState` + `Sheet` + `onOpenChange` pattern.

**Changes to `TimelineScheduler` (renamed `ScheduleView`):**
- Add `selectedDay: Date | null` state
- Add `dayPanelOpen: boolean` state
- Attach `onClick` handler to day cells (currently absent — only shift cards have click handlers)
- Import and render a `DayDetailSheet` component
- The `DayDetailSheet` queries shifts for `selectedDay` and displays them

**Data sharing:** The sheet should read from the same `useShifts()` data already loaded by `ScheduleView`, filtered by the selected day. No separate data fetch needed.

### 2.3 Calendar View (Route: `/manager/calendar`)

**Minimal changes — it should keep working as-is:**
- Move `SchedulerLayout` to route `/manager/calendar`
- Week/month toggle remains as-is inside `CalendarHeader`
- Optional: accept `?date=YYYY-MM-DD` query param to pre-select a date

### 2.4 Navigation Flow

```
/manager (Schedule)
  └── Click day cell → DayDetailSheet (right panel, calendar-like view of that day)
  └── Click "View full calendar" → /manager/calendar?date=YYYY-MM-DD

/manager/calendar (Calendar)
  └── Toggle: week view ↔ month view (existing)
  └── Click shift → ShiftFormModal (existing)
  └── Click empty slot → ShiftFormModal (existing)
```

### 2.5 Component Changes Summary

| Action | File | Change |
|---|---|---|
| Rename | `TimelineScheduler.tsx` | Rename to `ScheduleView.tsx` |
| Rename | `SchedulerLayout.tsx` | Keep file, update route to `/manager/calendar` |
| Rename | `CalendarGrid.tsx` | Keep file |
| Rename | `MonthlyCalendarGrid.tsx` | Keep file |
| Rename | `CalendarHeader.tsx` | Keep file |
| New | `DayDetailSheet.tsx` | Right-side sheet showing a day's shifts |
| Update | `App.tsx` routes | `/manager` → `ScheduleView`, `/manager/calendar` → `CalendarView` (`SchedulerLayout`) |
| Update | `AppLayout.tsx` sidebar | Add/rename nav items: "Schedule" → `/manager`, "Calendar" → `/manager/calendar` |

### 2.6 Open Questions

- [ ] Should the Schedule view also support the week/month toggle internally (like Calendar currently does), or remain timeline-only?
- [ ] Does the `DayDetailSheet` need to support creating new shifts directly, or only viewing/editing existing ones?

---

## 3. Roles: Team-Scoped Role System

### 3.1 Goal

A user can be:
- **Manager** of Team A (can edit schedules, view reports, manage team members for Team A)
- **Employee** of Team B (can view their own schedule, request time off)
- **Platform Admin** (can do everything across all teams, but does not automatically become a "manager" — admin is a separate dimension)

Roles are **not mutually exclusive**:
- Admin always has manager-level access across all teams (hierarchical)
- A non-admin user can be manager of some teams and employee of others
- A user with no team memberships can still have a platform role (e.g., admin of the organization)

### 3.2 Data Model Changes

**Current `user_roles` table (global app roles):**
```sql
user_roles(user_id, role)  -- role: admin | moderator | user | manager | employee
```

**Problem:** `user_roles` is global — it doesn't say *which team* a role applies to. Also, `manager` in `user_roles` conflates platform admin with team manager.

**New model:**

| Table | Purpose |
|---|---|
| `team_memberships` | Junction: `user_id`, `team_profile_id`, `role` (`manager` \| `employee`) — **the source of truth for team-scoped roles** |
| `user_roles` (keep) | Platform-level roles: `admin`, `moderator`, `user` (deprecated, can be ignored) |
| Deprecate `team_members.role` | This is a *job role* (`senior`, `junior`), not an app role — rename to `job_role` in a separate migration |

**`team_memberships` schema:**
```sql
CREATE TABLE team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  team_profile_id UUID REFERENCES team_profiles(id) NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'employee')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, team_profile_id)  -- one role per user per team
);
```

**Migration path:**
1. Create `team_memberships` table
2. Backfill: for each existing `user_roles` where `role = 'manager'`, create a `team_membership` entry for all teams the user owns (`team_profiles.owner_user_id = user_id`)
3. Backfill: for each existing `user_roles` where `role = 'employee'`, create a `team_membership` with the user's `profiles.team_member_id` → `team_members.team_profile_id`
4. Keep `user_roles` read path working during transition (for `admin`/`moderator` platform roles)
5. Later: deprecate `user_roles.role IN ('manager', 'employee')` entries

### 3.3 Frontend Changes

**`useAuth.tsx` — Role Resolution:**
```typescript
type PlatformRole = 'admin' | 'moderator' | 'user' | null;
type TeamRole = 'manager' | 'employee' | null;

interface AuthState {
  platformRole: PlatformRole;  // from user_roles (admin, moderator, user)
  teamRole: TeamRole;           // from team_memberships for active_team_profile_id
  isAdmin: boolean;              // platformRole === 'admin'
  isManager: boolean;            // teamRole === 'manager' || platformRole === 'admin'
}
```

**Role resolution logic:**
- `isManager = teamRole === 'manager' || platformRole === 'admin'`
- Admin always has manager access (hierarchical)
- `isAdmin = platformRole === 'admin'`
- Manager route guard: `isManager === true`
- Employee route guard: `!isManager`

**UI implications:**
- `ManagerRoute`: checks `isManager` (line ~20 in `ManagerRoute.tsx`)
- `EmployeeRoute`: checks `!isManager` (line ~14 in `EmployeeRoute.tsx`)
- `RoleRedirect`: redirects based on `isManager`

### 3.4 Backend Changes

**API Auth (currently non-existent — this is a gap):**
- The API has **zero auth** — all endpoints are open
- This cleanup should add JWT verification using Supabase JWTs
- All API routes should check: does the authenticated user have access to `team_profile_id` via `team_memberships`?
- `has_role()` Postgres function (exists but unused) should be wired up

**If backend auth is out of scope for this cleanup:** at minimum, `useAuth.tsx` should be updated to resolve team-scoped roles from `team_memberships`, and the frontend guards should continue to work as-is.

### 3.5 Open Questions

- [ ] **Backend auth scope**: Is adding API JWT verification part of this cleanup, or deferred to a separate story?
- [ ] **Migration sequencing**: Should the data migration (backfilling `team_memberships`) happen before or after the frontend changes?
- [ ] **Admin implicit manager**: Confirm that `platformRole === 'admin'` should grant manager-level access to **all teams** (not just owned teams)?
- [ ] **`team_members.role` cleanup**: Is renaming `team_members.role` → `job_role` in scope now, or deferred?

---

## 4. Acceptance Criteria

### UI
- [ ] `/manager` renders `ScheduleView` (timeline) by default
- [ ] Clicking any day cell in `ScheduleView` opens `DayDetailSheet` showing that day's shifts
- [ ] `DayDetailSheet` shifts are editable (click → `ShiftFormModal`)
- [ ] Empty slot in `DayDetailSheet` → `ShiftFormModal` pre-filled with day/time
- [ ] `DayDetailSheet` has "View full calendar" link to `/manager/calendar?date=YYYY-MM-DD`
- [ ] Sidebar nav has "Schedule" → `/manager` and "Calendar" → `/manager/calendar`
- [ ] `/manager/calendar` renders the existing week/month calendar with full behavior
- [ ] `RecommendationSheet` continues to work unchanged

### Roles
- [ ] A user can have `manager` role on Team A and `employee` role on Team B simultaneously
- [ ] `platformRole === 'admin'` grants manager-level access to all teams (hierarchical)
- [ ] `useAuth` exposes `teamRole`, `platformRole`, `isManager`, `isAdmin` separately
- [ ] `ManagerRoute` guard uses `isManager`
- [ ] `EmployeeRoute` guard uses `!isManager`
- [ ] `team_memberships` table exists with `user_id`, `team_profile_id`, `role`
- [ ] Backfill migration populates `team_memberships` from existing data

---

## 5. Out of Scope

- `/manager/timeline` URL removal (superseded by this spec)
- Backend API authentication/JWT verification (unless explicitly prioritized)
- `team_members.role` → `job_role` rename
- Workload forecasting LSTM integration
- Fatigue recommender UI changes
