import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { REGISTRY, type RegionMeta } from '@/types/scheduler';

export function useRegions() {
  return useQuery({
    queryKey: ['regions'],
    queryFn: async (): Promise<RegionMeta[]> => {
      // Try Supabase first
      const { data, error } = await supabase
        .from('regions')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (!error && data && data.length > 0) {
        return data.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          timezone: row.timezone,
          utcOffset: row.utc_offset,
          color: row.color,
        }));
      }

      // Fallback to static REGISTRY from scheduler.ts
      return Object.values(REGISTRY);
    },
  });
}
