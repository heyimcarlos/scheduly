/**
 * Typed fetch-based API client for the AI Scheduler backend.
 *
 * Uses VITE_API_BASE_URL env var (defaults to http://localhost:8000/api/v1).
 * No axios — native fetch only.
 */

import type { TeamProfileConfig } from '@/types/teamProfile';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// ---------------------------------------------------------------------------
// Backend types (mirrors backend/app/models/schemas.py)
// ---------------------------------------------------------------------------

export interface EmployeeInput {
  employee_id: number;
  region: string;
  employee_name?: string;
  timezone?: string;  // IANA timezone, e.g. "Asia/Kolkata" — passed to backend for per-employee local times
}

export interface ShiftDemandPoint {
  utc_date: string;
  shift_type: 'day' | 'evening' | 'night';
  required_headcount?: number;
  minimum_headcount?: number;
  ideal_headcount?: number;
  priority_weight?: number;
  source: string;
}

export interface SlotDemandPoint {
  utc_date: string;
  slot_name: string;
  required_headcount?: number;
  minimum_headcount?: number;
  ideal_headcount?: number;
  priority_weight?: number;
  source?: string;
}

export interface ManualAbsence {
  employee_id: number;
  day_offset: number;
}

export interface AbsenceEvent {
  absent_employee_id: number;
  day_offset: number;
}

export interface AbsenceEventWindow {
  employee_id: number;
  start_date: string;
  end_date: string;
  reason?: string;
}

export interface HistoricalShiftAssignment {
  employee_id: number;
  start_utc: string;
  end_utc: string;
  shift_type: string;
  slot_name?: string;
}

export interface ScheduleRequest {
  start_date: string;        // ISO date string: "YYYY-MM-DD"
  num_days: number;          // 1–92
  employees?: EmployeeInput[];
  manual_absences?: ManualAbsence[];
  absence_events?: AbsenceEventWindow[];
  shift_demand?: ShiftDemandPoint[];
  slot_demand?: SlotDemandPoint[];
  team_profile_id?: string;
  team_profile_config?: TeamProfileConfig;
}

export interface EmergencyRecommendationRequest {
  start_date: string;
  num_days: number;
  employees: EmployeeInput[];
  manual_absences?: ManualAbsence[];
  absence_event: AbsenceEvent;
  absence_events?: AbsenceEventWindow[];
  recent_assignments?: HistoricalShiftAssignment[];
  top_n?: number;
  prefer_fatigue_model?: boolean;
  min_fatigue_score?: number;  // filter: skip candidates above this threshold
}

export interface CoverageImpactItem {
  utc_date: string;
  slot_name?: string;
  shift_type: string;
  scheduled_headcount: number;
  remaining_headcount: number;
  minimum_required_headcount: number;
  is_critical_shortage: boolean;
  rationale: string;
}

export interface AbsenceImpactRequest {
  start_date: string;
  num_days: number;
  employees: EmployeeInput[];
  absence_event: AbsenceEventWindow;
  current_assignments: HistoricalShiftAssignment[];
  manual_absences?: ManualAbsence[];
  shift_demand?: ShiftDemandPoint[];
  slot_demand?: SlotDemandPoint[];
  team_profile_id?: string;
  team_profile_config?: TeamProfileConfig;
}

export interface AbsenceImpactResponse {
  employee_id: number;
  start_date: string;
  end_date: string;
  is_critical_shortage: boolean;
  rationale: string;
  impacts: CoverageImpactItem[];
  summary: {
    impacted_shift_count: number;
    critical_shortage_count: number;
    optional_replacement_count: number;
  };
  notes: string[];
  absentee_fatigue_score?: number; // 0-1 fatigue of the absent employee
}

export interface ReplacementRecommendation {
  absent_employee_id: number;
  replacement_employee_id: number;
  replacement_employee_name?: string;
  absent_region: string;
  replacement_region: string;
  day_offset: number;
  utc_start: string;
  utc_end: string;
  overtime_hours: number;
  region_priority: number;
  recommendation_rank: number;
  ranking_score: number;
  fatigue_score: number;
  fatigue_source: string;
  absentee_fatigue_score?: number;  // fatigue of the absent employee (Story 3)
  rest_hours_since_last_shift?: number;
  consecutive_days_worked: number;
  rationale: string;
}

export interface EmergencyRecommendationResponse {
  recommendations: ReplacementRecommendation[];
  summary: {
    total_recommendations: number;
    best_overtime_hours?: number;
    best_fatigue_score?: number;
    regions_present: string[];
  };
  notes: string[];
}

