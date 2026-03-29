import { Shift, TeamMember, REGION_COLORS } from '@/types/scheduler';
import { ApprovedTimeOff, getRequestTypeStyle } from '@/hooks/useApprovedTimeOff';
import { ShiftViolation } from '@/hooks/useCoverageViolations';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Check, GripVertical, Shield, AlertTriangle, Clock, CalendarOff, TimerOff, Sun, Moon, Sunset, Wifi } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const FAMILY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Morning: Sun,
  Evening: Sunset,
  Night: Moon,
  Hybrid: Wifi,
};

interface ShiftCardProps {
  shift: Shift;
  member: TeamMember;
  family?: string;
  style?: React.CSSProperties;
  isDragging?: boolean;
  approvedTimeOff?: ApprovedTimeOff;
  violation?: ShiftViolation;
  onDragStart?: (e: React.DragEvent, shift: Shift) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onClick?: () => void;
}

export function ShiftCard({
  shift,
  member,
  family,
  style,
  isDragging,
  approvedTimeOff,
  violation,
  onDragStart,
  onDragEnd,
  onClick,
}: ShiftCardProps) {
  const regionColor = REGION_COLORS[member.region];
  const isSenior = member.seniority === 'senior';
  const isSickLeave = shift.shiftType === 'sick';
  const hasRestViolation = shift.hasRestViolation || !!violation?.restViolationGapMinutes;
  const hasTimeOff = !!approvedTimeOff;
  const typeStyle = approvedTimeOff ? getRequestTypeStyle(approvedTimeOff.requestType) : null;
  const isOvertime = !!violation?.overtimeHours;
  const noSenior = !!violation?.noSeniorOnOverlap;

  const cardStyle = {
    ...style,
    backgroundColor: isSickLeave 
      ? 'transparent'
      : `hsl(var(--${regionColor}) / ${shift.isPending ? 0.15 : 0.25})`,
    borderColor: isSickLeave
      ? 'hsl(var(--destructive))'
      : `hsl(var(--${regionColor}) / ${shift.isPending ? 0.5 : 0.6})`,
  };

  return (
    <TooltipProvider>
      <div
        draggable
        onDragStart={(e) => onDragStart?.(e, shift)}
        onDragEnd={onDragEnd}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        style={cardStyle}
        className={cn(
          'absolute rounded-md px-2 py-1.5 cursor-grab active:cursor-grabbing transition-all duration-200 group overflow-hidden',
          shift.isPending && 'opacity-60 border-2 border-dashed',
          !shift.isPending && 'border',
          shift.isConflict && 'glow-danger',
          shift.isHighFatigue && !shift.isConflict && 'glow-warning',
          hasRestViolation && 'border-warning border-2',
          isSickLeave && 'border-2 border-dashed bg-transparent',
          isOvertime && 'ring-2 ring-offset-1 ring-offset-background ring-warning animate-pulse',
          hasTimeOff && !isOvertime && `ring-2 ring-offset-1 ring-offset-background animate-pulse ${typeStyle?.ring}`,
          isDragging && 'opacity-75 scale-105 z-50',
          noSenior && !isSenior && !shift.isPending && 'animate-pulse-slow',
        )}
      >
        {/* Drag handle */}
        <div className="absolute left-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-3 h-3 text-foreground/40" />
        </div>

        {/* Content */}
        <div className="pl-3">
          <div className="flex items-center justify-between gap-1">
            <span 
              className={cn(
                "text-xs font-medium truncate",
                isSickLeave && "line-through text-muted-foreground"
              )}
              style={{ color: isSickLeave ? undefined : `hsl(var(--${regionColor}))` }}
            >
              {member.name}
            </span>
            <div className="flex items-center gap-0.5">
              {/* Seniority Badge */}
              {isSenior && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                      <Shield className="w-2.5 h-2.5 text-primary" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Senior Team Member
                  </TooltipContent>
                </Tooltip>
              )}
              
              {/* Rest Violation Warning */}
              {hasRestViolation && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-4 h-4 rounded-full bg-warning/20 flex items-center justify-center">
                      <AlertTriangle className="w-2.5 h-2.5 text-warning" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    12-Hour Rest Violation
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Efficiency Badge */}
              {shift.isEfficient && !shift.isPending && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-4 h-4 rounded-full bg-success/20 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-success" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Optimized Placement
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            {family && FAMILY_ICONS[family] && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-center">
                    {(() => {
                      const Icon = FAMILY_ICONS[family];
                      return <Icon className="w-2.5 h-2.5" />;
                    })()}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {family} shift
                </TooltipContent>
              </Tooltip>
            )}
            <Clock className="w-2.5 h-2.5" />
            {format(shift.startTime, 'HH:mm')} - {format(shift.endTime, 'HH:mm')}
          </div>
          {shift.title && (
            <div className="mt-0.5 truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground/90">
              {shift.title}
            </div>
          )}
          
          {/* Sick leave indicator */}
          {isSickLeave && (
            <div className="text-[9px] text-destructive font-medium uppercase mt-0.5">
              SICK - GAP
            </div>
          )}

          {/* Approved time-off conflict badge — type-specific */}
          {hasTimeOff && typeStyle && (
            <div className={cn("text-[9px] font-semibold uppercase mt-0.5 flex items-center gap-0.5", typeStyle.badge)}>
              <CalendarOff className="w-2.5 h-2.5" />
              {typeStyle.label} APPROVED
            </div>
          )}

          {/* Overtime violation badge */}
          {isOvertime && violation && (
            <div className="text-[9px] font-semibold uppercase mt-0.5 flex items-center gap-0.5 text-warning">
              <TimerOff className="w-2.5 h-2.5" />
              +{violation.overtimeHours}h OVER LIMIT
            </div>
          )}

          {/* Rest violation badge */}
          {hasRestViolation && violation?.restViolationGapMinutes != null && (
            <div className="text-[9px] font-semibold uppercase mt-0.5 flex items-center gap-0.5 text-warning">
              <AlertTriangle className="w-2.5 h-2.5" />
              {Math.floor(violation.restViolationGapMinutes / 60)}h REST GAP
            </div>
          )}
        </div>

        {/* Pending indicator */}
        {shift.isPending && (
          <div className="absolute top-1 right-1">
            <div className="px-1 py-0.5 rounded text-[8px] font-bold uppercase bg-primary/20 text-primary">
              AI
            </div>
          </div>
        )}

        {/* No Senior Warning - only when coverage rule is violated */}
        {noSenior && !shift.isPending && (
          <div className="absolute bottom-0.5 right-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-3 h-3 rounded-full bg-destructive/30 flex items-center justify-center animate-pulse">
                  <span className="text-[8px] text-destructive font-bold">!</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                No Senior covering this shift
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
