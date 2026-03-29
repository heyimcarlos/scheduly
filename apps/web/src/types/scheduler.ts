// --- Region metadata registry ---
export interface RegionMeta {
  id: string;
  name: string;
  prefix: string;
  timezone: string;
  utcOffset: number;
  color: string; // CSS value e.g. "hsl(var(--team-canada))"
}

// Static registry — runtime data loaded via useRegions() hook
export const REGISTRY: Record<string, RegionMeta> = {
  canada: {
    id: 'canada',
    name: 'Canada',
    prefix: 'CAN',
    timezone: 'America/Toronto',
    utcOffset: -5,
    color: 'hsl(var(--team-canada))',
  },
  serbia: {
    id: 'serbia',
    name: 'Serbia',
    prefix: 'SRB',
    timezone: 'Europe/Belgrade',
    utcOffset: 1,
    color: 'hsl(var(--team-serbia))',
  },
  india: {
    id: 'india',
    name: 'India',
    prefix: 'IND',
    timezone: 'Asia/Kolkata',
    utcOffset: 5.5,
    color: 'hsl(var(--team-india))',
  },
};

export const ALL_REGION_IDS = Object.keys(REGISTRY);

export const getRegionMeta = (id: string): RegionMeta | undefined => REGISTRY[id];
export const getRegionColor = (id: string): string => REGISTRY[id]?.color ?? 'bg-muted';
export const getRegionTimezone = (id: string): string => REGISTRY[id]?.timezone ?? 'UTC';
export const getRegionName = (id: string): string => REGISTRY[id]?.name ?? id;

// Open string type — existing 'canada' | 'india' | 'serbia' values still work
export type Region = string;

export type ViewMode = 'week' | 'month';

export type Timezone = 'UTC' | 'America/Toronto' | 'Asia/Kolkata' | 'Europe/Belgrade';

export type SeniorityLevel = 'senior' | 'junior';

export type ShiftType = 'regular' | 'sick' | 'vacation' | 'absent';

export type ContractType = 'full-time' | 'part-time' | 'contract';

export interface TeamMember {
  id: string;
  name: string;
  initials: string;
  region: Region;
  role: string;
  skills: string[];
  fatigueScore: number; // 0-100
  avatar?: string;
  seniority: SeniorityLevel;
  weeklyHours?: number;
  contractType: ContractType;
  maxHours: number;
  timezone: Timezone;
  email?: string;
  teamProfileId: string;
}

export interface Shift {
  id: string;
  memberId: string;
  teamProfileId: string;
  startTime: Date;
  endTime: Date;
  isPending: boolean; // Ghost shift
  isConflict: boolean;
  isHighFatigue: boolean;
  isEfficient: boolean;
  title?: string;
  shiftType: ShiftType;
  slotName?: string; // e.g. 'Morning1', 'Evening2', 'Night1' - from team profile slot
  hasRestViolation?: boolean; // 12h rest violation
}

export interface AISuggestion {
  id: string;
  type: 'redistribute' | 'swap' | 'coverage' | 'fatigue';
  description: string;
  priority: 'high' | 'medium' | 'low';
  affectedMembers: string[];
  createdAt: Date;
}

export interface Holiday {
  date: Date;
  region: Region;
  name: string;
}

export interface CoverageRules {
  peakWindowStart: string; // HH:mm format
  peakWindowEnd: string;
  minimumStaffing: number;
  serbiaRestRule: boolean;
  sequentialDaysOff: boolean;
  enforceSeniorPerShift: boolean;
  weeklyHourLimit: number;
}

export const TIMEZONE_LABELS: Record<Timezone, string> = {
  'UTC': 'UTC',
  'America/Toronto': 'Canada (Toronto)',
  'Asia/Kolkata': 'India (Kolkata)',
  'Europe/Belgrade': 'Serbia (Belgrade)',
};

// Computed from REGISTRY — no longer hardcoded per-country
export const REGION_COLORS: Record<string, string> = {
  canada: 'team-canada',
  india: 'team-india',
  serbia: 'team-serbia',
};

export const DEFAULT_COVERAGE_RULES: CoverageRules = {
  peakWindowStart: '07:00',
  peakWindowEnd: '18:00',
  minimumStaffing: 3,
  serbiaRestRule: true,
  sequentialDaysOff: true,
  enforceSeniorPerShift: true,
  weeklyHourLimit: 40,
};
