import { useMemo } from "react";
import { Shift, TeamMember, Holiday, Timezone } from "@/types/scheduler";
import {
  ApprovedTimeOff,
  isShiftOnApprovedTimeOff,
  getRequestTypeStyle,
} from "@/hooks/useApprovedTimeOff";
import { ViolationMap } from "@/hooks/useCoverageViolations";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameDay,
  isSameMonth,
  isToday,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Users } from "lucide-react";

const GROUP_THRESHOLD = 4;

type MonthlyRenderItem =
  | {
      kind: "single";
      shift: Shift;
    }
  | {
      kind: "grouped";
      key: string;
      shifts: Shift[];
      members: TeamMember[];
    };

interface MonthlyCalendarGridProps {
  currentDate: Date;
  shifts: Shift[];
  teamMembers: TeamMember[];
  holidays: Holiday[];
  selectedTimezone: Timezone;
  approvedTimeOffs?: ApprovedTimeOff[];
  violations?: ViolationMap;
  onDayClick?: (date: Date) => void;
  onShiftClick?: (shift: Shift) => void;
}

export function MonthlyCalendarGrid({
  currentDate,
  shifts,
  teamMembers,
  holidays,
  approvedTimeOffs = [],
  violations = {},
  onDayClick,
  onShiftClick,
}: MonthlyCalendarGridProps) {
  const getMemberById = (id: string) => teamMembers.find((m) => m.id === id);

  const getHolidayForDay = (date: Date) => {
    return holidays.find((h) => isSameDay(h.date, date));
  };

  const getShiftsForDay = (date: Date) => {
    return shifts.filter((shift) => {
      const shiftStart = new Date(shift.startTime);
      const shiftEnd = new Date(shift.endTime);
      return (
        isSameDay(shiftStart, date) ||
        isSameDay(shiftEnd, date) ||
        (shiftStart < date && shiftEnd > addDays(date, 1))
      );
    });
  };

  const getRenderItemsForDay = (dayShifts: Shift[]): MonthlyRenderItem[] => {
    const groupedBySlot = new Map<string, Shift[]>();

    for (const shift of dayShifts) {
      const shiftStart = new Date(shift.startTime);
      const shiftEnd = new Date(shift.endTime);
      const slotKey = [
        shift.shiftType,
        format(shiftStart, "HH:mm"),
        format(shiftEnd, "HH:mm"),
      ].join(":");
      const slotShifts = groupedBySlot.get(slotKey) ?? [];
      slotShifts.push(shift);
      groupedBySlot.set(slotKey, slotShifts);
    }

    const renderItems: MonthlyRenderItem[] = [];

    for (const slotShifts of groupedBySlot.values()) {
      if (slotShifts.length >= GROUP_THRESHOLD) {
        const members = slotShifts
          .map((shift) => getMemberById(shift.memberId))
          .filter((member): member is TeamMember => !!member);

        if (members.length) {
          renderItems.push({
            kind: "grouped",
            key: `group-${slotShifts.map((shift) => shift.id).join("-")}`,
            shifts: slotShifts,
            members,
          });
          continue;
        }
      }

      for (const shift of slotShifts) {
        renderItems.push({ kind: "single", shift });
      }
    }

    return renderItems.sort((a, b) => {
      const aStart = new Date(
        a.kind === "single" ? a.shift.startTime : a.shifts[0].startTime,
      ).getTime();
      const bStart = new Date(
        b.kind === "single" ? b.shift.startTime : b.shifts[0].startTime,
      ).getTime();
      return aStart - bStart;
    });
  };

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const days: Date[] = [];
    let day = calStart;
    while (day <= calEnd) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentDate]);

  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4">
      {/* Week day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 grid grid-cols-7 gap-1 auto-rows-fr">
        {calendarDays.map((day, index) => {
          const holiday = getHolidayForDay(day);
          const dayShifts = getShiftsForDay(day);
          const renderItems = getRenderItemsForDay(dayShifts);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isTodayDate = isToday(day);

          return (
            <div
              key={index}
              onClick={() => onDayClick?.(day)}
              className={cn(
                "min-h-[100px] rounded-md border border-border/50 p-2 transition-colors cursor-pointer hover:bg-accent/30",
                isCurrentMonth ? "bg-card/30" : "bg-background/50 opacity-50",
                isTodayDate && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                holiday && "holiday-mask",
              )}
            >
              {/* Day number */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={cn(
                    "text-sm font-medium",
                    isTodayDate &&
                      "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center",
                    !isCurrentMonth && "text-muted-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
                {holiday && (
                  <span
                    className="text-[10px] text-warning truncate max-w-[80%]"
                    title={holiday.name}
                  >
                    🎌 {holiday.name}
                  </span>
                )}
              </div>

              {/* Shift indicators */}
              <div className="space-y-1 overflow-hidden">
                <TooltipProvider>
                  {renderItems.slice(0, 3).map((item) => {
                    if (item.kind === "grouped") {
                      const firstShift = item.shifts[0];
                      const initialsPreview = item.members
                        .slice(0, 2)
                        .map((member) => member.initials)
                        .join(", ");
                      const hiddenAssignees = Math.max(item.members.length - 2, 0);
                      const hasPending = item.shifts.some((shift) => shift.isPending);

                      return (
                        <Popover key={item.key}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] transition-colors",
                                hasPending
                                  ? "border border-dashed border-primary/50 bg-primary/20 text-primary"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80",
                              )}
                            >
                              <Users className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {item.shifts.length} assigned •{" "}
                                {format(new Date(firstShift.startTime), "HH:mm")}
                              </span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-72 p-3">
                            <div className="mb-2">
                              <div className="text-sm font-semibold text-foreground">
                                {item.shifts.length} people on this shift
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {format(new Date(firstShift.startTime), "HH:mm")} -{" "}
                                {format(new Date(firstShift.endTime), "HH:mm")}
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {hiddenAssignees > 0
                                  ? `${initialsPreview} +${hiddenAssignees}`
                                  : initialsPreview}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              {item.shifts.map((shift, index) => {
                                const member = item.members[index];
                                if (!member) return null;

                                return (
                                  <button
                                    key={shift.id}
                                    type="button"
                                    onClick={() => onShiftClick?.(shift)}
                                    className="flex w-full items-center justify-between rounded-md border border-border/60 px-2 py-2 text-left transition-colors hover:bg-accent"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-medium text-foreground">
                                        {member.name}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground">
                                        {member.role}
                                      </div>
                                    </div>
                                    <div className="ml-3 shrink-0 text-[11px] text-muted-foreground">
                                      {shift.isPending ? "AI suggested" : "Scheduled"}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    }

                    const shift = item.shift;
                    const member = getMemberById(shift.memberId);
                    if (!member) return null;

                    const timeOffMatch = isShiftOnApprovedTimeOff(
                      shift.memberId,
                      new Date(shift.startTime),
                      new Date(shift.endTime),
                      approvedTimeOffs,
                    );
                    const typeStyle = timeOffMatch
                      ? getRequestTypeStyle(timeOffMatch.requestType)
                      : null;
                    const violation = violations[shift.id];
                    const isOvertime = !!violation?.overtimeHours;
                    const hasRestViolation = !!violation?.restViolationGapMinutes;

                    return (
                      <Tooltip key={shift.id}>
                        <TooltipTrigger asChild>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              onShiftClick?.(shift);
                            }}
                            className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer transition-colors",
                              shift.isPending
                                ? "bg-primary/20 border border-dashed border-primary/50 text-primary"
                                : "bg-muted text-muted-foreground hover:bg-muted/80",
                              shift.isConflict && "glow-danger",
                              shift.isHighFatigue && "border-l-2 border-l-warning",
                              isOvertime &&
                                "ring-1 ring-warning ring-offset-1 ring-offset-background bg-warning/10",
                              hasRestViolation && "border-l-2 border-l-destructive",
                              timeOffMatch &&
                                !isOvertime &&
                                `ring-1 ring-offset-1 ring-offset-background ${typeStyle?.ring}`,
                            )}
                          >
                            {member.initials} • {format(new Date(shift.startTime), "HH:mm")}
                            {isOvertime && <span className="ml-1 text-warning">⏱</span>}
                            {hasRestViolation && <span className="ml-1 text-destructive">⚠</span>}
                            {timeOffMatch && !isOvertime && <span className="ml-1">⚠</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          <div className="font-medium">{member.name}</div>
                          <div className="text-muted-foreground">
                            {format(new Date(shift.startTime), "HH:mm")} -{" "}
                            {format(new Date(shift.endTime), "HH:mm")}
                          </div>
                          {shift.isPending && (
                            <Badge variant="outline" className="mt-1 text-[10px]">
                              AI Suggested
                            </Badge>
                          )}
                          {timeOffMatch && typeStyle && (
                            <Badge
                              variant="outline"
                              className={cn("mt-1 text-[10px]", typeStyle.badge)}
                            >
                              {typeStyle.label} Approved
                            </Badge>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </TooltipProvider>

                {renderItems.length > 3 && (
                  <div className="text-[10px] text-muted-foreground pl-1">
                    +
                    {renderItems
                      .slice(3)
                      .reduce(
                        (count, item) => count + (item.kind === "single" ? 1 : item.shifts.length),
                        0,
                      )}{" "}
                    more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
