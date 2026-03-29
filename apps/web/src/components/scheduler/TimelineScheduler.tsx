import { useState, useMemo, useCallback, useEffect } from "react";
import { addDays, format, startOfWeek, isToday, getDay, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  ChevronLeft,
  ChevronRight,
  Users,
  Loader2,
  MapPin,
  Settings2,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { FatigueRing } from "./FatigueRing";
import { CoverageRulesModal } from "./CoverageRulesModal";
import { RecommendationSheet } from "./RecommendationSheet";
import { DayDetailSheet } from "./DayDetailSheet";
import { ShiftFormModal, ShiftFormData } from "./ShiftFormModal";
import {
  useTeamMembers,
  useShifts,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
} from "@/hooks/useSchedulerData";
import { useEmergencyRecommendations } from "@/hooks/useEmergencyRecommendations";
import { useAbsenceImpact } from "@/hooks/useAbsenceImpact";
import { ReplacementRecommendation } from "@/lib/api";
import { CoverageRules, DEFAULT_COVERAGE_RULES, Shift } from "@/types/scheduler";
import { useRedistribute, type FatigueScoresMap } from "@/hooks/useRedistribute";
import { useFatigueScores } from "@/hooks/useFatigueScores";
import { useTeamProfileSchedulerSettings } from "@/hooks/useTeamProfileSchedulerSettings";
import { WorkloadTemplatePoint } from "@/types/teamProfile";
import { toast } from "sonner";
import { zonedLocalTimeToUtc } from "@/lib/timezone";

// ── Types ────────────────────────────────────────────────────────────────────

type ShiftKind = "day" | "evening" | "night" | "sick" | "vacation" | "absent";

// ── Shift kind inference ─────────────────────────────────────────────────────

function inferShiftKind(shift: Shift): ShiftKind {
  switch (shift.shiftType) {
    case "sick":
      return "sick";
    case "vacation":
      return "vacation";
    case "absent":
      return "absent";
    default: {
      // 'regular' — infer day / evening / night from start hour
      const h = shift.startTime.getHours();
      if (h >= 5 && h < 13) return "day";
      if (h >= 13 && h < 21) return "evening";
      return "night";
    }
  }
}

// ── Date / duration helpers ───────────────────────────────────────────────────

const shiftDate = (s: Shift) => format(s.startTime, "yyyy-MM-dd");
const shiftHours = (s: Shift) => (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;

function proratedHoursForVisibleRange(weeklyHours: number, dayCount: number): number {
  return Math.round((weeklyHours * dayCount) / 7);
}

function hourStatus(
  totalHours: number,
  minHours: number,
  overtimeHours: number,
): "below" | "target" | "overtime" {
  if (totalHours < minHours) return "below";
  if (totalHours > overtimeHours) return "overtime";
  return "target";
}

function thresholdPercent(totalHours: number, thresholdHours: number): number {
  if (thresholdHours <= 0) return 100;
  return Math.min(100, Math.round((totalHours / thresholdHours) * 100));
}

function formatHour(time: string): string {
  const h = parseInt(time.split(":")[0], 10);
  return h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
}

// ── Shift card colors ────────────────────────────────────────────────────────

const SHIFT_STYLES: Record<ShiftKind, string> = {
  day: "bg-blue-500/15  text-blue-700  dark:text-blue-300  border-blue-500/20",
  evening: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20",
  night: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/20",
  sick: "bg-red-500/15   text-red-700   dark:text-red-300   border-red-500/20",
  vacation: "bg-green-500/15  text-green-700  dark:text-green-300  border-green-500/20",
  absent: "bg-zinc-500/15   text-zinc-600   dark:text-zinc-400   border-zinc-500/20",
};

const SHIFT_BG_ONLY: Record<ShiftKind, string> = {
  day: "bg-blue-500/40",
  evening: "bg-orange-500/40",
  night: "bg-purple-500/40",
  sick: "bg-red-500/40",
  vacation: "bg-green-500/40",
  absent: "bg-zinc-500/40",
};

// ── View span options ────────────────────────────────────────────────────────

type ViewSpan = "1" | "7" | "14" | "28";
const VIEW_LABELS: Record<ViewSpan, string> = {
  "1": "Day",
  "7": "Week",
  "14": "2 Wk",
  "28": "4 Wk",
};

const HEADER_HEIGHT = "h-10";

// ── Component ────────────────────────────────────────────────────────────────

export function TimelineScheduler() {
  const [currentDate, setCurrentDate] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [viewSpan, setViewSpan] = useState<ViewSpan>("7");
  const [coverageRules, setCoverageRules] = useState<CoverageRules>(DEFAULT_COVERAGE_RULES);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [recommendationsOpen, setRecommendationsOpen] = useState(false);

  // Day detail panel
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayPanelOpen, setDayPanelOpen] = useState(false);

  // Shift form modal
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | undefined>();
  const [defaultHour, setDefaultHour] = useState<number | undefined>();

  const spanNum = Number(viewSpan);

  // ── Real data ──────────────────────────────────────────────────────────────
  const { data: teamMembers = [], isLoading: loadingMembers } = useTeamMembers();
  const { data: allShifts = [], isLoading: loadingShifts } = useShifts();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const redistribute = useRedistribute();
  const recommendations = useEmergencyRecommendations();
  const absenceImpact = useAbsenceImpact();
  const fatigueScores = useFatigueScores();

  // Combined fatigue scores: AI redistribution scores override manual scores
  const [fatigueScoresMap, setFatigueScoresMap] = useState<FatigueScoresMap>({});
  const {
    activeTeamProfile,
    activeTeamProfileConfig,
    loadingTeamProfile,
    demandOverrides,
    workloadTemplate,
    slotPolicies,
    saveDemandOverrides,
    saveWorkloadTemplate,
  } = useTeamProfileSchedulerSettings();

  const isLoading = loadingMembers || loadingShifts;
  const minHoursTarget = proratedHoursForVisibleRange(
    activeTeamProfileConfig?.rules.min_weekly_hours_required ?? 40,
    spanNum,
  );
  const overtimeThreshold = proratedHoursForVisibleRange(
    activeTeamProfileConfig?.rules.overtime_threshold_hours ?? 40,
    spanNum,
  );

  useEffect(() => {
    if (redistribute.status === "failed") {
      toast.error("AI redistribution failed", {
        description: redistribute.error ?? "Unknown error from the solver",
      });
    } else if (redistribute.status === "completed" && redistribute.solvedSchedule) {
      const written = redistribute.solvedSchedule.staff_schedules.reduce(
        (total, row) => total + row.days.filter((dayEntry) => dayEntry.shift).length,
        0,
      );
      toast.success("AI redistribution complete", {
        description: `${written} ghost shifts written from the timeline view.`,
      });
      // Update fatigue rings with the freshly computed trajectory scores
      if (Object.keys(redistribute.fatigueScores).length > 0) {
        setFatigueScoresMap(redistribute.fatigueScores);
      }
    }
  }, [redistribute.error, redistribute.solvedSchedule, redistribute.status, redistribute.fatigueScores]);

  // ── Date range ─────────────────────────────────────────────────────────────
  const days = useMemo(
    () => Array.from({ length: spanNum }, (_, i) => addDays(currentDate, i)),
    [currentDate, spanNum],
  );

  // ── Shifts visible in this window ──────────────────────────────────────────
  const visibleShifts = useMemo(() => {
    const dateSet = new Set(days.map((d) => format(d, "yyyy-MM-dd")));
    return allShifts.filter((s) => dateSet.has(shiftDate(s)));
  }, [allShifts, days]);

  // ── Per-employee rows ──────────────────────────────────────────────────────
  const employees = useMemo(
    () =>
      teamMembers.map((emp) => {
        const empShifts = visibleShifts.filter((s) => s.memberId === emp.id);
        const totalHours = empShifts.reduce((sum, s) => sum + shiftHours(s), 0);
        return {
          emp,
          empShifts,
          totalHours,
          hourStatus: hourStatus(totalHours, minHoursTarget, overtimeThreshold),
          targetPercent: thresholdPercent(totalHours, minHoursTarget),
        };
      }),
    [minHoursTarget, overtimeThreshold, teamMembers, visibleShifts],
  );

  // ── Coverage (shift count per day) ─────────────────────────────────────────
  const coverage = useMemo(
    () =>
      days.map((day) => {
        const ds = format(day, "yyyy-MM-dd");
        return visibleShifts.filter((s) => shiftDate(s) === ds).length;
      }),
    [days, visibleShifts],
  );

  const handlePrev = () => setCurrentDate((prev) => addDays(prev, -spanNum));
  const handleNext = () => setCurrentDate((prev) => addDays(prev, spanNum));
  const handleToday = () => setCurrentDate(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const handleDemandOverridesChange = useCallback(
    (overrides: typeof demandOverrides) => {
      void saveDemandOverrides(overrides);
    },
    [saveDemandOverrides],
  );

  const handleWorkloadTemplateChange = useCallback(
    (template: WorkloadTemplatePoint[] | undefined) => {
      void saveWorkloadTemplate(template);
    },
    [saveWorkloadTemplate],
  );

  const handleRedistribute = useCallback(() => {
    if (!teamMembers.length) {
      toast.error("No team members loaded yet");
      return;
    }

    if (loadingTeamProfile) {
      toast.info("Loading team profile…");
      return;
    }

    if (!activeTeamProfileConfig) {
      toast.error("Complete team setup before running AI redistribute");
      return;
    }

    const employees = teamMembers.map((member, idx) => ({
      employee_id: idx,
      region: member.region.charAt(0).toUpperCase() + member.region.slice(1),
      employee_name: member.name,
    }));
    const memberIdsByEmployeeId = Object.fromEntries(
      teamMembers.map((member, idx) => [idx, member.id]),
    );

    const startDateStr = format(days[0], "yyyy-MM-dd");

    redistribute.trigger(
      {
        start_date: startDateStr,
        num_days: spanNum,
        employees,
        team_profile_id: activeTeamProfile?.template_key ?? activeTeamProfileConfig.template_key,
        team_profile_config: activeTeamProfileConfig,
      },
      { memberIdsByEmployeeId },
    );

    toast.info("AI redistribution started", {
      description: `Generating ${spanNum}-day schedule from the timeline view…`,
    });
  }, [
    activeTeamProfile?.template_key,
    activeTeamProfileConfig,
    days,
    loadingTeamProfile,
    redistribute,
    spanNum,
    teamMembers,
  ]);

  const handleRecommendationRequest = useCallback(
    async (shift: Shift) => {
      const absentIndex = teamMembers.findIndex((member) => member.id === shift.memberId);
      if (absentIndex < 0) {
        toast.error("Could not match the selected shift to a team member");
        return;
      }

      const startDateStr = format(days[0], "yyyy-MM-dd");
      const shiftDateStr = format(shift.startTime, "yyyy-MM-dd");
      const dayOffset = days.findIndex((day) => format(day, "yyyy-MM-dd") === shiftDateStr);
      if (dayOffset < 0) {
        toast.error("Selected shift is outside the visible recommendation window");
        return;
      }

      const recommendationEmployees = teamMembers.map((member, idx) => ({
        employee_id: idx,
        region: member.region.charAt(0).toUpperCase() + member.region.slice(1),
        employee_name: member.name,
      }));

      const recentAssignments = allShifts
        .map((entry) => {
          const employeeIndex = teamMembers.findIndex((member) => member.id === entry.memberId);
          return {
            employee_id: employeeIndex,
            start_utc: entry.startTime.toISOString(),
            end_utc: entry.endTime.toISOString(),
            shift_type: inferShiftKind(entry),
            slot_name: entry.title ?? undefined,
          };
        })
        .filter((entry) => entry.employee_id >= 0);

      setSelectedShift(shift);
      setRecommendationsOpen(true);
      const absenceWindow = {
        employee_id: absentIndex,
        start_date: shiftDateStr,
        end_date: shiftDateStr,
        reason: "sick",
      };

      try {
        await absenceImpact.mutateAsync({
          start_date: startDateStr,
          num_days: spanNum,
          employees: recommendationEmployees,
          absence_event: absenceWindow,
          current_assignments: recentAssignments,
          team_profile_id: activeTeamProfile?.template_key ?? activeTeamProfileConfig?.template_key,
          team_profile_config: activeTeamProfileConfig,
        });
      } catch {
        return;
      }

      recommendations.mutate({
        start_date: startDateStr,
        num_days: spanNum,
        employees: recommendationEmployees,
        absence_event: {
          absent_employee_id: absentIndex,
          day_offset: dayOffset,
        },
        absence_events: [absenceWindow],
        recent_assignments: recentAssignments,
        top_n: 5,
        prefer_fatigue_model: false,
      });
    },
    [
      absenceImpact,
      activeTeamProfile?.template_key,
      activeTeamProfileConfig,
      allShifts,
      days,
      recommendations,
      spanNum,
      teamMembers,
    ],
  );

  const handleApplyRecommendation = useCallback(
    async (recommendation: ReplacementRecommendation) => {
      if (!selectedShift) return;

      const replacementMember = teamMembers[recommendation.replacement_employee_id];
      if (!replacementMember) {
        toast.error("Could not find the selected replacement resource");
        return;
      }

      await createShift.mutateAsync({
        memberId: replacementMember.id,
        teamProfileId: replacementMember.teamProfileId,
        startTime: selectedShift.startTime,
        endTime: selectedShift.endTime,
        shiftType: selectedShift.shiftType,
        title: `Coverage for ${selectedShift.title ?? 'shift'}`,
      });
      toast.success(`Coverage applied to ${replacementMember.name}`);
      setRecommendationsOpen(false);

      // Recompute fatigue rings with the updated shift state
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const recommendationEmployees = teamMembers.map((member, idx) => ({
        employee_id: idx,
        region: member.region.charAt(0).toUpperCase() + member.region.slice(1),
        employee_name: member.name,
      }));
      const memberIdsByEmployeeId = Object.fromEntries(
        teamMembers.map((member, idx) => [idx, member.id]),
      );
      const recentAssignments = allShifts
        .map((entry) => {
          const employeeIndex = teamMembers.findIndex((member) => member.id === entry.memberId);
          return {
            employee_id: employeeIndex,
            start_utc: entry.startTime.toISOString(),
            end_utc: entry.endTime.toISOString(),
            shift_type: inferShiftKind(entry),
            slot_name: entry.title ?? undefined,
          };
        })
        .filter((entry) => entry.employee_id >= 0);

      try {
        const scores = await fatigueScores.mutateAsync({
          request: {
            start_date: todayStr,
            num_days: 7,
            employees: recommendationEmployees,
            recent_assignments: recentAssignments,
          },
          memberIdsByEmployeeId,
        });
        setFatigueScoresMap((prev) => ({ ...prev, ...scores }));
      } catch {
        // Non-critical — rings will show stale scores
      }
    },
    [allShifts, createShift, fatigueScores, selectedShift, teamMembers],
  );

  // ── Day detail panel ─────────────────────────────────────────────────────
  const scheduleTz = activeTeamProfileConfig?.service_timezone ?? "UTC";
  const [selectedTimezone] = useState<Timezone>(
    () => (activeTeamProfileConfig?.service_timezone as Timezone) ?? "UTC",
  );

  const handleDayClick = useCallback((day: Date) => {
    setSelectedDay(day);
    setDayPanelOpen(true);
  }, []);

  const handleShiftClick = useCallback((shift: Shift) => {
    setEditingShift(shift);
    setDefaultDate(undefined);
    setDefaultHour(undefined);
    setShiftModalOpen(true);
  }, []);

  const handleEmptySlotClick = useCallback((hour: number) => {
    setEditingShift(null);
    setDefaultDate(selectedDay ?? undefined);
    setDefaultHour(hour);
    setShiftModalOpen(true);
  }, [selectedDay]);

  const handleShiftSave = useCallback(
    (data: ShiftFormData, shiftId?: string) => {
      const [startHour, startMinute] = data.startTime.split(":").map(Number);
      const [endHour, endMinute] = data.endTime.split(":").map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
      const endDate =
        endMinutes <= startMinutes
          ? format(addDays(parseISO(data.date), 1), "yyyy-MM-dd")
          : data.date;

      const startTime = zonedLocalTimeToUtc(data.date, startHour, startMinute, scheduleTz);
      const endTime = zonedLocalTimeToUtc(endDate, endHour, endMinute, scheduleTz);

      if (shiftId) {
        const existing = allShifts.find((s) => s.id === shiftId);
        if (!existing) return;
        updateShift.mutate({
          ...existing,
          memberId: data.memberId,
          startTime,
          endTime,
          shiftType: data.shiftType,
          title: data.title || undefined,
        });
        toast.success("Shift updated");
      } else {
        createShift.mutate({
          memberId: data.memberId,
          teamProfileId: activeTeamProfile!.id,
          startTime,
          endTime,
          shiftType: data.shiftType,
          title: data.title || undefined,
        });
        toast.success("Shift created");
      }
    },
    [allShifts, updateShift, scheduleTz, createShift, activeTeamProfile],
  );

  const handleShiftDelete = useCallback(
    (shiftId: string) => {
      deleteShift.mutate(shiftId);
      toast.success("Shift deleted");
    },
    [deleteShift],
  );

  const isCompact = spanNum >= 14;
  const isUltraCompact = spanNum >= 28;

  const colMinWidth = isUltraCompact ? "40px" : isCompact ? "52px" : spanNum === 1 ? "0px" : "80px";
  const gridCols = `repeat(${spanNum}, minmax(${colMinWidth}, 1fr))`;

  const rowHeight = "h-16";

  const isWeekStart = (day: Date, index: number) => index > 0 && getDay(day) === 1;
  const weekBorderClass = (day: Date, index: number) =>
    isWeekStart(day, index) ? "border-l-2 border-l-foreground/20" : "";

  const dateFormat = spanNum <= 7 ? (spanNum === 1 ? "EEEE, MMM d" : "EEE d") : "d";

  return (
    <div className="flex flex-col h-full bg-background">
      <RecommendationSheet
        open={recommendationsOpen}
        onOpenChange={setRecommendationsOpen}
        shift={selectedShift}
        employeeName={selectedShift ? teamMembers.find((member) => member.id === selectedShift.memberId)?.name : undefined}
        absenceImpact={absenceImpact.data ?? null}
        recommendations={recommendations.data?.recommendations ?? []}
        isLoading={absenceImpact.isPending || recommendations.isPending}
        error={absenceImpact.error?.message ?? recommendations.error?.message ?? null}
        onApply={handleApplyRecommendation}
      />

      <DayDetailSheet
        open={dayPanelOpen}
        onOpenChange={setDayPanelOpen}
        selectedDay={selectedDay}
        allShifts={allShifts}
        teamMembers={teamMembers}
        scheduleTz={scheduleTz}
        onShiftClick={handleShiftClick}
        onEmptySlotClick={handleEmptySlotClick}
      />

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={handlePrev} className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleToday} className="h-8 px-3 text-xs">
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={handleNext} className="h-8 w-8">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <span className="text-sm font-medium text-foreground">
          {format(days[0], "MMM d")} – {format(days[days.length - 1], "MMM d, yyyy")}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 rounded-full px-2.5 py-1 text-[11px]">
            <Settings2 className="h-3 w-3" />
            {workloadTemplate.length} workload rules
          </Badge>
          <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px] capitalize">
            {activeTeamProfileConfig?.service_timezone ?? "No profile"}
          </Badge>
          <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">
            Min {minHoursTarget}h / Overtime {overtimeThreshold}h
          </Badge>
        </div>

        <div className="ml-auto">
          <div className="flex flex-wrap items-center gap-2">
            <CoverageRulesModal
              rules={coverageRules}
              onSave={setCoverageRules}
              demandOverrides={demandOverrides}
              onSaveDemandOverrides={handleDemandOverridesChange}
              workloadTemplate={workloadTemplate}
              slotPolicies={slotPolicies}
              onSaveWorkloadTemplate={handleWorkloadTemplateChange}
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5 h-8 px-3 text-xs">
                  <Settings2 className="h-3.5 w-3.5" />
                  Settings
                </Button>
              }
            />

            <ToggleGroup
              type="single"
              value={viewSpan}
              onValueChange={(v) => v && setViewSpan(v as ViewSpan)}
              className="border border-border rounded-lg p-0.5"
            >
              {(Object.entries(VIEW_LABELS) as [ViewSpan, string][]).map(([val, label]) => (
                <ToggleGroupItem
                  key={val}
                  value={val}
                  className="h-7 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <Button
              onClick={handleRedistribute}
              disabled={redistribute.isRunning}
              size="sm"
              className="gap-1.5 h-8 px-3 text-xs bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              {redistribute.isRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Redistribute
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading schedule…</span>
        </div>
      ) : (
        <div className="flex-1 overflow-auto relative">
          <div className="flex w-full">
            {/* ── Left sidebar (sticky) ──────────────────────────────────── */}
            <div className="w-44 shrink-0 sticky left-0 z-20 bg-background border-r border-border">
              {/* Header spacer */}
              <div className={`${HEADER_HEIGHT} border-b border-border`} />

              {/* Employee rows */}
              {employees.map(({ emp, totalHours, hourStatus, targetPercent }) => {
                const ringScore = fatigueScoresMap[emp.id] ?? emp.fatigueScore;
                return (
                  <div
                    key={emp.id}
                    className={cn(
                      `${rowHeight} flex items-center gap-2.5 px-3 border-b border-border`,
                    )}
                  >
                    <FatigueRing score={ringScore} size="md">
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                        {emp.initials}
                      </div>
                    </FatigueRing>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{emp.name}</p>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="capitalize truncate">{emp.region}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {Math.round(totalHours)}h ·{" "}
                        <span
                          className={cn(
                            hourStatus === "below" && "text-amber-600 dark:text-amber-400",
                            hourStatus === "target" && "text-emerald-600 dark:text-emerald-400",
                            hourStatus === "overtime" && "text-rose-600 dark:text-rose-400",
                          )}
                        >
                          {targetPercent}%
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Coverage row */}
              <div className={`${rowHeight} flex items-center gap-3 px-3 bg-muted/30`}>
                <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center">
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">Total Coverage</p>
              </div>
            </div>

            {/* ── Right scrollable area ──────────────────────────────────── */}
            <div className="flex-1">
              {/* Date headers */}
              <div
                className={`${HEADER_HEIGHT} border-b border-border`}
                style={{ display: "grid", gridTemplateColumns: gridCols }}
              >
                {days.map((day, i) => (
                  <div
                    key={day.toISOString()}
                    onClick={() => handleDayClick(day)}
                    className={`flex items-center justify-center text-xs font-medium border-r border-border last:border-r-0 ${weekBorderClass(day, i)} ${
                      isToday(day) ? "bg-primary/10 text-primary" : "text-muted-foreground"
                    } cursor-pointer hover:bg-muted/50 transition-colors`}
                  >
                    {format(day, dateFormat)}
                  </div>
                ))}
              </div>

              {/* Employee shift rows */}
              {employees.map(({ emp, empShifts }) => (
                <div
                  key={emp.id}
                  className={`${rowHeight} border-b border-border`}
                  style={{ display: "grid", gridTemplateColumns: gridCols }}
                >
                  {days.map((day, i) => {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const dayShifts = empShifts.filter((s) => shiftDate(s) === dateStr);

                    return (
                      <div
                        key={day.toISOString()}
                        onClick={() => handleDayClick(day)}
                        className={`flex items-center justify-center min-w-0 overflow-hidden ${isCompact ? "px-0" : "px-1"} border-r border-border last:border-r-0 ${weekBorderClass(day, i)} ${
                          isToday(day) ? "bg-primary/5" : ""
                        }`}
                      >
                        {dayShifts.length > 0 && (
                          <div className="flex flex-col gap-0.5 w-full min-w-0 overflow-hidden px-0.5">
                            {dayShifts.map((shift) => {
                              const kind = inferShiftKind(shift);
                              const scheduleTz = activeTeamProfileConfig?.service_timezone ?? "UTC";
                              const startStr = formatInTimeZone(shift.startTime, scheduleTz, "HH:mm");
                              const endStr = formatInTimeZone(shift.endTime, scheduleTz, "HH:mm");

                              const label = isCompact
                                ? `${formatHour(startStr)}-${formatHour(endStr)}`
                                : `${startStr} – ${endStr}`;

                              return (
                                <div
                                  key={shift.id}
                                  className={cn(
                                    "group relative rounded-md text-xs border h-12 text-center font-medium truncate min-w-0 overflow-hidden w-full",
                                    SHIFT_STYLES[kind],
                                    isCompact ? "leading-none py-1 px-0.5" : "px-2 py-1",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleRecommendationRequest(shift);
                                    }}
                                    className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
                                    aria-label="Get coverage recommendations"
                                  >
                                    <WandSparkles className="h-3 w-3" />
                                  </button>
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Coverage row */}
              <div
                className={`${rowHeight} bg-muted/30`}
                style={{ display: "grid", gridTemplateColumns: gridCols }}
              >
                {coverage.map((count, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-center border-r border-border last:border-r-0 ${weekBorderClass(days[i], i)} ${
                      isToday(days[i]) ? "bg-primary/5" : ""
                    }`}
                  >
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <ShiftFormModal
        open={shiftModalOpen}
        onOpenChange={setShiftModalOpen}
        teamMembers={teamMembers}
        selectedTimezone={selectedTimezone}
        editingShift={editingShift}
        defaultDate={defaultDate}
        defaultHour={defaultHour}
        onSave={handleShiftSave}
        onDelete={handleShiftDelete}
      />
    </div>
  );
}
