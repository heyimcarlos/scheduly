import { useQuery } from '@tanstack/react-query';
import type { SlotPolicy } from '@/types/teamProfile';
import templatesData from '@scheduly/shared/templates.json';

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

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async (): Promise<Template[]> => {
      // templates is now an array of template objects — mimics DB rows
      return templatesData.templates as Template[];
    },
  });
}

export const SCRATCH_KEY = '__scratch__';
