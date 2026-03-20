import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { TeamProfileConfig } from '@/types/teamProfile';

export function useActiveTeamProfile() {
  const { activeTeamProfileId } = useAuth();

  const query = useQuery({
    queryKey: ['team-profile', activeTeamProfileId],
    queryFn: async () => {
      if (!activeTeamProfileId) return null;
      const { data, error } = await supabase
        .from('team_profiles')
        .select('*')
        .eq('id', activeTeamProfileId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!activeTeamProfileId,
  });

  return {
    profile: query.data ?? null,
    config: (query.data?.config as unknown as TeamProfileConfig) ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
