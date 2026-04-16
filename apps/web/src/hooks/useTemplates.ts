import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { SlotPolicy } from '@/types/teamProfile';

export interface Template {
  key: string;
  name: string;
  description: string;
  canonicalSlots: number;
  defaultRegions: string[];
  slotPolicies: Record<string, SlotPolicy>;
  rules: {
    min_rest_hours: number;
    days_off_required: number;
    min_weekly_hours_required: number;
    overtime_threshold_hours: number;
    enforce_senior_per_shift: boolean;
  } | null;
}

const SCRATCH_TEMPLATE: Template = {
  key: '__scratch__',
  name: 'Start from Scratch',
  description: 'Build your own regions, shift slots, and policies from scratch.',
  canonicalSlots: 0,
  defaultRegions: [],
  slotPolicies: {},
  rules: {
    min_rest_hours: 12,
    days_off_required: 4,
    min_weekly_hours_required: 40,
    overtime_threshold_hours: 40,
    enforce_senior_per_shift: true,
  },
};

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async (): Promise<Template[]> => {
      const { data, error } = await supabase
        .from('template_registry')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (!error && data && data.length > 0) {
        const templates: Template[] = data.map((row) => ({
          key: row.id,
          name: row.name,
          description: row.description ?? '',
          canonicalSlots: row.canonical_slots ?? 0,
          defaultRegions: row.default_regions ?? [],
          slotPolicies: row.slot_policies ?? {},
          rules: row.rules ?? null,
        }));
        return [SCRATCH_TEMPLATE, ...templates];
      }

      return [SCRATCH_TEMPLATE];
    },
  });
}

export const SCRATCH_KEY = '__scratch__';
