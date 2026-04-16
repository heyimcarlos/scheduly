import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  User,
  Users,
  UserX,
  Coffee,
  LogOut,
  UserPlus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SchedulingEvent, AbsenceEventWindow } from '@/lib/api';
import type { TeamMember } from '@/types/scheduler';
import {
  convertEventsToScheduleInput,
  resolveEmployeeId,
  groupDatesIntoWindows,
  mapEventTypeToReason,
  type ConversionWarning,
} from '@/lib/noteEventsToScheduleInput';

interface ParsedEventsReviewProps {
  events: SchedulingEvent[];
  teamMembers: TeamMember[];
  onConfirm: (absenceEvents: AbsenceEventWindow[]) => void;
  onCancel: () => void;
}

const eventTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  sick_leave: UserX,
  time_off: Coffee,
  swap: Users,
  late_arrival: Clock,
  early_departure: LogOut,
  coverage_request: UserPlus,
};

const eventTypeLabels: Record<string, string> = {
  sick_leave: 'Sick Leave',
  time_off: 'Time Off',
  swap: 'Shift Swap',
  late_arrival: 'Late Arrival',
  early_departure: 'Early Departure',
  coverage_request: 'Coverage Request',
};

export function ParsedEventsReview({
  events,
  teamMembers,
  onConfirm,
  onCancel,
}: ParsedEventsReviewProps) {
  const conversion = useMemo(
    () => convertEventsToScheduleInput(events, teamMembers),
    [events, teamMembers],
  );

  // Default: check high/medium confidence, uncheck low
  const [checked, setChecked] = useState<boolean[]>(() =>
    events.map((e) => e.confidence !== 'low'),
  );

  const toggleEvent = (idx: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  // Build the warnings map for quick lookup
  const warningsByEvent = useMemo(() => {
    const map = new Map<number, ConversionWarning[]>();
    for (const w of conversion.warnings) {
      const list = map.get(w.eventIndex) ?? [];
      list.push(w);
      map.set(w.eventIndex, list);
    }
    return map;
  }, [conversion.warnings]);

  // Skipped event indices
  const skippedIndices = useMemo(() => {
    const set = new Set<number>();
    for (const s of conversion.skippedEvents) {
      const idx = events.indexOf(s.event);
      if (idx !== -1) set.add(idx);
    }
    return set;
  }, [conversion.skippedEvents, events]);

  const handleConfirm = () => {
    // Rebuild absences from only the checked events
    const selectedEvents = events.filter(
      (_, i) => checked[i] && !skippedIndices.has(i),
    );
    const result = convertEventsToScheduleInput(selectedEvents, teamMembers);
    onConfirm(result.absenceEvents);
  };

  const checkedCount = checked.filter(
    (c, i) => c && !skippedIndices.has(i),
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">
          Review Events ({events.length})
        </h4>
        <Badge variant="secondary" className="text-xs">
          {checkedCount} selected
        </Badge>
      </div>

      {teamMembers.length === 0 && (
        <div className="flex items-center gap-1.5 rounded-md border border-yellow-600/30 bg-yellow-600/10 px-2.5 py-1.5 text-xs text-yellow-600 dark:text-yellow-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          No team roster loaded — employee names cannot be resolved.
        </div>
      )}

      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {events.map((event, idx) => {
          const isSkipped = skippedIndices.has(idx);
          const warnings = warningsByEvent.get(idx) ?? [];
          const EventIcon = event.type
            ? eventTypeIcons[event.type] ?? AlertTriangle
            : AlertTriangle;
          const label = event.type
            ? eventTypeLabels[event.type] ?? event.type
            : 'Unknown';

          // Resolve employee for display
          const employeeId =
            event.employee != null
              ? resolveEmployeeId(event.employee, teamMembers)
              : null;
          const resolvedName =
            employeeId !== null ? teamMembers[employeeId].name : null;

          // Compute absence windows for display
          const reason = mapEventTypeToReason(event.type);
          const windows =
            event.affected_dates.length > 0
              ? groupDatesIntoWindows(event.affected_dates)
              : [];

          const skipReason = isSkipped
            ? conversion.skippedEvents.find((s) => s.event === event)?.reason
            : null;

          return (
            <div
              key={idx}
              className={cn(
                'rounded-md border p-2.5 text-sm transition-colors',
                isSkipped && 'opacity-50 bg-muted/30',
                !isSkipped && checked[idx] && 'bg-accent/30 border-accent',
                !isSkipped && !checked[idx] && 'bg-muted/10',
              )}
            >
              <div className="flex items-start gap-2">
                {!isSkipped && (
                  <Checkbox
                    checked={checked[idx]}
                    onCheckedChange={() => toggleEvent(idx)}
                    className="mt-0.5"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <EventIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium">{label}</span>
                    {event.employee && (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {resolvedName ?? event.employee}
                      </span>
                    )}
                    <Badge
                      variant={
                        event.confidence === 'high'
                          ? 'default'
                          : event.confidence === 'medium'
                            ? 'secondary'
                            : 'outline'
                      }
                      className="text-[10px] px-1 py-0"
                    >
                      {event.confidence}
                    </Badge>
                  </div>

                  {/* Resolved mapping */}
                  {!isSkipped && windows.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      {windows.map((w, i) => (
                        <span key={i}>
                          {w.start_date === w.end_date
                            ? w.start_date
                            : `${w.start_date} to ${w.end_date}`}
                          {i < windows.length - 1 && ', '}
                        </span>
                      ))}
                      {reason && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">
                          {reason}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Employee not matched */}
                  {event.employee && !resolvedName && !isSkipped && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="w-3 h-3" />
                      Could not match to roster
                    </div>
                  )}

                  {/* Warnings */}
                  {warnings.map((w, i) => (
                    <div
                      key={i}
                      className="mt-1 flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      {w.message}
                    </div>
                  ))}

                  {/* Skip reason */}
                  {skipReason && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <X className="w-3 h-3" />
                      Skipped: {skipReason}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          className="flex-1 gap-1.5"
          onClick={handleConfirm}
          disabled={checkedCount === 0}
        >
          <Check className="w-3.5 h-3.5" />
          Confirm ({checkedCount})
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
