import { Button } from '@/components/ui/button';
import { Timezone, TIMEZONE_LABELS, ViewMode, CoverageRules, Shift, TeamMember } from '@/types/scheduler';
import { DemandOverrides, SlotPolicy, WorkloadTemplatePoint } from '@/types/teamProfile';
import { ChevronLeft, ChevronRight, Calendar, Sparkles, Globe, CalendarDays, CalendarRange, Plus, Download, Settings2, Upload, SlidersHorizontal, MoreHorizontal } from 'lucide-react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CoverageRulesModal } from './CoverageRulesModal';
import { ImportCenter } from './ImportCenter';
import { ExportSchedule } from './ExportSchedule';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface CalendarHeaderProps {
  currentDate: Date;
  selectedTimezone: Timezone;
  viewMode: ViewMode;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onTimezoneChange: (tz: Timezone) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onRedistribute: () => void;
  isRedistributing: boolean;
  coverageRules: CoverageRules;
  onCoverageRulesChange: (rules: CoverageRules) => void;
  demandOverrides?: DemandOverrides;
  onSaveDemandOverrides?: (overrides: DemandOverrides | undefined) => void;
  workloadTemplate?: WorkloadTemplatePoint[];
  slotPolicies?: Record<string, SlotPolicy>;
  onSaveWorkloadTemplate?: (template: WorkloadTemplatePoint[] | undefined) => void;
  shifts: Shift[];
  teamMembers: TeamMember[];
  onCreateShift?: () => void;
}

export function CalendarHeader({
  currentDate, selectedTimezone, viewMode, onToday, onPrevious, onNext,
  onTimezoneChange, onViewModeChange, onRedistribute, isRedistributing,
  coverageRules, onCoverageRulesChange, demandOverrides, onSaveDemandOverrides,
  workloadTemplate, slotPolicies, onSaveWorkloadTemplate,
  shifts, teamMembers, onCreateShift,
}: CalendarHeaderProps) {
  const getDateRangeLabel = () => {
    if (viewMode === 'month') return format(currentDate, 'MMMM yyyy');
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
    return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
  };

  return (
    <div className="min-h-14 border-b border-border bg-card/50 px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" />
          <h1 className="text-base font-semibold hidden xl:block">Workforce Scheduler</h1>
          <h1 className="text-base font-semibold hidden md:block xl:hidden">Scheduler</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onToday} className="text-xs h-7">Today</Button>
          <Button variant="ghost" size="icon" onClick={onPrevious} className="h-7 w-7"><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onNext} className="h-7 w-7"><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="min-w-[140px] text-sm font-medium">{getDateRangeLabel()}</div>
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && onViewModeChange(v as ViewMode)} className="bg-muted/50 p-0.5 rounded-md">
          <ToggleGroupItem value="week" className="h-6 px-2 text-xs gap-1 data-[state=on]:bg-background"><CalendarDays className="w-3 h-3" />Week</ToggleGroupItem>
          <ToggleGroupItem value="month" className="h-6 px-2 text-xs gap-1 data-[state=on]:bg-background"><CalendarRange className="w-3 h-3" />Month</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-4 p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Scheduler settings</div>
              <div className="text-xs text-muted-foreground">
                Adjust display preferences and planning constraints.
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timezone</div>
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value={selectedTimezone} onValueChange={(v) => onTimezoneChange(v as Timezone)}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIMEZONE_LABELS).map(([tz, label]) => (
                      <SelectItem key={tz} value={tz} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planning</div>
              <CoverageRulesModal
                rules={coverageRules}
                onSave={onCoverageRulesChange}
                demandOverrides={demandOverrides}
                onSaveDemandOverrides={onSaveDemandOverrides}
                workloadTemplate={workloadTemplate}
                slotPolicies={slotPolicies}
                onSaveWorkloadTemplate={onSaveWorkloadTemplate}
                trigger={
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Coverage rules
                  </Button>
                }
              />
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <MoreHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">More</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 space-y-2 p-2">
            <ImportCenter
              trigger={
                <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
                  <Upload className="h-3.5 w-3.5" />
                  Import schedule
                </Button>
              }
            />
            <ExportSchedule
              shifts={shifts}
              teamMembers={teamMembers}
              currentDate={currentDate}
              trigger={
                <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
                  <Download className="h-3.5 w-3.5" />
                  Export schedule
                </Button>
              }
            />
          </PopoverContent>
        </Popover>

        {onCreateShift && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onCreateShift}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Shift</span>
          </Button>
        )}
        <Button onClick={onRedistribute} disabled={isRedistributing} size="sm" className="gap-1.5 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90">
          {isRedistributing ? <><div className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /><span className="hidden sm:inline">Analyzing...</span></> : <><Sparkles className="w-3.5 h-3.5" /><span className="hidden sm:inline">AI Redistribute</span></>}
        </Button>
      </div>
      </div>
    </div>
  );
}
