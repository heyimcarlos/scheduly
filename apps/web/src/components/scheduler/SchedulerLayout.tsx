import { useState, useCallback, useEffect } from "react";
import {
  Shift,
  Timezone,
  ViewMode,
  CoverageRules,
  DEFAULT_COVERAGE_RULES,
} from "@/types/scheduler";
import { DemandOverrides, WorkloadTemplatePoint } from "@/types/teamProfile";
import { SchedulerSidebar } from "./SchedulerSidebar";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarGrid } from "./CalendarGrid";
import { MonthlyCalendarGrid } from "./MonthlyCalendarGrid";
import { GlobalTimeBar } from "./GlobalTimeBar";
import { ShiftFormModal, ShiftFormData } from "./ShiftFormModal";
import {
  useTeamMembers,
  useShifts,
  useHolidays,
  useSuggestions,
  useUpdateShift,
  useDeleteSuggestion,
  useDeleteShift,
} from "@/hooks/useSchedulerData";
import { useApprovedTimeOff } from "@/hooks/useApprovedTimeOff";
import { useCoverageViolations } from "@/hooks/useCoverageViolations";
import { useRedistribute } from "@/hooks/useRedistribute";
import { useTeamProfileSchedulerSettings } from "@/hooks/useTeamProfileSchedulerSettings";
import { addDays, addWeeks, format, parseISO, subWeeks, addMonths, subMonths } from "date-fns";
import { zonedLocalTimeToUtc } from "@/lib/timezone";
import { toast } from "sonner";

