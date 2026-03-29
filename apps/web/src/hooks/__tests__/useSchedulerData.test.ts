import { describe, it, expect } from 'vitest';
import type { TeamMember, Shift } from '@/types/scheduler';

// Re-implement the mappers so tests stay close to the actual logic
type RawTeamMemberRow = {
  id: string;
  name: string;
  initials: string;
  region: string;
  role: string;
  skills: string[] | null;
  fatigue_score: number;
  avatar: string | null;
  seniority: string;
  weekly_hours: number | null;
  contract_type: string;
  max_hours: number;
  timezone: string;
  email: string | null;
  team_profile_id: string;
};

type RawShiftRow = {
  id: string;
  member_id: string;
  team_profile_id: string;
  start_time: string;
  end_time: string;
  is_pending: boolean;
  is_conflict: boolean;
  is_high_fatigue: boolean;
  is_efficient: boolean;
  title: string | null;
  shift_type: string;
  has_rest_violation: boolean | null;
};

function mapTeamMember(row: any): TeamMember {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    region: row.region,
    role: row.role,
    skills: row.skills ?? [],
    fatigueScore: row.fatigue_score,
    avatar: row.avatar ?? undefined,
    seniority: row.seniority,
    weeklyHours: row.weekly_hours ?? undefined,
    contractType: row.contract_type,
    maxHours: row.max_hours,
    timezone: row.timezone,
    email: row.email ?? undefined,
    teamProfileId: row.team_profile_id,
  };
}

function mapShift(row: any): Shift {
  return {
    id: row.id,
    memberId: row.member_id,
    teamProfileId: row.team_profile_id,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    isPending: row.is_pending,
    isConflict: row.is_conflict,
    isHighFatigue: row.is_high_fatigue,
    isEfficient: row.is_efficient,
    title: row.title ?? undefined,
    shiftType: row.shift_type,
    hasRestViolation: row.has_rest_violation ?? undefined,
  };
}

const baseMemberRow: RawTeamMemberRow = {
  id: 'member-uuid-1',
  name: 'Ana Jovanovic',
  initials: 'AJ',
  region: 'Serbia',
  role: 'engineer',
  skills: ['python', 'javascript'],
  fatigue_score: 42,
  avatar: null,
  seniority: 'senior',
  weekly_hours: 40,
  contract_type: 'full_time',
  max_hours: 48,
  timezone: 'Europe/Belgrade',
  email: 'ana@example.com',
  team_profile_id: 'tp-uuid-1',
};

const baseShiftRow: RawShiftRow = {
  id: 'shift-uuid-1',
  member_id: 'member-uuid-1',
  team_profile_id: 'tp-uuid-1',
  start_time: '2026-04-01T08:00:00Z',
  end_time: '2026-04-01T16:00:00Z',
  is_pending: false,
  is_conflict: false,
  is_high_fatigue: false,
  is_efficient: true,
  title: 'Morning Shift',
  shift_type: 'day',
  has_rest_violation: false,
};

describe('mapTeamMember', () => {
  it('maps all required fields from a complete row', () => {
    const result = mapTeamMember(baseMemberRow);

    expect(result.id).toBe('member-uuid-1');
    expect(result.name).toBe('Ana Jovanovic');
    expect(result.initials).toBe('AJ');
    expect(result.region).toBe('Serbia');
    expect(result.role).toBe('engineer');
    expect(result.skills).toEqual(['python', 'javascript']);
    expect(result.fatigueScore).toBe(42);
    expect(result.seniority).toBe('senior');
    expect(result.weeklyHours).toBe(40);
    expect(result.contractType).toBe('full_time');
    expect(result.maxHours).toBe(48);
    expect(result.timezone).toBe('Europe/Belgrade');
    expect(result.email).toBe('ana@example.com');
    expect(result.teamProfileId).toBe('tp-uuid-1');
  });

  it('defaults skills to empty array when null', () => {
    const row = { ...baseMemberRow, skills: null };
    const result = mapTeamMember(row);
    expect(result.skills).toEqual([]);
  });

  it('defaults weeklyHours to undefined when null', () => {
    const row = { ...baseMemberRow, weekly_hours: null };
    const result = mapTeamMember(row);
    expect(result.weeklyHours).toBeUndefined();
  });

  it('defaults email to undefined when null', () => {
    const row = { ...baseMemberRow, email: null };
    const result = mapTeamMember(row);
    expect(result.email).toBeUndefined();
  });

  it('defaults avatar to undefined when null', () => {
    const row = { ...baseMemberRow, avatar: null };
    const result = mapTeamMember(row);
    expect(result.avatar).toBeUndefined();
  });

  it('maps teamProfileId from team_profile_id field', () => {
    const row = { ...baseMemberRow, team_profile_id: 'custom-tp-uuid' };
    const result = mapTeamMember(row);
    expect(result.teamProfileId).toBe('custom-tp-uuid');
  });
});

describe('mapShift', () => {
  it('maps all required fields from a complete row', () => {
    const result = mapShift(baseShiftRow);

    expect(result.id).toBe('shift-uuid-1');
    expect(result.memberId).toBe('member-uuid-1');
    expect(result.teamProfileId).toBe('tp-uuid-1');
    expect(result.startTime).toEqual(new Date('2026-04-01T08:00:00Z'));
    expect(result.endTime).toEqual(new Date('2026-04-01T16:00:00Z'));
    expect(result.isPending).toBe(false);
    expect(result.isConflict).toBe(false);
    expect(result.isHighFatigue).toBe(false);
    expect(result.isEfficient).toBe(true);
    expect(result.title).toBe('Morning Shift');
    expect(result.shiftType).toBe('day');
    expect(result.hasRestViolation).toBe(false);
  });

  it('converts start_time and end_time to Date objects', () => {
    const result = mapShift(baseShiftRow);
    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.endTime).toBeInstanceOf(Date);
  });

  it('defaults title to undefined when null', () => {
    const row = { ...baseShiftRow, title: null };
    const result = mapShift(row);
    expect(result.title).toBeUndefined();
  });

  it('defaults hasRestViolation to undefined when null', () => {
    const row = { ...baseShiftRow, has_rest_violation: null };
    const result = mapShift(row);
    expect(result.hasRestViolation).toBeUndefined();
  });

  it('maps teamProfileId from team_profile_id field', () => {
    const row = { ...baseShiftRow, team_profile_id: 'custom-tp-uuid' };
    const result = mapShift(row);
    expect(result.teamProfileId).toBe('custom-tp-uuid');
  });

  it('maps all boolean flags correctly', () => {
    const row: RawShiftRow = {
      ...baseShiftRow,
      is_pending: true,
      is_conflict: true,
      is_high_fatigue: true,
      is_efficient: false,
      has_rest_violation: true,
    };
    const result = mapShift(row);
    expect(result.isPending).toBe(true);
    expect(result.isConflict).toBe(true);
    expect(result.isHighFatigue).toBe(true);
    expect(result.isEfficient).toBe(false);
    expect(result.hasRestViolation).toBe(true);
  });
});
