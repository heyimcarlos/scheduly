import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTeamMembersSafe, useShifts, useHolidays } from '@/hooks/useSchedulerData';
import { CalendarGrid } from '@/components/scheduler/CalendarGrid';
import { MonthlyCalendarGrid } from '@/components/scheduler/MonthlyCalendarGrid';
import { CalendarHeader } from '@/components/scheduler/CalendarHeader';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { subWeeks, addWeeks, addMonths, subMonths } from 'date-fns';
import { type Timezone, type ViewMode, DEFAULT_COVERAGE_RULES } from '@/types/scheduler';

export default function EmployeeSchedule() {
  const { teamMemberId } = useAuth();
  const { data: teamMembers = [] } = useTeamMembersSafe();
  const { data: shifts = [] } = useShifts();
  const { data: holidays = [] } = useHolidays();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [selectedTimezone, setSelectedTimezone] = useState<Timezone>('UTC');

  const mappedShifts = useMemo(() => shifts.map(s => ({
    ...s,
    isOwn: s.memberId === teamMemberId,
  })), [shifts, teamMemberId]);

  const handleToday = () => setCurrentDate(new Date());
  const handlePrev = () => setCurrentDate(d => viewMode === 'week' ? subWeeks(d, 1) : subMonths(d, 1));
  const handleNext = () => setCurrentDate(d => viewMode === 'week' ? addWeeks(d, 1) : addMonths(d, 1));

  const exportToICS = () => {
    const myShifts = shifts.filter(s => s.memberId === teamMemberId);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ScheduleAI//EN',
      ...myShifts.flatMap(s => [
        'BEGIN:VEVENT',
        `DTSTART:${new Date(s.startTime).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `DTEND:${new Date(s.endTime).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `SUMMARY:${s.title || s.shiftType}`,
        `UID:${s.id}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-shifts.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">My Schedule</h1>
        <Button variant="outline" size="sm" onClick={exportToICS}>
          <Download className="h-4 w-4 mr-2" />
          Export Calendar
        </Button>
      </div>

      <CalendarHeader
        currentDate={currentDate}
        selectedTimezone={selectedTimezone}
        viewMode={viewMode}
        onToday={handleToday}
        onPrevious={handlePrev}
        onNext={handleNext}
        onTimezoneChange={setSelectedTimezone}
        onViewModeChange={setViewMode}
        isRedistributing={false}
        onRedistribute={() => {}}
        coverageRules={DEFAULT_COVERAGE_RULES}
        onCoverageRulesChange={() => {}}
        shifts={shifts}
        teamMembers={teamMembers}
      />

      <div className="flex-1 overflow-auto">
        {viewMode === 'week' ? (
          <CalendarGrid
            currentDate={currentDate}
            shifts={shifts}
            teamMembers={teamMembers}
            holidays={holidays}
            selectedTimezone={selectedTimezone}
            onShiftMove={() => false}
            coverageRules={DEFAULT_COVERAGE_RULES}
          />
        ) : (
          <MonthlyCalendarGrid
            currentDate={currentDate}
            shifts={shifts}
            teamMembers={teamMembers}
            holidays={holidays}
            selectedTimezone={selectedTimezone}
          />
        )}
      </div>
    </div>
  );
}
