import { format } from 'date-fns';
import { AlertTriangle, Clock3, HeartPulse, MapPin, Sparkles, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import type { AbsenceImpactResponse, ReplacementRecommendation } from '@/lib/api';
import type { Shift } from '@/types/scheduler';
import { cn } from '@/lib/utils';

interface RecommendationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  employeeName?: string;
  absenceImpact?: AbsenceImpactResponse | null;
  recommendations: ReplacementRecommendation[];
  isLoading: boolean;
  error?: string | null;
  onApply: (recommendation: ReplacementRecommendation) => void;
}

export function RecommendationSheet({
  open,
  onOpenChange,
  shift,
  employeeName,
  absenceImpact,
  recommendations,
  isLoading,
  error,
  onApply,
}: RecommendationSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Coverage Recommendations
          </SheetTitle>
          <SheetDescription>
            {shift
              ? `Top ranked replacements for ${employeeName ?? 'selected resource'} on ${format(shift.startTime, 'EEE, MMM d')}`
              : 'Select a scheduled shift to request replacement recommendations.'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {shift && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{employeeName ?? 'Selected shift'}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(shift.startTime, 'EEE, MMM d')} · {format(shift.startTime, 'HH:mm')} - {format(shift.endTime, 'HH:mm')}
                  </div>
                </div>
                <Badge variant="outline">{shift.title ?? 'Scheduled shift'}</Badge>
              </div>
            </div>
          )}

          {absenceImpact && (
            <div className={cn(
              "rounded-xl border p-4 space-y-2",
              absenceImpact.is_critical_shortage
                ? "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20"
                : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20",
            )}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">Coverage Impact</div>
                <Badge variant={absenceImpact.is_critical_shortage ? 'destructive' : 'secondary'}>
                  {absenceImpact.is_critical_shortage ? 'Critical shortage' : 'Replacement optional'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{absenceImpact.rationale}</p>
              {absenceImpact.impacts.map((impact) => (
                <div key={`${impact.utc_date}-${impact.slot_name ?? impact.shift_type}`} className="rounded-lg bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">
                    {impact.slot_name ?? impact.shift_type} · {impact.utc_date}
                  </div>
                  <div className="mt-1">
                    Remaining {impact.remaining_headcount} / minimum {impact.minimum_required_headcount} · scheduled {impact.scheduled_headcount}
                  </div>
                  <div className="mt-1">{impact.rationale}</div>
                </div>
              ))}
            </div>
          )}

          {isLoading && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              Building fatigue-aware replacement recommendations...
            </div>
          )}

          {error && !isLoading && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </div>
          )}

          {!isLoading && !error && recommendations.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              No candidates available for this event.
            </div>
          )}

          {recommendations.map((recommendation) => (
            <div key={recommendation.replacement_employee_id} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge className="rounded-full">#{recommendation.recommendation_rank}</Badge>
                    <span className="text-sm font-semibold text-foreground">
                      {recommendation.replacement_employee_name ?? `Employee ${recommendation.replacement_employee_id}`}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {recommendation.replacement_region}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      {recommendation.overtime_hours.toFixed(1)}h OT impact
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <HeartPulse className="h-3 w-3" />
                      fatigue {Math.round(recommendation.fatigue_score * 100)}%
                    </span>
                  </div>
                </div>

                <Button size="sm" onClick={() => onApply(recommendation)} className="shrink-0">
                  Apply
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <Metric label="Rest before shift" value={recommendation.rest_hours_since_last_shift != null ? `${recommendation.rest_hours_since_last_shift.toFixed(1)}h` : 'No recent history'} />
                <Metric label="Consecutive days" value={`${recommendation.consecutive_days_worked}`} />
                <Metric label="Region priority" value={`${recommendation.region_priority}`} />
                <Metric label="Ranking score" value={`${recommendation.ranking_score.toFixed(1)}`} />
              </div>

              <Separator />

              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                {recommendation.rationale}
              </div>
            </div>
          ))}

          {!isLoading && recommendations.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <div className="inline-flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3 w-3" />
                Recommendations are advisory
              </div>
              <div className="mt-1">
                Review overtime and fatigue impacts before applying coverage.
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('rounded-lg bg-muted/30 px-3 py-2')}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-foreground">
        <UserRound className="h-3 w-3 text-muted-foreground" />
        {value}
      </div>
    </div>
  );
}
