import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createUnavailabilityPlan,
  getUnavailabilityPlan,
  approveUnavailabilityDay,
  skipUnavailabilityDay,
  UnavailabilityPlan,
  UnavailabilityPlanCreateRequest,
} from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';

export function useCreateUnavailabilityPlan() {
  const queryClient = useQueryClient();
  return useMutation<UnavailabilityPlan, Error, UnavailabilityPlanCreateRequest>({
    mutationFn: createUnavailabilityPlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unavailability-plan'] });
    },
  });
}

export function useUnavailabilityPlan(planId: string | null) {
  return useQuery({
    queryKey: ['unavailability-plan', planId],
    queryFn: () => getUnavailabilityPlan(planId!),
    enabled: !!planId,
  });
}

export function useInProgressPlan(teamProfileId: string | null) {
  return useQuery({
    queryKey: ['unavailability-plan', 'in-progress', teamProfileId],
    queryFn: async () => {
      if (!teamProfileId) return null;
      const { data, error } = await supabase
        .from('unavailability_plans')
        .select('id')
        .eq('team_profile_id', teamProfileId)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.id ?? null;
    },
    enabled: !!teamProfileId,
  });
}

export function useApproveDay() {
  const queryClient = useQueryClient();
  return useMutation<
    UnavailabilityPlan,
    Error,
    { planId: string; dayId: string; approvedMemberId: string }
  >({
    mutationFn: ({ planId, dayId, approvedMemberId }) =>
      approveUnavailabilityDay(planId, dayId, approvedMemberId),
    onSuccess: (data) => {
      queryClient.setQueryData(['unavailability-plan', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['unavailability-plan', 'in-progress'] });
    },
  });
}

export function useSkipDay() {
  const queryClient = useQueryClient();
  return useMutation<
    UnavailabilityPlan,
    Error,
    { planId: string; dayId: string }
  >({
    mutationFn: ({ planId, dayId }) =>
      skipUnavailabilityDay(planId, dayId),
    onSuccess: (data) => {
      queryClient.setQueryData(['unavailability-plan', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['unavailability-plan', 'in-progress'] });
    },
  });
}
