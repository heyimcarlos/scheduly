import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Send, CalendarX2 } from 'lucide-react';
import { useNoteParser } from '@/hooks/useNoteParser';
import { toast } from '@/hooks/use-toast';
import type { SchedulingEvent } from '@/lib/api';

interface SMENotesPanelProps {
  onProcessNotes?: (notes: string) => void;
  onCreateUnavailabilityPlan?: (memberId: string, startDate: string, endDate: string) => void;
  teamMembers?: Array<{ id: string; name: string }>;
}

export function SMENotesPanel({
  onProcessNotes,
  onCreateUnavailabilityPlan,
  teamMembers,
}: SMENotesPanelProps) {
  const [notes, setNotes] = useState('');
  const [parsedEvents, setParsedEvents] = useState<SchedulingEvent[]>([]);
  const { mutate: parseNote, isPending } = useNoteParser();

  const handleProcess = () => {
    if (!notes.trim()) return;

    parseNote(
      {
        note: notes.trim(),
        employee_roster: teamMembers?.map((m) => m.name),
      },
      {
        onSuccess: (response) => {
          setParsedEvents(response.events);
          toast({
            title: 'Notes converted to scheduling events',
            description: `${response.events.length} event${response.events.length !== 1 ? 's' : ''} extracted successfully.`,
          });
          onProcessNotes?.(notes);
          setNotes('');
        },
        onError: (error) => {
          toast({
            title: 'Failed to process notes',
            description: error.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleCreatePlan = (event: SchedulingEvent) => {
    if (!onCreateUnavailabilityPlan || !event.employee || !event.affected_dates.length) return;

    // Resolve employee name to member ID
    const member = teamMembers?.find(
      (m) => m.name.toLowerCase().includes(event.employee!.toLowerCase())
        || event.employee!.toLowerCase().includes(m.name.toLowerCase()),
    );
    if (!member) {
      toast({
        title: 'Employee not found',
        description: `Could not match "${event.employee}" to a team member.`,
        variant: 'destructive',
      });
      return;
    }

    const sortedDates = [...event.affected_dates].sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];

    onCreateUnavailabilityPlan(member.id, startDate, endDate);
  };

  const isUnavailabilityEvent = (event: SchedulingEvent) =>
    event.type === 'time_off' || event.type === 'sick_leave';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">SME Notes</h3>
      </div>

      <Textarea
        placeholder="Paste situational notes here... e.g., 'India holiday on Friday' or 'Marcus unavailable Feb 16-20'"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="min-h-[100px] resize-none bg-muted/50 border-border text-sm placeholder:text-muted-foreground/50"
      />

      <Button
        onClick={handleProcess}
        disabled={!notes.trim() || isPending}
        className="w-full gap-2"
        variant="default"
      >
        {isPending ? (
          <>
            <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Process Notes
          </>
        )}
      </Button>

      {/* Parsed events */}
      {parsedEvents.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground font-medium">Parsed Events</p>
          {parsedEvents.map((event, idx) => (
            <div
              key={idx}
              className="border rounded-md p-2.5 space-y-1.5 text-sm bg-background/60"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                {event.type && (
                  <Badge variant="outline" className="text-[10px] px-1.5">
                    {event.type.replace('_', ' ')}
                  </Badge>
                )}
                {event.employee && (
                  <span className="font-medium text-xs">{event.employee}</span>
                )}
                <Badge
                  variant={
                    event.confidence === 'high'
                      ? 'default'
                      : event.confidence === 'medium'
                        ? 'secondary'
                        : 'destructive'
                  }
                  className="text-[10px] px-1.5"
                >
                  {event.confidence}
                </Badge>
              </div>

              {event.affected_dates.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {event.affected_dates.join(', ')}
                </p>
              )}

              {event.notes && (
                <p className="text-xs text-muted-foreground italic">{event.notes}</p>
              )}

              {isUnavailabilityEvent(event) &&
                event.employee &&
                event.affected_dates.length > 0 &&
                onCreateUnavailabilityPlan && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5 h-7 text-xs mt-1"
                    onClick={() => handleCreatePlan(event)}
                  >
                    <CalendarX2 className="h-3 w-3" />
                    Create Unavailability Plan
                  </Button>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
