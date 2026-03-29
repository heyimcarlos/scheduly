import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, User } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Shift, TeamMember } from "@/types/scheduler";
import { useNavigate } from "react-router-dom";

interface DayDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDay: Date | null;
  allShifts: Shift[];
  teamMembers: TeamMember[];
  scheduleTz: string;
  onShiftClick: (shift: Shift) => void;
  onEmptySlotClick: (hour: number) => void;
}

type ShiftKind = "day" | "evening" | "night" | "sick" | "vacation" | "absent";

function inferShiftKind(shift: Shift): ShiftKind {
  switch (shift.shiftType) {
    case "sick":
      return "sick";
    case "vacation":
      return "vacation";
    case "absent":
      return "absent";
    default: {
      const h = shift.startTime.getHours();
      if (h >= 5 && h < 13) return "day";
      if (h >= 13 && h < 21) return "evening";
      return "night";
    }
  }
}

const SHIFT_STYLES: Record<ShiftKind, string> = {
  day: "bg-blue-500/15  text-blue-700  dark:text-blue-300  border-blue-500/20",
  evening: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20",
  night: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/20",
  sick: "bg-red-500/15   text-red-700   dark:text-red-300   border-red-500/20",
  vacation: "bg-green-500/15  text-green-700  dark:text-green-300  border-green-500/20",
  absent: "bg-zinc-500/15   text-zinc-600   dark:text-zinc-400   border-zinc-500/20",
};

const SHIFT_HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayDetailSheet({
  open,
  onOpenChange,
  selectedDay,
  allShifts,
  teamMembers,
  scheduleTz,
  onShiftClick,
  onEmptySlotClick,
}: DayDetailSheetProps) {
  const navigate = useNavigate();

  if (!selectedDay) return null;

  const dayStr = format(selectedDay, "yyyy-MM-dd");
  const dayShifts = allShifts.filter(
    (s) => format(s.startTime, "yyyy-MM-dd") === dayStr,
  );

  const handleViewFullCalendar = () => {
    onOpenChange(false);
    navigate(`/manager/calendar?date=${dayStr}`);
  };

  const assignedMemberIds = new Set(dayShifts.map((s) => s.memberId));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            {format(selectedDay, "EEEE, MMMM d")}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Shifts by employee */}
          {teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No team members found.
            </p>
          ) : (
            teamMembers.map((member) => {
              const memberShifts = dayShifts.filter((s) => s.memberId === member.id);
              return (
                <div key={member.id} className="space-y-2">
                  {/* Employee header */}
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                      {member.initials}
                    </div>
                    <span className="text-sm font-medium text-foreground">{member.name}</span>
                    <Badge variant="outline" className="text-[10px] capitalize ml-auto">
                      <MapPin className="h-3 w-3 mr-0.5" />
                      {member.region}
                    </Badge>
                  </div>

                  {/* Shifts or empty slots */}
                  <div className="pl-8 space-y-1">
                    {memberShifts.length === 0 ? (
                      /* Empty slot — click to create */
                      <button
                        type="button"
                        onClick={() => {
                          // Default to 9am for empty slot click
                          onEmptySlotClick(9);
                        }}
                        className="w-full rounded-md border border-dashed border-border hover:border-primary/50 hover:bg-muted/50 transition-colors py-2 px-3 text-xs text-muted-foreground text-left"
                      >
                        + Add shift
                      </button>
                    ) : (
                      memberShifts.map((shift) => {
                        const kind = inferShiftKind(shift);
                        const startStr = format(shift.startTime, "HH:mm");
                        const endStr = format(shift.endTime, "HH:mm");
                        return (
                          <button
                            key={shift.id}
                            type="button"
                            onClick={() => onShiftClick(shift)}
                            className={cn(
                              "w-full rounded-md border text-xs text-left px-3 py-2 font-medium transition-colors hover:opacity-80",
                              SHIFT_STYLES[kind],
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {startStr} – {endStr}
                              </span>
                              <Badge variant="outline" className="text-[10px] ml-2">
                                {shift.title ?? kind}
                              </Badge>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Coverage summary */}
          {dayShifts.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{dayShifts.length}</span> shift
                {dayShifts.length !== 1 ? "s" : ""} scheduled for{" "}
                {format(selectedDay, "EEEE, MMMM d")}
              </p>
            </div>
          )}

          {/* View full calendar link */}
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={handleViewFullCalendar}
            >
              <CalendarDays className="h-4 w-4" />
              View full calendar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
