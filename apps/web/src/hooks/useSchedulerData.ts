import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TeamMember, Shift, AISuggestion, Holiday, Region, SeniorityLevel, ContractType, Timezone, ShiftType } from '@/types/scheduler';

// --- Mappers: DB row → domain type ---

function mapTeamMember(row: any): TeamMember {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    region: row.region as Region,
    role: row.role,
    skills: row.skills ?? [],
    fatigueScore: row.fatigue_score,
    avatar: row.avatar ?? undefined,
    seniority: row.seniority as SeniorityLevel,
    weeklyHours: row.weekly_hours ?? undefined,
    contractType: row.contract_type as ContractType,
    maxHours: row.max_hours,
    timezone: row.timezone as Timezone,
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
    shiftType: row.shift_type as ShiftType,
    hasRestViolation: row.has_rest_violation ?? undefined,
  };
}

function mapSuggestion(row: any): AISuggestion {
  return {
    id: row.id,
    type: row.type as AISuggestion['type'],
    description: row.description,
    priority: row.priority as AISuggestion['priority'],
    affectedMembers: row.affected_members ?? [],
    createdAt: new Date(row.created_at),
  };
}

function mapHoliday(row: any): Holiday {
  return {
    date: new Date(row.date),
    region: row.region as Region,
    name: row.name,
  };
}

// --- Queries ---

/** Full team_members access (managers only via RLS) */
export function useTeamMembers() {
  return useQuery({
    queryKey: ['team_members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').order('name');
      if (error) throw error;
      return (data ?? []).map(mapTeamMember);
    },
  });
}

/** Safe view without email – accessible to all authenticated users */
export function useTeamMembersSafe() {
  return useQuery({
    queryKey: ['team_members_safe'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members_safe' as any).select('*').order('name');
      if (error) throw error;
      return (data ?? []).map(mapTeamMember);
    },
  });
}

export function useShifts() {
  return useQuery({
    queryKey: ['shifts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select('*');
      if (error) throw error;
      return (data ?? []).map(mapShift);
    },
  });
}

export function useHolidays() {
  return useQuery({
    queryKey: ['holidays'],
    queryFn: async () => {
      const { data, error } = await supabase.from('holidays').select('*');
      if (error) throw error;
      return (data ?? []).map(mapHoliday);
    },
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: ['ai_suggestions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_suggestions').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapSuggestion);
    },
  });
}

// --- Mutations ---

export function useUpsertTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (member: TeamMember) => {
      const row = {
        id: member.id,
        name: member.name,
        initials: member.initials,
        region: member.region,
        role: member.role,
        skills: member.skills,
        fatigue_score: member.fatigueScore,
        avatar: member.avatar ?? null,
        seniority: member.seniority,
        weekly_hours: member.weeklyHours ?? null,
        contract_type: member.contractType,
        max_hours: member.maxHours,
        timezone: member.timezone,
        email: member.email ?? null,
        team_profile_id: member.teamProfileId,
      };
      const { error } = await supabase.from('team_members').upsert(row);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

export function useDeleteTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('team_members').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

export function useUpdateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shift: Shift) => {
      const { error } = await supabase.from('shifts').update({
        start_time: shift.startTime.toISOString(),
        end_time: shift.endTime.toISOString(),
        is_pending: shift.isPending,
        is_conflict: shift.isConflict,
        is_high_fatigue: shift.isHighFatigue,
        is_efficient: shift.isEfficient,
        shift_type: shift.shiftType,
        has_rest_violation: shift.hasRestViolation ?? null,
        title: shift.title ?? null,
      }).eq('id', shift.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  });
}

export function useDeleteSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ai_suggestions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_suggestions'] }),
  });
}

export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shift: { memberId: string; teamProfileId: string; startTime: Date; endTime: Date; shiftType: string; title?: string }) => {
      const { error } = await supabase.from('shifts').insert({
        member_id: shift.memberId,
        team_profile_id: shift.teamProfileId,
        start_time: shift.startTime.toISOString(),
        end_time: shift.endTime.toISOString(),
        shift_type: shift.shiftType,
        title: shift.title ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  });
}

export interface CreateShiftInput {
  memberId: string;
  teamProfileId: string;
  startTime: Date;
  endTime: Date;
  shiftType: string;
  title?: string;
}

export async function createShiftsBulk(shifts: CreateShiftInput[]) {
  if (shifts.length === 0) {
    return;
  }

  const rows = shifts.map((shift) => ({
    member_id: shift.memberId,
    team_profile_id: shift.teamProfileId,
    start_time: shift.startTime.toISOString(),
    end_time: shift.endTime.toISOString(),
    shift_type: shift.shiftType,
    title: shift.title ?? null,
  }));

  const { error } = await supabase.from('shifts').insert(rows);
  if (error) throw error;
}

export function useCreateShiftsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createShiftsBulk,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  });
}

export function useBulkUpsertTeamMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (members: TeamMember[]) => {
      if (members.length === 0) return;
      const rows = members.map(member => ({
        id: member.id,
        name: member.name,
        initials: member.initials,
        region: member.region,
        role: member.role,
        skills: member.skills,
        fatigue_score: member.fatigueScore,
        avatar: member.avatar ?? null,
        seniority: member.seniority,
        weekly_hours: member.weeklyHours ?? null,
        contract_type: member.contractType,
        max_hours: member.maxHours,
        timezone: member.timezone,
        email: member.email ?? null,
        team_profile_id: member.teamProfileId,
      }));
      const { error } = await supabase.from('team_members').upsert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

export function useDeleteShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shifts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  });
}
