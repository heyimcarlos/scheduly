/**
 * useRedistribute — TanStack Query v5 hook for the AI Redistribute feature.
 *
 * Usage:
 *   const { trigger, isRunning, status, solvedSchedule, error } = useRedistribute();
 *   trigger(request);   // fires POST /schedule/generate/async
 *
 * Internally:
 *   1. useMutation fires POST → receives job_id
 *   2. useQuery polls GET /schedule/job/{job_id} every 3 s
 *   3. Polling stops when status is "completed" or "failed"
 */

import { useRef, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  startRedistribute,
  pollJob,
  ScheduleRequest,
  SolvedSchedule,
  FatigueAlert,
} from '@/lib/api';
import { Shift } from '@/types/scheduler';
import { useActiveTeamProfile } from '@/hooks/useActiveTeamProfile';
import { createShiftsBulk, type CreateShiftInput } from '@/hooks/useSchedulerData';

export type RedistributeStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'persisting'
  | 'completed'
  | 'failed';

interface TriggerOptions {
  memberIdsByEmployeeId?: Record<number, string>;
}

export interface UseRedistributeReturn {
  /** Start a redistribution job. */
  trigger: (request: ScheduleRequest, options?: TriggerOptions) => void;
  /** True while a job is in-flight (pending or running). */
  isRunning: boolean;
  /** Current job status. */
  status: RedistributeStatus;
  /** The solved schedule payload — available when status === "completed". */
  solvedSchedule: SolvedSchedule | null;
  /** Fatigue alerts from the solver — available when status === "completed". */
  fatigueAlerts: FatigueAlert[];
  /** Converted Shift objects from solvedSchedule — available when status === "completed". */
  convertedShifts: Shift[];
  /** Error message — available when status === "failed". */
  error: string | null;
}

const POLL_INTERVAL_MS = 3_000;

/** Convert a SolvedSchedule (from the async job) into Shift objects for local UI state. */
function solvedScheduleToShifts(
  schedule: SolvedSchedule,
  memberIdsByEmployeeId: Record<number, string>,
): Shift[] {
  return schedule.staff_schedules.flatMap((staffRow) => {
    const memberId = memberIdsByEmployeeId[staffRow.employee_id];
    if (!memberId) return [];

    return staffRow.days
      .filter((dayEntry) => dayEntry.shift)
      .map((dayEntry) => {
        const slotName = dayEntry.shift!.slot_name ?? dayEntry.shift!.shift_type;
        // Infer shiftType from slot name for UI display
        const shiftType: Shift['shiftType'] =
          slotName.toLowerCase().includes('night') ? 'night' as const :
          slotName.toLowerCase().includes('evening') ? 'evening' as const :
          'day' as const;

        return {
          id: crypto.randomUUID(),
          memberId,
          startTime: new Date(dayEntry.shift!.utc_start_at),
          endTime: new Date(dayEntry.shift!.utc_end_at),
          isPending: false,
          isConflict: false,
          isHighFatigue: false,
          isEfficient: false,
          title: dayEntry.shift!.coverage_label
            ? `AI ${dayEntry.shift!.coverage_label}`
            : `AI ${dayEntry.shift!.slot_name ?? dayEntry.shift!.shift_type}`,
          shiftType,
        } satisfies Shift;
      });
  });
}

