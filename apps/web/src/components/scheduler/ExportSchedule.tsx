import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Download, 
  FileText, 
  Table as TableIcon,
  CheckCircle,
  Users
} from 'lucide-react';
import { Shift, TeamMember } from '@/types/scheduler';
import { format, startOfWeek, endOfWeek } from 'date-fns';

interface ExportScheduleProps {
  shifts: Shift[];
  teamMembers: TeamMember[];
  currentDate: Date;
  trigger?: React.ReactNode;
}

export function ExportSchedule({ shifts, teamMembers, currentDate, trigger }: ExportScheduleProps) {
  const [open, setOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'csv'>('pdf');

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });

  // Calculate hours per team member
  const hoursPerMember = teamMembers.map(member => {
    const memberShifts = shifts.filter(s => s.memberId === member.id && !s.isPending);
    const totalHours = memberShifts.reduce((acc, shift) => {
      const hours = (shift.endTime.getTime() - shift.startTime.getTime()) / (1000 * 60 * 60);
      return acc + hours;
    }, 0);
    return {
      member,
      hours: Math.round(totalHours),
    };
  });

  const averageHours = Math.round(
    hoursPerMember.reduce((acc, m) => acc + m.hours, 0) / hoursPerMember.length
  );

  const handleExport = () => {
    // In a real app, this would generate and download the file
    console.log(`Exporting as ${exportFormat}...`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Export Schedule
          </DialogTitle>
          <DialogDescription>
            Export the schedule for {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={exportFormat} onValueChange={(v) => setExportFormat(v as 'pdf' | 'csv')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pdf" className="gap-2">
              <FileText className="w-4 h-4" />
              PDF
            </TabsTrigger>
            <TabsTrigger value="csv" className="gap-2">
              <TableIcon className="w-4 h-4" />
              CSV
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pdf" className="mt-4 space-y-4">
            <div className="border border-border rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold">PDF Preview</h4>
              <div className="bg-muted/30 rounded p-3 space-y-2 text-sm">
                <div className="font-medium">Weekly Schedule Report</div>
                <div className="text-muted-foreground text-xs">
                  {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
                </div>
                <div className="text-muted-foreground text-xs">
                  Team Size: {teamMembers.length} members
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="csv" className="mt-4 space-y-4">
            <div className="border border-border rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold">CSV Columns</h4>
              <div className="flex flex-wrap gap-2">
                {['Date', 'Employee', 'Start', 'End', 'Hours', 'Region', 'Status'].map(col => (
                  <span 
                    key={col}
                    className="px-2 py-1 bg-muted/50 rounded text-xs font-mono"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Weekly Fairness Summary */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold">Weekly Fairness Summary</h4>
          </div>
          <div className="space-y-2">
            {hoursPerMember.map(({ member, hours }) => {
              const deviation = hours - averageHours;
              const isBalanced = Math.abs(deviation) <= 4;
              return (
                <div key={member.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{member.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={hours > 40 ? 'text-warning font-medium' : ''}>
                      {hours}h
                    </span>
                    {isBalanced && (
                      <CheckCircle className="w-3 h-3 text-success" />
                    )}
                    {!isBalanced && deviation > 0 && (
                      <span className="text-xs text-warning">(+{deviation})</span>
                    )}
                    {!isBalanced && deviation < 0 && (
                      <span className="text-xs text-muted-foreground">({deviation})</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t border-border text-xs text-muted-foreground">
            Average: {averageHours}h per team member
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />
            Download {exportFormat.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
