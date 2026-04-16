import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Send } from 'lucide-react';
import { useNoteParser } from '@/hooks/useNoteParser';
import { toast } from '@/hooks/use-toast';
import type { SchedulingEvent, AbsenceEventWindow } from '@/lib/api';
import type { TeamMember } from '@/types/scheduler';
import { ParsedEventsReview } from './ParsedEventsReview';

interface SMENotesPanelProps {
  teamMembers?: TeamMember[];
  onConfirmParsedEvents?: (absenceEvents: AbsenceEventWindow[]) => void;
  /** @deprecated Use onConfirmParsedEvents instead */
  onProcessNotes?: (notes: string) => void;
}

export function SMENotesPanel({
  teamMembers = [],
  onConfirmParsedEvents,
  onProcessNotes,
}: SMENotesPanelProps) {
  const [notes, setNotes] = useState('');
  const [parsedEvents, setParsedEvents] = useState<SchedulingEvent[] | null>(null);
  const { mutate: parseNote, isPending } = useNoteParser();

  const handleProcess = () => {
    if (!notes.trim()) return;

    parseNote(
      {
        note: notes.trim(),
        employee_roster: teamMembers.length > 0
          ? teamMembers.map((m) => m.name)
          : undefined,
      },
      {
        onSuccess: (response) => {
          if (response.events.length === 0) {
            toast({
              title: 'No events found',
              description: 'Could not extract any scheduling events from the note.',
            });
            return;
          }

          if (onConfirmParsedEvents) {
            // Show review UI
            setParsedEvents(response.events);
          } else {
            // Fallback: legacy behavior
            toast({
              title: 'Notes converted to scheduling events',
              description: `${response.events.length} event${response.events.length !== 1 ? 's' : ''} extracted successfully.`,
            });
            onProcessNotes?.(notes);
            setNotes('');
          }
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

  const handleConfirm = (absenceEvents: AbsenceEventWindow[]) => {
    onConfirmParsedEvents?.(absenceEvents);
    toast({
      title: 'Events applied',
      description: `${absenceEvents.length} absence event${absenceEvents.length !== 1 ? 's' : ''} queued for optimization.`,
    });
    setParsedEvents(null);
    setNotes('');
  };

  const handleCancel = () => {
    setParsedEvents(null);
  };

  // Show review UI if we have parsed events
  if (parsedEvents) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Review Parsed Events</h3>
        </div>
        <ParsedEventsReview
          events={parsedEvents}
          teamMembers={teamMembers}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </div>
    );
  }

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
    </div>
  );
}