export function useRedistribute(): UseRedistributeReturn {
  const qc = useQueryClient();
  const { config: activeTeamProfileConfig, profile: activeTeamProfile } = useActiveTeamProfile();
  const [jobId, setJobId] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<RedistributeStatus>('idle');
  const [solvedSchedule, setSolvedSchedule] = useState<SolvedSchedule | null>(null);
  const [convertedShifts, setConvertedShifts] = useState<Shift[]>([]);
  const [fatigueAlerts, setFatigueAlerts] = useState<FatigueAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const memberIdsByEmployeeIdRef = useRef<Record<number, string>>({});
  const persistedJobIdsRef = useRef<Set<string>>(new Set());

  // ── Step 1: start the job ─────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: (request: ScheduleRequest) => startRedistribute(request),
    onMutate: () => {
      setLocalStatus('pending');
      setSolvedSchedule(null);
      setError(null);
      setJobId(null);
    },
    onSuccess: ({ job_id }) => {
        setJobId(job_id);
        setLocalStatus('pending');
    },
    onError: (err: Error) => {
      setLocalStatus('failed');
      setError(err.message);
    },
  });

  const persistMutation = useMutation({
    mutationFn: async ({
      schedule,
      memberIdsByEmployeeId,
    }: {
      schedule: SolvedSchedule;
      memberIdsByEmployeeId: Record<number, string>;
    }) => {
      const shiftsToCreate: CreateShiftInput[] = [];

      for (const staffRow of schedule.staff_schedules) {
        const memberId = memberIdsByEmployeeId[staffRow.employee_id];
        if (!memberId) continue;

        for (const dayEntry of staffRow.days) {
          if (!dayEntry.shift) continue;
          shiftsToCreate.push({
            memberId,
            startTime: new Date(dayEntry.shift.utc_start_at),
            endTime: new Date(dayEntry.shift.utc_end_at),
            shiftType: 'regular',
            title: dayEntry.shift.coverage_label
              ? `AI ${dayEntry.shift.coverage_label}`
              : `AI ${dayEntry.shift.slot_name ?? dayEntry.shift.shift_type}`,
          });
        }
      }

      await createShiftsBulk(shiftsToCreate);
      await qc.invalidateQueries({ queryKey: ['shifts'] });
      return shiftsToCreate.length;
    },
  });

  // ── Step 2: poll the job ──────────────────────────────────────────────────
  const isDone = localStatus === 'completed' || localStatus === 'failed';

  useQuery({
    queryKey: ['redistribute_job', jobId],
    queryFn: async () => {
      const job = await pollJob(jobId!);

      if (job.status === 'running') {
        setLocalStatus('running');
      } else if (job.status === 'completed') {
        const schedule = job.result?.solved_schedule ?? null;
        const alerts = job.result?.fatigue_alerts ?? [];
        setSolvedSchedule(schedule);
        setFatigueAlerts(alerts);
        if (!schedule) {
          setLocalStatus('failed');
          setError('Solver completed without a solved schedule payload.');
          return job;
        }

        if (!persistedJobIdsRef.current.has(jobId!)) {
          persistedJobIdsRef.current.add(jobId!);
          setLocalStatus('persisting');
          try {
            await persistMutation.mutateAsync({
              schedule,
              memberIdsByEmployeeId: memberIdsByEmployeeIdRef.current,
            });
          } catch (persistError) {
            persistedJobIdsRef.current.delete(jobId!);
            setLocalStatus('failed');
            setError(
              persistError instanceof Error
                ? persistError.message
                : 'Failed to persist generated ghost shifts.',
            );
            return job;
          }
        }

        setLocalStatus('completed');
        const localShifts = solvedScheduleToShifts(schedule, memberIdsByEmployeeIdRef.current);
        setConvertedShifts(localShifts);
      } else if (job.status === 'failed') {
        setLocalStatus('failed');
        setError(job.error ?? 'Solver failed with no error message.');
      }

      return job;
    },
    enabled: !!jobId && !isDone,
    refetchInterval: (query) => {
      // Stop polling once the job reaches a terminal state
      const data = query.state.data;
      if (!data) return POLL_INTERVAL_MS;
      return data.status === 'completed' || data.status === 'failed'
        ? false
        : POLL_INTERVAL_MS;
    },
    // Don't retry on error — surface failures immediately
    retry: false,
  });

  // ── Public API ────────────────────────────────────────────────────────────
  const trigger = useCallback(
    (request: ScheduleRequest, options?: TriggerOptions) => {
      const requestWithActiveProfile: ScheduleRequest = {
        ...request,
        team_profile_id:
          request.team_profile_id ??
          activeTeamProfile?.template_key ??
          activeTeamProfileConfig?.template_key,
        team_profile_config:
          request.team_profile_config ?? activeTeamProfileConfig ?? undefined,
      };

      memberIdsByEmployeeIdRef.current = options?.memberIdsByEmployeeId ?? {};
      startMutation.mutate(requestWithActiveProfile);
    },
    [activeTeamProfile?.template_key, activeTeamProfileConfig, startMutation],
  );

  const isRunning = localStatus === 'pending' || localStatus === 'running' || localStatus === 'persisting';

  return { trigger, isRunning, status: localStatus, solvedSchedule, fatigueAlerts, convertedShifts, error };
}