/** One shift assignment for a single employee on a single day. */
export interface ShiftAssignment {
  slot_name: string;
  shift_type: string;        // "day" | "evening" | "night"
  coverage_label?: string;
  coverage_role?: string;
  utc_start: string;
  utc_end: string;
  utc_start_at: string;
  utc_end_at: string;
  local_start_time?: string;
  local_end_time?: string;
  canonical: boolean;
}

/** One day entry in a staff schedule row. */
export interface DayEntry {
  date: string;              // ISO date string: "YYYY-MM-DD"
  is_working?: boolean;
  shift: ShiftAssignment | null;
  fatigue_score?: number;      // 0-1, from fatigue trajectory
  cumulative_fatigue?: number; // running sum of fatigue up to this day
}

/** One row in the solved schedule — one employee's schedule for the period. */
export interface StaffSchedule {
  employee_id: number;
  employee_name: string;
  days: DayEntry[];
}

/** The full solved schedule returned by the backend. */
export interface SolvedSchedule {
  metadata: {
    start_date: string;
    num_days: number;
    num_staff: number;
    team_profile_id?: string;
    service_timezone?: string;
  };
  staff_schedules: StaffSchedule[];
}

export interface SchedulePlanResponse {
  status: 'planning_ready' | 'solved' | 'solver_failed';
  solved_schedule: SolvedSchedule | null;
  warnings: string[];
  notes: string[];
  fatigue_alerts?: FatigueAlert[];
}

export interface FatigueAlert {
  employee_id: number;
  employee_name?: string;
  utc_date: string;
  fatigue_score: number;    // 0-1
  slot_name?: string;
  shift_type?: string;
  severity: 'warning' | 'critical';
  message: string;
}

export interface FatigueScoresRequest {
  start_date: string;
  num_days: number;
  employees: EmployeeInput[];
  recent_assignments: HistoricalShiftAssignment[];
}

export interface FatigueScoresResponse {
  start_date: string;
  num_days: number;
  fatigue_trajectories: Record<number, number[]>;  // employee_id -> [score per day, 0-1]
}

export interface ScheduleJobResponse {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: SchedulePlanResponse | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulingEvent {
  type: 'sick_leave' | 'time_off' | 'swap' | 'late_arrival' | 'early_departure' | 'coverage_request' | null;
  employee: string | null;
  affected_dates: string[];
  affected_shifts: ('day' | 'evening' | 'night')[] | null;
  swap_target: string | null;
  notes: string;
  urgency: 'immediate' | 'planned' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

export interface ParseNoteRequest {
  note: string;
  employee_roster?: string[];
  today_override?: string;
}

export interface ParseNoteResponse {
  events: SchedulingEvent[];
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${init?.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * POST /schedule/generate/async
 *
 * Starts an async schedule generation job and returns a job_id immediately.
 */
export async function startRedistribute(
  request: ScheduleRequest,
): Promise<{ job_id: string }> {
  return apiFetch<{ job_id: string }>('/schedule/generate/async', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * GET /schedule/job/{job_id}
 *
 * Polls the status of an async schedule job.
 */
export async function pollJob(jobId: string): Promise<ScheduleJobResponse> {
  return apiFetch<ScheduleJobResponse>(`/schedule/job/${jobId}`);
}

/**
 * POST /fatigue/scores
 *
 * Computes per-employee fatigue trajectories without invoking the scheduler.
 * Use to power fatigue rings after manual shift changes.
 */
export async function computeFatigueScores(
  request: FatigueScoresRequest,
): Promise<FatigueScoresResponse> {
  return apiFetch<FatigueScoresResponse>('/fatigue/scores', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function getEmergencyRecommendations(
  request: EmergencyRecommendationRequest,
): Promise<EmergencyRecommendationResponse> {
  return apiFetch<EmergencyRecommendationResponse>('/emergency/recommendations', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function analyzeAbsenceImpact(
  request: AbsenceImpactRequest,
): Promise<AbsenceImpactResponse> {
  return apiFetch<AbsenceImpactResponse>('/absence/impact', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}



/**
 * POST /notes/parse
 *
 * Parse a natural language manager note into structured scheduling events.
 */
export async function parseManagerNote(
  request: ParseNoteRequest,
): Promise<ParseNoteResponse> {
  return apiFetch<ParseNoteResponse>('/notes/parse', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