export function SchedulerLayout() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTimezone, setSelectedTimezone] = useState<Timezone>("UTC");
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [coverageRules, setCoverageRules] = useState<CoverageRules>(DEFAULT_COVERAGE_RULES);

  // Shift form modal state
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | undefined>();
  const [defaultHour, setDefaultHour] = useState<number | undefined>();

  const { data: teamMembers = [], isLoading: loadingMembers } = useTeamMembers();
  const { data: dbShifts = [], isLoading: loadingShifts } = useShifts();
  const { data: holidays = [] } = useHolidays();
  const { data: suggestions = [] } = useSuggestions();
  const { data: approvedTimeOffs = [] } = useApprovedTimeOff();
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
  const updateShift = useUpdateShift();
  const deleteSuggestion = useDeleteSuggestion();
  const deleteShift = useDeleteShift();

  // Local shift overrides for optimistic UI
  const [localShifts, setLocalShifts] = useState<Shift[] | null>(null);
  const shifts = localShifts ?? dbShifts;

  // Coverage violations engine
  const violations = useCoverageViolations(shifts, teamMembers, coverageRules, currentDate);

  // Sync local shifts when DB shifts update
  const prevDbShiftsRef = useState(dbShifts)[0];
  if (localShifts !== null && dbShifts !== prevDbShiftsRef) {
    setLocalShifts(null);
  }

  // ── AI Redistribute ────────────────────────────────────────────────────────
  const redistribute = useRedistribute();

  // Surface errors from the solver
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
        description: `${written} ghost shifts written — review and accept/reject in the sidebar`,
      });
    }
  }, [redistribute.status, redistribute.error, redistribute.solvedSchedule]);

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

    // Build EmployeeInput list — optimizer int IDs are array indices.
    // region must be title-cased to match system_config.json keys ("Canada", "India", "Serbia")
    const employees = teamMembers.map((m, idx) => ({
      employee_id: idx,
      region: m.region.charAt(0).toUpperCase() + m.region.slice(1),
      employee_name: m.name,
    }));
    const memberIdsByEmployeeId = Object.fromEntries(
      teamMembers.map((member, idx) => [idx, member.id]),
    );

    // Schedule 30 days starting from the first day of next month
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const startDateStr = startDate.toISOString().split("T")[0];

    redistribute.trigger(
      {
        start_date: startDateStr,
        num_days: 30,
        employees,
        team_profile_id: activeTeamProfile?.template_key ?? activeTeamProfileConfig.template_key,
        team_profile_config: activeTeamProfileConfig,
      },
      { memberIdsByEmployeeId },
    );

    toast.info("AI redistribution started", { description: "Generating 30-day schedule…" });
  }, [
    activeTeamProfile?.template_key,
    activeTeamProfileConfig,
    loadingTeamProfile,
    redistribute,
    teamMembers,
  ]);

  const handleToday = () => setCurrentDate(new Date());
  const handlePrevious = () =>
    setCurrentDate((prev) => (viewMode === "week" ? subWeeks(prev, 1) : subMonths(prev, 1)));
  const handleNext = () =>
    setCurrentDate((prev) => (viewMode === "week" ? addWeeks(prev, 1) : addMonths(prev, 1)));
  const handleViewModeChange = (mode: ViewMode) => setViewMode(mode);
  const handleTimezoneChange = (tz: Timezone) => {
    setSelectedTimezone(tz);
    toast.info(`Timezone changed to ${tz}`);
  };

  const handleAcceptSuggestion = useCallback(
    (id: string) => {
      setLocalShifts((prev) =>
        (prev ?? dbShifts).map((shift) =>
          shift.isPending ? { ...shift, isPending: false } : shift,
        ),
      );
      deleteSuggestion.mutate(id);
      toast.success("Suggestion accepted");
    },
    [dbShifts, deleteSuggestion],
  );

  const handleRejectSuggestion = useCallback(
    (id: string) => {
      setLocalShifts((prev) => (prev ?? dbShifts).filter((shift) => !shift.isPending));
      deleteSuggestion.mutate(id);
      toast.info("Suggestion rejected");
    },
    [dbShifts, deleteSuggestion],
  );

  const handleProcessNotes = useCallback((notes: string) => {
    toast.success("Notes processed");
  }, []);

  const handleShiftMove = useCallback(
    (shiftId: string, newStart: Date, newEnd: Date): boolean => {
      const currentShifts = localShifts ?? dbShifts;
      const shift = currentShifts.find((s) => s.id === shiftId);
      if (!shift) return false;
      const hasOverlap = currentShifts.some(
        (s) =>
          s.id !== shiftId &&
          s.memberId === shift.memberId &&
          newStart < s.endTime &&
          newEnd > s.startTime,
      );
      if (hasOverlap) {
        toast.error("Shift conflict detected");
        return false;
      }
      const updated = { ...shift, startTime: newStart, endTime: newEnd };
      setLocalShifts(currentShifts.map((s) => (s.id === shiftId ? updated : s)));
      updateShift.mutate(updated);
      toast.success("Shift moved");
      return true;
    },
    [localShifts, dbShifts, updateShift],
  );

  const handleCoverageRulesChange = (rules: CoverageRules) => {
    setCoverageRules(rules);
    toast.success("Coverage rules updated");
  };

  const handleDemandOverridesChange = useCallback(
    (overrides: DemandOverrides | undefined) => {
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

  // --- Shift CRUD handlers ---
  const handleCreateShiftClick = () => {
    setEditingShift(null);
    setDefaultDate(currentDate);
    setDefaultHour(8);
    setShiftModalOpen(true);
  };

  const handleEmptySlotClick = useCallback((date: Date, hour: number) => {
    setEditingShift(null);
    setDefaultDate(date);
    setDefaultHour(hour);
    setShiftModalOpen(true);
  }, []);

  const handleMonthDayClick = useCallback((date: Date) => {
    setEditingShift(null);
    setDefaultDate(date);
    setDefaultHour(8);
    setShiftModalOpen(true);
  }, []);

  const handleShiftClick = useCallback((shift: Shift) => {
    setEditingShift(shift);
    setDefaultDate(undefined);
    setDefaultHour(undefined);
    setShiftModalOpen(true);
  }, []);

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

      const startTime = zonedLocalTimeToUtc(data.date, startHour, startMinute, selectedTimezone);
      const endTime = zonedLocalTimeToUtc(endDate, endHour, endMinute, selectedTimezone);

      if (shiftId) {
        // Update existing
        const existing = shifts.find((s) => s.id === shiftId);
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
        // Create new
        createShift.mutate({
          memberId: data.memberId,
          startTime,
          endTime,
          shiftType: data.shiftType,
          title: data.title || undefined,
        });
        toast.success("Shift created");
      }
    },
    [shifts, updateShift, selectedTimezone],
  );

  const handleShiftDelete = useCallback(
    (shiftId: string) => {
      deleteShift.mutate(shiftId);
      toast.success("Shift deleted");
    },
    [deleteShift],
  );

  if (loadingMembers || loadingShifts || loadingTeamProfile) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading scheduler…</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background">
      <GlobalTimeBar />
      <div className="flex-1 flex overflow-hidden">
        <SchedulerSidebar
          teamMembers={teamMembers}
          suggestions={suggestions}
          onAcceptSuggestion={handleAcceptSuggestion}
          onRejectSuggestion={handleRejectSuggestion}
          onProcessNotes={handleProcessNotes}
          fatigueAlerts={redistribute.fatigueAlerts}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <CalendarHeader
            currentDate={currentDate}
            selectedTimezone={selectedTimezone}
            viewMode={viewMode}
            onToday={handleToday}
            onPrevious={handlePrevious}
            onNext={handleNext}
            onTimezoneChange={handleTimezoneChange}
            onViewModeChange={handleViewModeChange}
            onRedistribute={handleRedistribute}
            isRedistributing={redistribute.isRunning}
            coverageRules={coverageRules}
            onCoverageRulesChange={handleCoverageRulesChange}
            demandOverrides={demandOverrides}
            onSaveDemandOverrides={handleDemandOverridesChange}
            workloadTemplate={workloadTemplate}
            slotPolicies={slotPolicies}
            onSaveWorkloadTemplate={handleWorkloadTemplateChange}
            shifts={shifts}
            teamMembers={teamMembers}
            onCreateShift={handleCreateShiftClick}
          />
          {viewMode === "week" ? (
            <CalendarGrid
              currentDate={currentDate}
              shifts={shifts}
              teamMembers={teamMembers}
              holidays={holidays}
              selectedTimezone={selectedTimezone}
              onShiftMove={handleShiftMove}
              coverageRules={coverageRules}
              approvedTimeOffs={approvedTimeOffs}
              violations={violations}
              onEmptySlotClick={handleEmptySlotClick}
              onShiftClick={handleShiftClick}
            />
          ) : (
            <MonthlyCalendarGrid
              currentDate={currentDate}
              shifts={shifts}
              teamMembers={teamMembers}
              holidays={holidays}
              selectedTimezone={selectedTimezone}
              approvedTimeOffs={approvedTimeOffs}
              violations={violations}
              onDayClick={handleMonthDayClick}
              onShiftClick={handleShiftClick}
            />
          )}
        </div>
      </div>

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
