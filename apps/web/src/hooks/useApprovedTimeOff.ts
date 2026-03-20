import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffect } from 'react';

export interface ApprovedTimeOff {
  id: string;
  teamMemberId: string;
  startDate: string;
  endDate: string;
  requestType: string;
}

/** Color config per request type for shift card highlights */
export const REQUEST_TYPE_STYLES: Record<string, { ring: string; label: string; badge: string }> = {
  vacation: {
    ring: 'ring-sky-500 border-sky-500',
    label: 'VACATION',
    badge: 'text-sky-600 dark:text-sky-400',
  },
  sick_leave: {
    ring: 'ring-destructive border-destructive',
    label: 'SICK LEAVE',
    badge: 'text-destructive',
  },
  personal: {
    ring: 'ring-violet-500 border-violet-500',
    label: 'PERSONAL',
    badge: 'text-violet-600 dark:text-violet-400',
  },
  shift_swap: {
    ring: 'ring-amber-500 border-amber-500',
    label: 'SHIFT SWAP',
    badge: 'text-amber-600 dark:text-amber-400',
  },
  partial_availability: {
    ring: 'ring-orange-500 border-orange-500',
    label: 'PARTIAL',
    badge: 'text-orange-600 dark:text-orange-400',
  },
};

const DEFAULT_STYLE = {
  ring: 'ring-amber-500 border-amber-500',
  label: 'TIME OFF',
  badge: 'text-amber-600 dark:text-amber-400',
};

export function getRequestTypeStyle(requestType: string) {
  return REQUEST_TYPE_STYLES[requestType] ?? DEFAULT_STYLE;
}

export function useApprovedTimeOff() {
  const queryClient = useQueryClient();

  // Subscribe to realtime changes on time_off_requests
  useEffect(() => {
    const channel = supabase
      .channel('approved-time-off-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_off_requests',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['approved-time-off'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['approved-time-off'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('id, team_member_id, start_date, end_date, request_type')
        .eq('status', 'approved');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        teamMemberId: r.team_member_id,
        startDate: r.start_date,
        endDate: r.end_date,
        requestType: r.request_type,
      })) as ApprovedTimeOff[];
    },
  });
}

/** Check if a shift overlaps any approved time-off and return the match */
export function isShiftOnApprovedTimeOff(
  memberId: string,
  shiftStart: Date,
  shiftEnd: Date,
  approvedTimeOffs: ApprovedTimeOff[],
): ApprovedTimeOff | undefined {
  return approvedTimeOffs.find((t) => {
    if (t.teamMemberId !== memberId) return false;
    const tStart = new Date(t.startDate + 'T00:00:00');
    const tEnd = new Date(t.endDate + 'T23:59:59');
    return shiftStart <= tEnd && shiftEnd >= tStart;
  });
}
