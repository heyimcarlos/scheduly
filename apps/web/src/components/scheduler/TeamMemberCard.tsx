import { TeamMember, REGION_COLORS } from '@/types/scheduler';
import { FatigueRing } from './FatigueRing';
import { cn } from '@/lib/utils';
import { MapPin } from 'lucide-react';

interface TeamMemberCardProps {
  member: TeamMember;
  compact?: boolean;
}

export function TeamMemberCard({ member, compact = false }: TeamMemberCardProps) {
  const regionColor = REGION_COLORS[member.region];
  const isCriticalFatigue = member.fatigueScore >= 80;
  const isWarningFatigue = member.fatigueScore >= 50;

  if (compact) {
    return (
      <div className="flex items-center gap-2 py-1">
        <FatigueRing score={member.fatigueScore} size="sm">
          <div className={cn(
            'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
            `bg-${regionColor}/20 text-${regionColor}`
          )}
          style={{
            backgroundColor: `hsl(var(--${regionColor}) / 0.2)`,
            color: `hsl(var(--${regionColor}))`
          }}
          >
            {member.initials}
          </div>
        </FatigueRing>
        <span className="text-sm text-foreground/80">{member.name}</span>
      </div>
    );
  }

  return (
    <div className={cn(
      'group p-3 rounded-lg border border-border bg-card/50 hover:bg-card transition-all duration-200',
      isCriticalFatigue && 'border-destructive/50',
      isWarningFatigue && !isCriticalFatigue && 'border-warning/30'
    )}>
      <div className="flex items-center gap-3">
        <FatigueRing score={member.fatigueScore} size="lg">
          <div 
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{
              backgroundColor: `hsl(var(--${regionColor}) / 0.2)`,
              color: `hsl(var(--${regionColor}))`
            }}
          >
            {member.initials}
          </div>
        </FatigueRing>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{member.name}</span>
            {isCriticalFatigue && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-medium">
                HIGH FATIGUE
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="capitalize">{member.region}</span>
            <span className="mx-1">•</span>
            <span>{member.role}</span>
          </div>
        </div>

        <div className="text-right">
          <div className={cn(
            'text-lg font-bold tabular-nums',
            isCriticalFatigue && 'text-destructive',
            isWarningFatigue && !isCriticalFatigue && 'text-warning',
            !isWarningFatigue && 'text-success'
          )}>
            {member.fatigueScore}%
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Fatigue
          </div>
        </div>
      </div>
    </div>
  );
}
