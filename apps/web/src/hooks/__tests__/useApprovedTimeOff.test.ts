import { describe, it, expect } from 'vitest';
import { isShiftOnApprovedTimeOff, getRequestTypeStyle } from '@/hooks/useApprovedTimeOff';
import type { ApprovedTimeOff } from '@/hooks/useApprovedTimeOff';

const makeTimeOff = (overrides: Partial<ApprovedTimeOff> = {}): ApprovedTimeOff => ({
  id: '1',
  teamMemberId: 'member-1',
  startDate: '2026-03-01',
  endDate: '2026-03-03',
  requestType: 'vacation',
  ...overrides,
});

describe('isShiftOnApprovedTimeOff', () => {
  const timeOffs = [makeTimeOff()];

  it('returns match when shift overlaps approved time off', () => {
    const result = isShiftOnApprovedTimeOff(
      'member-1',
      new Date('2026-03-02T08:00:00'),
      new Date('2026-03-02T16:00:00'),
      timeOffs,
    );
    expect(result).toBeDefined();
    expect(result?.requestType).toBe('vacation');
  });

  it('returns undefined when shift is outside time off range', () => {
    const result = isShiftOnApprovedTimeOff(
      'member-1',
      new Date('2026-03-05T08:00:00'),
      new Date('2026-03-05T16:00:00'),
      timeOffs,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for different member', () => {
    const result = isShiftOnApprovedTimeOff(
      'member-999',
      new Date('2026-03-02T08:00:00'),
      new Date('2026-03-02T16:00:00'),
      timeOffs,
    );
    expect(result).toBeUndefined();
  });

  it('returns match on boundary (shift starts on last day)', () => {
    const result = isShiftOnApprovedTimeOff(
      'member-1',
      new Date('2026-03-03T08:00:00'),
      new Date('2026-03-03T16:00:00'),
      timeOffs,
    );
    expect(result).toBeDefined();
  });

  it('matches correct type from multiple time-offs', () => {
    const multi = [
      makeTimeOff({ id: '1', requestType: 'vacation', startDate: '2026-03-01', endDate: '2026-03-02' }),
      makeTimeOff({ id: '2', requestType: 'sick_leave', startDate: '2026-03-10', endDate: '2026-03-10' }),
    ];
    const result = isShiftOnApprovedTimeOff(
      'member-1',
      new Date('2026-03-10T06:00:00'),
      new Date('2026-03-10T14:00:00'),
      multi,
    );
    expect(result?.requestType).toBe('sick_leave');
  });
});

describe('getRequestTypeStyle', () => {
  it('returns vacation style', () => {
    const style = getRequestTypeStyle('vacation');
    expect(style.label).toBe('VACATION');
    expect(style.ring).toContain('sky');
  });

  it('returns sick_leave style', () => {
    const style = getRequestTypeStyle('sick_leave');
    expect(style.label).toBe('SICK LEAVE');
    expect(style.ring).toContain('destructive');
  });

  it('returns personal style', () => {
    const style = getRequestTypeStyle('personal');
    expect(style.label).toBe('PERSONAL');
  });

  it('returns shift_swap style', () => {
    const style = getRequestTypeStyle('shift_swap');
    expect(style.label).toBe('SHIFT SWAP');
  });

  it('returns default style for unknown type', () => {
    const style = getRequestTypeStyle('unknown_type');
    expect(style.label).toBe('TIME OFF');
  });
});
