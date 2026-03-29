import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNoteParser } from '@/hooks/useNoteParser';
import { SchedulingEvent } from '@/lib/api';
import {
  Sparkles,
  Send,
  AlertCircle,
  Calendar,
  Clock,
  User,
  Users,
  AlertTriangle,
  UserX,
  Coffee,
  LogOut,
  UserPlus
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NoteParserProps {
  employeeRoster?: string[];
  onEventsProcessed?: (events: SchedulingEvent[]) => void;
}

const eventTypeIcons = {
  sick_leave: UserX,
  time_off: Coffee,
  swap: Users,
  late_arrival: Clock,
  early_departure: LogOut,
  coverage_request: UserPlus,
};

const eventTypeLabels = {
  sick_leave: 'Sick Leave',
  time_off: 'Time Off',
  swap: 'Shift Swap',
  late_arrival: 'Late Arrival',
  early_departure: 'Early Departure',
  coverage_request: 'Coverage Request',
};

export function NoteParser({ employeeRoster, onEventsProcessed }: NoteParserProps) {
  const [note, setNote] = useState('');
  const { mutate: parseNote, data, isPending, isError, error } = useNoteParser();

  const handleParse = () => {
    if (!note.trim()) return;

    parseNote({
      note: note.trim(),
      employee_roster: employeeRoster,
    }, {
      onSuccess: (response) => {
        if (onEventsProcessed) {
          onEventsProcessed(response.events);
        }
      },
    });
  };

  const getUrgencyVariant = (urgency: string): "default" | "destructive" | "secondary" => {
    switch (urgency) {
      case 'immediate':
        return 'destructive';
      case 'planned':
        return 'default';
      default:
        return 'secondary';
    }
  };

  const getConfidenceVariant = (confidence: string): "default" | "secondary" | "outline" => {
    switch (confidence) {
      case 'high':
        return 'default';
      case 'medium':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <CardTitle>SME Notes</CardTitle>
          </div>
          <CardDescription>
            Enter notes about scheduling changes and let AI extract structured events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="E.g., 'Alice is sick tomorrow night shift. Bob wants to swap Monday with Carlos.'"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            className="resize-none bg-muted/50 border-border"
          />
          <Button
            onClick={handleParse}
            disabled={!note.trim() || isPending}
            className="w-full gap-2"
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
        </CardContent>
      </Card>

      {isError && (
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <CardTitle className="text-destructive">Error</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error.message}</p>
          </CardContent>
        </Card>
      )}

      {data && data.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Parsed Events ({data.events.length})</CardTitle>
            <CardDescription>
              Review the extracted scheduling events below
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.events.map((event, index) => (
                <EventCard key={index} event={event} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EventCard({ event }: { event: SchedulingEvent }) {
  const EventIcon = event.type ? eventTypeIcons[event.type] : AlertTriangle;
  const eventLabel = event.type ? eventTypeLabels[event.type] : 'Unknown Event';

  const getUrgencyVariant = (urgency: string): "default" | "destructive" | "secondary" => {
    switch (urgency) {
      case 'immediate':
        return 'destructive';
      case 'planned':
        return 'default';
      default:
        return 'secondary';
    }
  };

  const getConfidenceVariant = (confidence: string): "default" | "secondary" | "outline" => {
    switch (confidence) {
      case 'high':
        return 'default';
      case 'medium':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <Card className={cn(
      'transition-all duration-200',
      event.confidence === 'low' && 'border-warning/50 bg-warning/5'
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              'p-1.5 rounded-md',
              event.urgency === 'immediate' && 'bg-destructive/20 text-destructive',
              event.urgency === 'planned' && 'bg-primary/20 text-primary',
              event.urgency === 'unknown' && 'bg-muted text-muted-foreground'
            )}>
              <EventIcon className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-base">{eventLabel}</CardTitle>
              {event.employee && (
                <CardDescription className="flex items-center gap-1 mt-1">
                  <User className="w-3 h-3" />
                  {event.employee}
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant={getUrgencyVariant(event.urgency)}>
              {event.urgency}
            </Badge>
            <Badge variant={getConfidenceVariant(event.confidence)}>
              {event.confidence}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {event.affected_dates.length > 0 && (
          <div className="flex items-start gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <span className="text-sm font-medium">Dates: </span>
              <span className="text-sm text-muted-foreground">
                {event.affected_dates.join(', ')}
              </span>
            </div>
          </div>
        )}

        {event.affected_shifts && event.affected_shifts.length > 0 && (
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <span className="text-sm font-medium">Shifts: </span>
              <span className="text-sm text-muted-foreground">
                {event.affected_shifts.map(s =>
                  s.charAt(0).toUpperCase() + s.slice(1)
                ).join(', ')}
              </span>
            </div>
          </div>
        )}

        {event.swap_target && (
          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <span className="text-sm font-medium">Swap with: </span>
              <span className="text-sm text-muted-foreground">{event.swap_target}</span>
            </div>
          </div>
        )}

        {event.notes && (
          <div className="flex items-start gap-2 pt-2 border-t">
            <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <span className="text-sm text-muted-foreground italic">{event.notes}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
