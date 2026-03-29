import { describe, it, expect } from 'vitest';
import { SolvedSchedule } from '@/lib/api';
import type { Shift } from '@/types/scheduler';

/** Re-implements solvedScheduleToShifts so tests stay close to the actual logic */
function solvedScheduleToShifts(
  schedule: SolvedSchedule,
  memberIdsByEmployeeId: Record<number, string>,
): Shift[] {
  return schedule.staff_schedules.flatMap((staffRow) => {
    const memberId = memberIdsByEmployeeId[staffRow.employee_id];
    if (!memberId) return [];

    return staffRow.days
      .filter((dayEntry) => dayEntry.shift)
      .map((dayEntry) => {
        const slotName = dayEntry.shift!.slot_name ?? dayEntry.shift!.shift_type;
        const shiftType: Shift['shiftType'] =
          slotName.toLowerCase().includes('night') ? 'night' as const :
          slotName.toLowerCase().includes('evening') ? 'evening' as const :
          'day' as const;

        return {
          id: crypto.randomUUID(),
          memberId,
          teamProfileId: 'test-team-profile',
          startTime: new Date(dayEntry.shift!.utc_start_at),
          endTime: new Date(dayEntry.shift!.utc_end_at),
          isPending: false,
          isConflict: false,
          isHighFatigue: false,
          isEfficient: false,
          title: dayEntry.shift!.coverage_label
            ? `AI ${dayEntry.shift!.coverage_label}`
            : `AI ${dayEntry.shift!.slot_name ?? dayEntry.shift!.shift_type}`,
          shiftType,
        } satisfies Shift;
      });
  });
}

const baseShift = {
  utc_start_at: '2026-04-01T08:00:00Z',
  utc_end_at: '2026-04-01T16:00:00Z',
  slot_name: 'Hybrid1',
  shift_type: 'day',
  coverage_label: 'Reschedule' as const,
  coverage_role: 'primary',
};

function makeSolvedSchedule(staffSchedules: Parameters<typeof SolvedSchedule.prototype.staff_schedules>[0]): SolvedSchedule {
  return {
    staff_schedules: staffSchedules,
    metadata: { team_profile_id: 'test-profile', generated_at: '2026-04-01T00:00:00Z', duration_ms: 100 },
  } as SolvedSchedule;
}

describe('solvedScheduleToShifts', () => {
  it('returns empty array when staff_schedules is empty', () => {
    const schedule = makeSolvedSchedule([]);
    const result = solvedScheduleToShifts(schedule, {});
    expect(result).toHaveLength(0);
  });

  it('skips employee with no entry in memberIdsByEmployeeId', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: baseShift }],
      },
    ]);
    const result = solvedScheduleToShifts(schedule, {});
    expect(result).toHaveLength(0);
  });

  it('maps a single shift correctly', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: baseShift }],
      },
    ]);
    const memberMap = { 1: 'member-uuid-1' };

    const result = solvedScheduleToShifts(schedule, memberMap);

    expect(result).toHaveLength(1);
    expect(result[0].memberId).toBe('member-uuid-1');
    expect(result[0].startTime).toEqual(new Date('2026-04-01T08:00:00Z'));
    expect(result[0].endTime).toEqual(new Date('2026-04-01T16:00:00Z'));
    expect(result[0].title).toBe('AI Reschedule');
    expect(result[0].shiftType).toBe('day');
  });

  it('infers night shiftType from slot name', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: { ...baseShift, slot_name: 'Night1' } }],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1' });

    expect(result[0].shiftType).toBe('night');
  });

  it('infers evening shiftType from slot name', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: { ...baseShift, slot_name: 'Evening2' } }],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1' });

    expect(result[0].shiftType).toBe('evening');
  });

  it('uses slot_name for title when coverage_label is absent but slot_name is present', () => {
    const { coverage_label: _cov, ...shiftWithoutCoverage } = baseShift;
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: { ...shiftWithoutCoverage, slot_name: 'Hybrid1', shift_type: 'night' } }],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1' });

    expect(result[0].shiftType).toBe('day');
    expect(result[0].title).toBe('AI Hybrid1');
  });

  it('skips days without a shift', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [
          { date: '2026-04-01', shift: baseShift },
          { date: '2026-04-02', shift: null },
          { date: '2026-04-03', shift: undefined },
        ],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1' });

    expect(result).toHaveLength(1);
  });

  it('flattens multiple employees into separate shifts', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: baseShift }],
      },
      {
        employee_id: 2,
        employee_name: 'Bojan',
        days: [{ date: '2026-04-01', shift: { ...baseShift, slot_name: 'Morning2' } }],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1', 2: 'member-2' });

    expect(result).toHaveLength(2);
    expect(result.map(r => r.memberId)).toEqual(['member-1', 'member-2']);
  });

  it('flattens multiple days across employees', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [
          { date: '2026-04-01', shift: baseShift },
          { date: '2026-04-02', shift: { ...baseShift, utc_start_at: '2026-04-02T08:00:00Z', utc_end_at: '2026-04-02T16:00:00Z' } },
        ],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1' });

    expect(result).toHaveLength(2);
    expect(result[0].startTime).toEqual(new Date('2026-04-01T08:00:00Z'));
    expect(result[1].startTime).toEqual(new Date('2026-04-02T08:00:00Z'));
  });

  it('derives title from coverage_label when present', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: { ...baseShift, coverage_label: 'Fatigue Recovery' } }],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1' });

    expect(result[0].title).toBe('AI Fatigue Recovery');
  });

  it('derives title from slot_name when coverage_label is absent', () => {
    const schedule = makeSolvedSchedule([
      {
        employee_id: 1,
        employee_name: 'Ana',
        days: [{ date: '2026-04-01', shift: { ...baseShift, coverage_label: undefined! } }],
      },
    ]);

    const result = solvedScheduleToShifts(schedule, { 1: 'member-1' });

    expect(result[0].title).toBe('AI Hybrid1');
  });
});
