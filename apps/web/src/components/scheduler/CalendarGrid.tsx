import { useState } from 'react';
import { Shift, TeamMember, Holiday, Timezone, CoverageRules } from '@/types/scheduler';
import { ViolationMap } from '@/hooks/useCoverageViolations';
import { ApprovedTimeOff } from '@/hooks/useApprovedTimeOff';
import { ShiftCard } from './ShiftCard';
import { GroupedShiftCard } from './GroupedShiftCard';
import { buildCalendarRenderItems, buildPositionedDayShifts } from './calendarLayout';
import { 
  format, 
  startOfWeek, 
  addDays, 
  isSameDay,
  differenceInHours,
  addHours 
} from 'date-fns';
import { cn } from '@/lib/utils';
import {
  getDateKeyInTimeZone,
  getMinutesInTimeZone,
  isMinuteInWindow,
  parseTimeStringToMinutes,
  zonedLocalTimeToUtc,
} from '@/lib/timezone';

interface CalendarGridProps {
  currentDate: Date;
  shifts: Shift[];
  teamMembers: TeamMember[];
  holidays: Holiday[];
  selectedTimezone: Timezone;
  onShiftMove: (shiftId: string, newStart: Date, newEnd: Date) => boolean;
  coverageRules: CoverageRules;
  approvedTimeOffs?: ApprovedTimeOff[];
  violations?: ViolationMap;
  onEmptySlotClick?: (date: Date, hour: number) => void;
  onShiftClick?: (shift: Shift) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 48; // pixels per hour
const COLUMN_PADDING = 4;
const COLUMN_GAP = 6;
const REFERENCE_TIMEZONE = 'America/Toronto';

// Standard shift blocks
const SHIFT_BLOCKS = [
  { start: 8, end: 16, label: '8AM-4PM' },
  { start: 16, end: 24, label: '4PM-12AM' },
  { start: 0, end: 8, label: '12AM-8AM' },
];

// Handoff times with 5-minute overlap shadow
const HANDOFF_HOURS = [0, 8, 16];

export function CalendarGrid({
  currentDate,
  shifts,
  teamMembers,
  holidays,
  selectedTimezone,
  onShiftMove,
  coverageRules,
  approvedTimeOffs = [],
  violations = {},
  onEmptySlotClick,
  onShiftClick,
}: CalendarGridProps) {
  const [draggedShift, setDraggedShift] = useState<Shift | null>(null);
  const [dropPreview, setDropPreview] = useState<{ day: number; hour: number } | null>(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday start for 24/7 view
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Parse peak window hours
  const peakStart = parseTimeStringToMinutes(coverageRules.peakWindowStart);
  const peakEnd = parseTimeStringToMinutes(coverageRules.peakWindowEnd);

  const getMemberById = (id: string) => teamMembers.find(m => m.id === id);

  const getHolidayForDay = (date: Date) => {
    return holidays.find(h => isSameDay(h.date, date));
  };

  const isPeakHour = (day: Date, hour: number): boolean => {
    const columnDateKey = format(day, 'yyyy-MM-dd');
    const cellInstantUtc = zonedLocalTimeToUtc(columnDateKey, hour, 30, selectedTimezone);
    const referenceMinutes = getMinutesInTimeZone(cellInstantUtc, REFERENCE_TIMEZONE);
    return isMinuteInWindow(referenceMinutes, peakStart, peakEnd);
  };

  const isHandoffHour = (hour: number): boolean => {
    return HANDOFF_HOURS.includes(hour);
  };

  const getShiftPosition = (shift: Shift, dayIndex: number) => {
    const dayStart = weekDays[dayIndex];
    const columnDateKey = format(dayStart, 'yyyy-MM-dd');
    const shiftStart = new Date(shift.startTime);
    const shiftEnd = new Date(shift.endTime);

    const startDateKey = getDateKeyInTimeZone(shiftStart, selectedTimezone);
    const endDateKey = getDateKeyInTimeZone(shiftEnd, selectedTimezone);

    if (startDateKey !== columnDateKey && endDateKey !== columnDateKey) {
      return null;
    }

    let startMinutes = getMinutesInTimeZone(shiftStart, selectedTimezone);
    let endMinutes = getMinutesInTimeZone(shiftEnd, selectedTimezone);

    if (startDateKey !== columnDateKey) {
      startMinutes = 0;
    }
    if (endDateKey !== columnDateKey) {
      endMinutes = 24 * 60;
    }

    let durationMinutes = endMinutes - startMinutes;
    if (durationMinutes <= 0) {
      durationMinutes += 24 * 60;
    }

    return {
      top: (startMinutes / 60) * HOUR_HEIGHT,
      height: Math.max((durationMinutes / 60) * HOUR_HEIGHT, HOUR_HEIGHT / 2),
    };
  };

  const handleDragStart = (e: React.DragEvent, shift: Shift) => {
    setDraggedShift(shift);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedShift(null);
    setDropPreview(null);
  };

  const handleDragOver = (e: React.DragEvent, dayIndex: number) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = Math.floor(y / HOUR_HEIGHT);
    setDropPreview({ day: dayIndex, hour });
  };

  const handleDrop = (e: React.DragEvent, dayIndex: number) => {
    e.preventDefault();
    if (!draggedShift || !dropPreview) return;

    const columnDateKey = format(weekDays[dayIndex], 'yyyy-MM-dd');
    const newStart = zonedLocalTimeToUtc(columnDateKey, dropPreview.hour, 0, selectedTimezone);
    const duration = differenceInHours(draggedShift.endTime, draggedShift.startTime);
    const newEnd = addHours(newStart, duration);

    const success = onShiftMove(draggedShift.id, newStart, newEnd);
    
    if (!success) {
      // Trigger shake animation feedback
      console.log('Shift move rejected - constraint violation');
    }

    handleDragEnd();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Day headers */}
      <div className="flex border-b border-border bg-card/30">
        <div className="w-16 flex-shrink-0 border-r border-border" />
        {weekDays.map((day, i) => {
          const holiday = getHolidayForDay(day);
          const isToday = isSameDay(day, new Date());
          
          return (
            <div
              key={i}
              className={cn(
                'flex-1 py-3 px-2 text-center border-r border-border last:border-r-0',
                isToday && 'bg-primary/5'
              )}
            >
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                {format(day, 'EEE')}
              </div>
              <div className={cn(
                'text-lg font-semibold mt-0.5',
                isToday && 'text-primary'
              )}>
                {format(day, 'd')}
              </div>
              {holiday && (
                <div className="text-[10px] text-warning mt-1 truncate">
                  🎌 {holiday.name}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Grid body */}
      <div className="flex-1 overflow-auto">
        <div className="flex" style={{ minHeight: 24 * HOUR_HEIGHT }}>
          {/* Time axis */}
          <div className="w-16 flex-shrink-0 border-r border-border relative">
            {HOURS.map(hour => (
              <div
                key={hour}
                  className={cn(
                    "absolute left-0 right-0 flex items-start justify-end pr-2 text-[10px] text-muted-foreground",
                    isPeakHour(weekStart, hour) && "text-warning font-medium"
                  )}
                  style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                >
                {format(new Date().setHours(hour, 0), 'HH:mm')}
              </div>
            ))}
            {/* Secondary timezone indicator */}
            {selectedTimezone !== 'UTC' && (
              <div className="absolute left-1 top-0 text-[8px] text-primary/60 uppercase">
                {selectedTimezone.split('/')[1]}
              </div>
            )}
          </div>

          {/* Day columns */}
          {weekDays.map((day, dayIndex) => {
            const holiday = getHolidayForDay(day);
            const isToday = isSameDay(day, new Date());
            const dayShifts = shifts.filter(shift => {
              const pos = getShiftPosition(shift, dayIndex);
              return pos !== null;
            });
            const renderItems = buildCalendarRenderItems(
              buildPositionedDayShifts({
                shifts: dayShifts,
                getShiftPosition: (shift) => getShiftPosition(shift, dayIndex),
                getMemberById,
                approvedTimeOffs,
                violations,
              }),
            );

            return (
              <div
                key={dayIndex}
                className={cn(
                  'flex-1 relative border-r border-border last:border-r-0',
                  holiday && 'holiday-mask',
                  isToday && 'bg-primary/[0.02]'
                )}
                onDragOver={(e) => handleDragOver(e, dayIndex)}
                onDrop={(e) => handleDrop(e, dayIndex)}
              >
                {/* Hour lines with peak window heat */}
                {HOURS.map(hour => (
                  <div
                      key={hour}
                      className={cn(
                        "absolute left-0 right-0 border-b border-border/50 cursor-pointer hover:bg-primary/[0.04] transition-colors",
                      isPeakHour(day, hour) && "bg-warning/[0.05]"
                    )}
                    style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    onClick={() => onEmptySlotClick?.(day, hour)}
                  />
                ))}

                {/* Handoff overlap shadows */}
                {HANDOFF_HOURS.map(hour => (
                  <div
                    key={`handoff-${hour}`}
                    className="absolute left-0 right-0 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none"
                    style={{ 
                      top: hour * HOUR_HEIGHT, 
                      height: (5 / 60) * HOUR_HEIGHT, // 5 minute overlap
                    }}
                  >
                    <div className="absolute inset-x-0 top-0 h-px bg-primary/30" />
                  </div>
                ))}

                {/* Drop preview */}
                {dropPreview?.day === dayIndex && draggedShift && (
                  <div
                    className="absolute left-1 right-1 rounded-md border-2 border-dashed border-primary/50 bg-primary/10 pointer-events-none"
                    style={{
                      top: dropPreview.hour * HOUR_HEIGHT,
                      height: differenceInHours(draggedShift.endTime, draggedShift.startTime) * HOUR_HEIGHT,
                    }}
                  />
                )}

                {/* Shifts */}
                {renderItems.map((item) => {
                  const width = item.columnCount === 1
                    ? `calc(100% - ${COLUMN_PADDING * 2}px)`
                    : `calc((100% - ${COLUMN_PADDING * 2}px - ${(item.columnCount - 1) * COLUMN_GAP}px) / ${item.columnCount})`;
                  const left = `calc(${COLUMN_PADDING}px + ${item.columnIndex} * ((100% - ${COLUMN_PADDING * 2}px - ${(item.columnCount - 1) * COLUMN_GAP}px) / ${item.columnCount} + ${COLUMN_GAP}px))`;
                  const style = {
                    top: item.top,
                    height: item.height,
                    left,
                    width,
                  };

                  if (item.kind === 'grouped') {
                    return (
                      <GroupedShiftCard
                        key={item.key}
                        shifts={item.shifts}
                        members={item.members}
                        family={item.family}
                        onShiftClick={onShiftClick}
                        style={style}
                      />
                    );
                  }

                  return (
                    <ShiftCard
                      key={item.key}
                      shift={item.shift}
                      member={item.member}
                      family={item.family}
                      isDragging={draggedShift?.id === item.shift.id}
                      approvedTimeOff={item.approvedTimeOff}
                      violation={item.violation}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onClick={() => onShiftClick?.(item.shift)}
                      style={style}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
