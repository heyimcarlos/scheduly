import { AISuggestion } from '@/types/scheduler';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Check, X, AlertTriangle, Zap, Users, Activity } from 'lucide-react';

interface AISuggestionCardProps {
  suggestion: AISuggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

const typeIcons = {
  redistribute: Zap,
  swap: Users,
  coverage: AlertTriangle,
  fatigue: Activity,
};

const priorityStyles = {
  high: 'border-destructive/50 bg-destructive/5',
  medium: 'border-warning/50 bg-warning/5',
  low: 'border-primary/30 bg-primary/5',
};

export function AISuggestionCard({ suggestion, onAccept, onReject }: AISuggestionCardProps) {
  const Icon = typeIcons[suggestion.type];

  return (
    <div className={cn(
      'p-3 rounded-lg border transition-all duration-200 animate-fade-in',
      priorityStyles[suggestion.priority]
    )}>
      <div className="flex items-start gap-2 mb-2">
        <div className={cn(
          'p-1.5 rounded-md',
          suggestion.priority === 'high' && 'bg-destructive/20 text-destructive',
          suggestion.priority === 'medium' && 'bg-warning/20 text-warning',
          suggestion.priority === 'low' && 'bg-primary/20 text-primary'
        )}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-[10px] font-medium uppercase tracking-wider',
              suggestion.priority === 'high' && 'text-destructive',
              suggestion.priority === 'medium' && 'text-warning',
              suggestion.priority === 'low' && 'text-primary'
            )}>
              {suggestion.priority} Priority
            </span>
          </div>
          <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
            {suggestion.description}
          </p>
        </div>
      </div>
      
      <div className="flex gap-2 mt-3">
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 h-7 text-xs bg-success/10 hover:bg-success/20 text-success"
          onClick={() => onAccept(suggestion.id)}
        >
          <Check className="w-3 h-3 mr-1" />
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 h-7 text-xs bg-destructive/10 hover:bg-destructive/20 text-destructive"
          onClick={() => onReject(suggestion.id)}
        >
          <X className="w-3 h-3 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
}
