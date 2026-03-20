export type Region = 'canada' | 'india' | 'serbia';

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
}

export interface Shift {
  id: string;
  memberId: string;
  startTime: Date;
  endTime: Date;
  isPending: boolean; // Ghost shift
  isConflict: boolean;
  isHighFatigue: boolean;
  isEfficient: boolean;
  title?: string;
  shiftType: ShiftType;
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

export const REGION_COLORS: Record<Region, string> = {
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
