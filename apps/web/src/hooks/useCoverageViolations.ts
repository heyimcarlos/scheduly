import { useMemo } from 'react';
import { Shift, TeamMember, CoverageRules } from '@/types/scheduler';
import { startOfWeek, endOfWeek, differenceInHours, differenceInMinutes } from 'date-fns';

export interface ShiftViolation {
  overtimeHours?: number; // how many hours over the limit
  restViolationGapMinutes?: number; // gap in minutes if < 12h
  noSeniorOnOverlap?: boolean; // no senior covering same time window
}

export type ViolationMap = Record<string, ShiftViolation>;

/**
 * Computes coverage-rule violations for every shift visible in the current week.
 */
export function useCoverageViolations(
  shifts: Shift[],
  teamMembers: TeamMember[],
  coverageRules: CoverageRules,
  currentDate: Date,
): ViolationMap {
  return useMemo(() => {
    const violations: ViolationMap = {};
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });

    // Filter to shifts that overlap the current week
    const weekShifts = shifts.filter(s => {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      return start < weekEnd && end > weekStart;
    });

    // ---- 1. Weekly hour limit ----
    const hoursByMember: Record<string, number> = {};
    for (const s of weekShifts) {
      const hours = differenceInHours(new Date(s.endTime), new Date(s.startTime));
      hoursByMember[s.memberId] = (hoursByMember[s.memberId] || 0) + hours;
    }

    for (const s of weekShifts) {
      const totalHours = hoursByMember[s.memberId] || 0;
      if (totalHours > coverageRules.weeklyHourLimit) {
        if (!violations[s.id]) violations[s.id] = {};
        violations[s.id].overtimeHours = totalHours - coverageRules.weeklyHourLimit;
      }
    }

    // ---- 2. Serbia 12-hour rest rule ----
    if (coverageRules.serbiaRestRule) {
      // Group shifts by member
      const byMember: Record<string, Shift[]> = {};
      for (const s of weekShifts) {
        if (!byMember[s.memberId]) byMember[s.memberId] = [];
        byMember[s.memberId].push(s);
      }

      for (const [memberId, memberShifts] of Object.entries(byMember)) {
        const member = teamMembers.find(m => m.id === memberId);
        // Only enforce for Serbian region members
        if (!member || member.region !== 'serbia') continue;

        // Sort by start time
        const sorted = [...memberShifts].sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );

        for (let i = 1; i < sorted.length; i++) {
          const prevEnd = new Date(sorted[i - 1].endTime);
          const currStart = new Date(sorted[i].startTime);
          const gapMinutes = differenceInMinutes(currStart, prevEnd);

          if (gapMinutes < 12 * 60) {
            // Mark BOTH shifts
            if (!violations[sorted[i - 1].id]) violations[sorted[i - 1].id] = {};
            if (!violations[sorted[i].id]) violations[sorted[i].id] = {};
            violations[sorted[i - 1].id].restViolationGapMinutes = gapMinutes;
            violations[sorted[i].id].restViolationGapMinutes = gapMinutes;
          }
        }
      }
    }

    // ---- 3. Senior per shift enforcement ----
    if (coverageRules.enforceSeniorPerShift) {
      for (const s of weekShifts) {
        const member = teamMembers.find(m => m.id === s.memberId);
        if (!member || member.seniority === 'senior') continue;

        // Check if any senior member has an overlapping shift
        const sStart = new Date(s.startTime);
        const sEnd = new Date(s.endTime);

        const hasSeniorOverlap = weekShifts.some(other => {
          if (other.id === s.id) return false;
          const otherMember = teamMembers.find(m => m.id === other.memberId);
          if (!otherMember || otherMember.seniority !== 'senior') return false;
          const oStart = new Date(other.startTime);
          const oEnd = new Date(other.endTime);
          // Check overlap
          return oStart < sEnd && oEnd > sStart;
        });

        if (!hasSeniorOverlap) {
          if (!violations[s.id]) violations[s.id] = {};
          violations[s.id].noSeniorOnOverlap = true;
        }
      }
    }

    return violations;
  }, [shifts, teamMembers, coverageRules, currentDate]);
}
