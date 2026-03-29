export interface SlotPolicy {
  coverage_label: string;
  coverage_role: string;
  allowed_regions: string[];
  preferred_regions: string[];
  patch_regions?: string[];
  fallback_penalty?: number;
  patch_penalty?: number;
  canonical?: boolean;
  min_headcount?: number;
  max_headcount?: number;
  utc_start?: string;  // "HH:mm" UTC
  utc_end?: string;    // "HH:mm" UTC
}

export interface DemandOverridePoint {
  minimum: number;
  ideal: number;
}

export interface DemandOverrideGroup {
  day?: DemandOverridePoint;
  evening?: DemandOverridePoint;
  night?: DemandOverridePoint;
}

export interface DemandOverrides {
  weekday?: DemandOverrideGroup;
  weekend?: DemandOverrideGroup;
}

export interface WorkloadTemplatePoint {
  day_type: 'weekday' | 'weekend' | 'all';
  slot_name: string;
  required_headcount?: number;
  minimum_headcount?: number;
  ideal_headcount?: number;
  priority_weight?: number;
  source?: string;
}

export interface TeamProfileConfig {
  schema_version: number;
  template_key: string;
  service_timezone: string;
  rules: {
    min_rest_hours: number;
    days_off_required: number;
    min_weekly_hours_required: number;
    overtime_threshold_hours: number;
    enforce_senior_per_shift: boolean;
  };
  slot_policies: Record<string, SlotPolicy>;
  answers: {
    regions: Record<string, string>;
  };
  demand_overrides?: DemandOverrides;
  workload_template?: WorkloadTemplatePoint[];
}

export const DEFAULT_SLOT_POLICIES: Record<string, SlotPolicy> = {
  Hybrid1: {
    coverage_label: "Serbia Hybrid Opener",
    coverage_role: "serbia_hybrid",
    allowed_regions: ["Serbia"],
    preferred_regions: ["Serbia"],
    patch_regions: [],
    fallback_penalty: 30,
    patch_penalty: 90,
    canonical: true,
    max_headcount: 1,
    min_headcount: 1,
  },
  Morning1: {
    coverage_label: "Canada Day Early",
    coverage_role: "canada_day",
    allowed_regions: ["Canada"],
    preferred_regions: ["Canada"],
  },
  Morning2: {
    coverage_label: "Canada Day Core",
    coverage_role: "canada_day",
    allowed_regions: ["Canada", "Serbia"],
    preferred_regions: ["Canada"],
    fallback_penalty: 200,
    canonical: true,
    min_headcount: 1,
  },
  Morning3: {
    coverage_label: "Canada Day Late",
    coverage_role: "canada_day",
    allowed_regions: ["Canada"],
    preferred_regions: ["Canada"],
  },
  Evening1: {
    coverage_label: "Canada Evening Early",
    coverage_role: "canada_evening",
    allowed_regions: ["Canada"],
    preferred_regions: ["Canada"],
  },
  Evening2: {
    coverage_label: "Canada Evening Core",
    coverage_role: "canada_evening",
    allowed_regions: ["Canada"],
    preferred_regions: ["Canada"],
    canonical: true,
    min_headcount: 1,
  },
  Night1: {
    coverage_label: "Overnight Exception",
    coverage_role: "overnight_exception",
    allowed_regions: ["Serbia", "India"],
    preferred_regions: ["Serbia", "India"],
    patch_regions: ["India"],
    fallback_penalty: 40,
    patch_penalty: 110,
    canonical: true,
    min_headcount: 1,
  },
};

// Default region roles used only in template pre-population
// Replaced by dynamic region selection in onboarding
export const DEFAULT_REGION_ROLES: Record<string, string> = {
  canada: 'primary',
  serbia: 'primary-opener',
  india: 'patch-only',
};

export const DEFAULT_RULES: TeamProfileConfig["rules"] = {
  min_rest_hours: 12,
  days_off_required: 4,
  min_weekly_hours_required: 40,
  overtime_threshold_hours: 40,
  enforce_senior_per_shift: true,
};

export function buildDefaultWorkloadTemplate(
  slotPolicies: Record<string, SlotPolicy>,
): WorkloadTemplatePoint[] {
  return Object.entries(slotPolicies)
    .filter(([, policy]) => (policy.min_headcount ?? 0) > 0)
    .map(([slot_name, policy]) => ({
      day_type: 'all',
      slot_name,
      minimum_headcount: policy.min_headcount,
      ideal_headcount: policy.min_headcount,
      priority_weight: policy.canonical ? 2 : 1,
      source: 'template',
    }));
}

export function buildTeamProfileConfig(
  serviceTimezone: string,
  rules: TeamProfileConfig["rules"],
  regions: Record<string, string>,
  slotPolicies?: Record<string, SlotPolicy>,
): TeamProfileConfig {
  const resolvedSlotPolicies = slotPolicies ?? DEFAULT_SLOT_POLICIES;

  return {
    schema_version: 1,
    template_key: "follow_the_sun_support",
    service_timezone: serviceTimezone,
    rules,
    slot_policies: resolvedSlotPolicies,
    answers: { regions },
    workload_template: buildDefaultWorkloadTemplate(resolvedSlotPolicies),
  };
}
