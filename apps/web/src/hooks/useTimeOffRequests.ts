import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface TimeOffRequest {
  id: string;
  user_id: string;
  team_member_id: string;
  request_type: string;
  start_date: string;
  end_date: string;
  partial_start: string | null;
  partial_end: string | null;
  swap_target_shift_id: string | null;
  notes: string | null;
  status: string;
  manager_notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useMyTimeOffRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['time_off_requests', 'mine', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as TimeOffRequest[];
    },
    enabled: !!user,
  });
}

export function useAllTimeOffRequests() {
  return useQuery({
    queryKey: ['time_off_requests', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as TimeOffRequest[];
    },
  });
}

export function useCreateTimeOffRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: {
      user_id: string;
      team_member_id: string;
      request_type: string;
      start_date: string;
      end_date: string;
      partial_start?: string | null;
      partial_end?: string | null;
      swap_target_shift_id?: string | null;
      notes?: string | null;
    }) => {
      const { error } = await supabase.from('time_off_requests').insert(req);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time_off_requests'] }),
  });
}

export function useUpdateTimeOffRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; manager_notes?: string }) => {
      const { error } = await supabase.from('time_off_requests').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time_off_requests'] }),
  });
}

export function useDeleteTimeOffRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_off_requests').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time_off_requests'] }),
  });
}
