/**
 * Converts parsed SchedulingEvent[] from the LLM note parser
 * into AbsenceEventWindow[] consumable by the optimizer.
 */

import type { SchedulingEvent, AbsenceEventWindow } from './api';
import type { TeamMember } from '@/types/scheduler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversionWarning {
  eventIndex: number;
  message: string;
}

export interface SkippedEvent {
  event: SchedulingEvent;
  reason: string;
}

export interface ConversionResult {
  absenceEvents: AbsenceEventWindow[];
  warnings: ConversionWarning[];
  skippedEvents: SkippedEvent[];
}

// ---------------------------------------------------------------------------
// Employee name → ID resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an employee name to the roster index (used as employee_id).
 * Uses case-insensitive substring matching. Returns null if no match or ambiguous.
 */
export function resolveEmployeeId(
  name: string,
  roster: Pick<TeamMember, 'name'>[],
): number | null {
  const lower = name.toLowerCase().trim();
  if (!lower) return null;

  // Try exact match first (case-insensitive)
  const exactIdx = roster.findIndex(
    (m) => m.name.toLowerCase().trim() === lower,
  );
  if (exactIdx !== -1) return exactIdx;

  // Substring match — name contained in roster entry or vice versa
  const matches: number[] = [];
  for (let i = 0; i < roster.length; i++) {
    const rosterName = roster[i].name.toLowerCase().trim();
    if (rosterName.includes(lower) || lower.includes(rosterName)) {
      matches.push(i);
    }
  }

  if (matches.length === 1) return matches[0];
  return null; // ambiguous or no match
}

// ---------------------------------------------------------------------------
// Date grouping
// ---------------------------------------------------------------------------

/**
 * Groups an array of ISO date strings into contiguous windows.
 * e.g. ["2026-03-15","2026-03-16","2026-03-20"] →
 *   [{start_date:"2026-03-15", end_date:"2026-03-16"}, {start_date:"2026-03-20", end_date:"2026-03-20"}]
 */
export function groupDatesIntoWindows(
  dates: string[],
): { start_date: string; end_date: string }[] {
  if (dates.length === 0) return [];

  const sorted = [...dates].sort();
  const windows: { start_date: string; end_date: string }[] = [];

  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(end);
    const curr = new Date(sorted[i]);
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 1) {
      end = sorted[i];
    } else {
      windows.push({ start_date: start, end_date: end });
      start = sorted[i];
      end = sorted[i];
    }
  }

  windows.push({ start_date: start, end_date: end });
  return windows;
}

// ---------------------------------------------------------------------------
// Event type → absence reason mapping
// ---------------------------------------------------------------------------

const EVENT_TYPE_TO_REASON: Record<string, string> = {
  sick_leave: 'sick',
  time_off: 'vacation',
  late_arrival: 'unavailable',
  early_departure: 'unavailable',
};

/**
 * Maps a note parser event type to the optimizer's absence reason.
 * Returns null for types that don't map to a simple absence (swap, coverage_request).
 */
export function mapEventTypeToReason(
  type: SchedulingEvent['type'],
): string | null {
  if (!type) return null;
  return EVENT_TYPE_TO_REASON[type] ?? null;
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

/**
 * Convert parsed SchedulingEvent[] into optimizer-compatible AbsenceEventWindow[],
 * with warnings for edge cases and skipped events.
 */
export function convertEventsToScheduleInput(
  events: SchedulingEvent[],
  teamMembers: Pick<TeamMember, 'name'>[],
): ConversionResult {
  const absenceEvents: AbsenceEventWindow[] = [];
  const warnings: ConversionWarning[] = [];
  const skippedEvents: SkippedEvent[] = [];

  events.forEach((event, idx) => {
    // Low confidence warning
    if (event.confidence === 'low') {
      warnings.push({
        eventIndex: idx,
        message: 'Low confidence — verify before including',
      });
    }

    // Skip null/unknown types
    if (!event.type) {
      skippedEvents.push({ event, reason: 'Unrecognized event type' });
      return;
    }

    // Skip coverage_request (no optimizer equivalent yet)
    if (event.type === 'coverage_request') {
      skippedEvents.push({
        event,
        reason: 'Coverage requests are not yet supported as optimizer input',
      });
      return;
    }

    // Resolve employee
    if (!event.employee) {
      skippedEvents.push({ event, reason: 'No employee specified' });
      return;
    }

    const employeeId = resolveEmployeeId(event.employee, teamMembers);
    if (employeeId === null) {
      skippedEvents.push({
        event,
        reason: `Could not match employee "${event.employee}" to roster`,
      });
      return;
    }

    // No dates = nothing to schedule
    if (event.affected_dates.length === 0) {
      skippedEvents.push({ event, reason: 'No affected dates specified' });
      return;
    }

    // Handle swap: mark original employee absent, warn about target
    if (event.type === 'swap') {
      const windows = groupDatesIntoWindows(event.affected_dates);
      for (const w of windows) {
        absenceEvents.push({
          employee_id: employeeId,
          start_date: w.start_date,
          end_date: w.end_date,
          reason: 'other',
        });
      }
      warnings.push({
        eventIndex: idx,
        message: `Swap with ${event.swap_target ?? 'unknown'} — ${event.employee} marked absent; optimizer will reassign coverage`,
      });
      return;
    }

    // Standard absence types
    const reason = mapEventTypeToReason(event.type);
    if (!reason) {
      skippedEvents.push({
        event,
        reason: `Unsupported event type "${event.type}"`,
      });
      return;
    }

    // Warn about partial-day events treated as full-day
    if (event.type === 'late_arrival' || event.type === 'early_departure') {
      warnings.push({
        eventIndex: idx,
        message: `Partial unavailability (${event.type.replace('_', ' ')}) treated as full-day absence`,
      });
    }

    const windows = groupDatesIntoWindows(event.affected_dates);
    for (const w of windows) {
      absenceEvents.push({
        employee_id: employeeId,
        start_date: w.start_date,
        end_date: w.end_date,
        reason,
      });
    }
  });

  return { absenceEvents, warnings, skippedEvents };
}
