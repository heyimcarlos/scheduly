import { Shift, TeamMember } from "@/types/scheduler";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Clock, MapPin, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface GroupedShiftCardProps {
  shifts: Shift[];
  members: TeamMember[];
  style?: React.CSSProperties;
  onShiftClick?: (shift: Shift) => void;
}

export function GroupedShiftCard({ shifts, members, style, onShiftClick }: GroupedShiftCardProps) {
  if (!shifts.length || !members.length) return null;

  const firstShift = shifts[0];
  const hasPending = shifts.some((shift) => shift.isPending);
  const regionCount = new Set(members.map((member) => member.region)).size;
  const initialsPreview = members.slice(0, 3).map((member) => member.initials);
  const extraCount = Math.max(members.length - initialsPreview.length, 0);
  const regionLabel =
    regionCount === 1
      ? members[0].region.charAt(0).toUpperCase() + members[0].region.slice(1)
      : `${regionCount} regions`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={style}
          className={cn(
            "absolute rounded-md border bg-card/95 px-2 py-1.5 text-left shadow-sm transition-colors hover:bg-accent/80",
            hasPending && "border-dashed border-primary/50 bg-primary/10",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                <Users className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate">{shifts.length} assigned</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5 shrink-0" />
                <span>
                  {format(firstShift.startTime, "HH:mm")} - {format(firstShift.endTime, "HH:mm")}
                </span>
              </div>
            </div>
            {hasPending && (
              <span className="rounded bg-primary/20 px-1 py-0.5 text-[8px] font-bold uppercase text-primary">
                AI
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
            {initialsPreview.map((initials, index) => (
              <div
                key={`${initials}-${index}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-foreground"
              >
                {initials}
              </div>
            ))}
            {extraCount > 0 && (
              <span className="text-[10px] text-muted-foreground">+{extraCount}</span>
            )}
            <span className="truncate text-[10px] text-muted-foreground">{regionLabel}</span>
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">
            {shifts.length} people on this shift
          </div>
          <div className="text-xs text-muted-foreground">
            {format(firstShift.startTime, "EEE HH:mm")} - {format(firstShift.endTime, "EEE HH:mm")}
          </div>
        </div>

        <div className="space-y-1.5">
          {shifts.map((shift, index) => {
            const member = members[index];
            if (!member) return null;

            return (
              <button
                key={shift.id}
                type="button"
                onClick={() => onShiftClick?.(shift)}
                className="flex w-full items-center justify-between rounded-md border border-border/60 px-2 py-2 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{member.name}</div>
                  <div className="text-[11px] text-muted-foreground">{member.role}</div>
                </div>

                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  <span className="capitalize">{member.region}</span>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="text-[11px] font-medium text-foreground">
                    {format(shift.startTime, "HH:mm")} - {format(shift.endTime, "HH:mm")}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {shift.isPending ? "AI suggested" : "Scheduled"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
