import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Check,
  SkipForward,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Ban,
  Shield,
  UserX,
} from 'lucide-react';
import { useTeamMembers } from '@/hooks/useSchedulerData';
import {
  useCreateUnavailabilityPlan,
  useApproveDay,
  useSkipDay,
  useUnavailabilityPlan,
} from '@/hooks/useUnavailabilityPlan';
import type { UnavailabilityPlan, UnavailabilityDay } from '@/lib/api';

interface UnavailabilityWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamProfileId: string;
  resumePlanId?: string | null;
  prefill?: {
    memberId: string;
    startDate: string;
    endDate: string;
  };
}

const STATUS_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; className: string; badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  approved: {
    icon: CheckCircle2,
    label: 'Approved',
    className: 'border-green-500/40 bg-green-50/50 dark:bg-green-950/10',
    badgeVariant: 'default',
  },
  skipped: {
    icon: Ban,
    label: 'Skipped',
    className: 'border-muted bg-muted/20',
    badgeVariant: 'secondary',
  },
  no_gap: {
    icon: Shield,
    label: 'No Gap',
    className: 'border-blue-500/30 bg-blue-50/30 dark:bg-blue-950/10',
    badgeVariant: 'secondary',
  },
  needs_manual: {
    icon: AlertTriangle,
    label: 'Needs Manual',
    className: 'border-yellow-500/40 bg-yellow-50/40 dark:bg-yellow-950/10',
    badgeVariant: 'destructive',
  },
  pending: {
    icon: Circle,
    label: 'Pending',
    className: 'border-border',
    badgeVariant: 'outline',
  },
};

export function UnavailabilityWizard({
  open,
  onOpenChange,
  teamProfileId,
  resumePlanId,
  prefill,
}: UnavailabilityWizardProps) {
  const [step, setStep] = useState<'select' | 'loading' | 'review'>('select');
  const [selectedMemberId, setSelectedMemberId] = useState<string>(prefill?.memberId ?? '');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    prefill
      ? { from: new Date(prefill.startDate), to: new Date(prefill.endDate) }
      : undefined,
  );
  const [plan, setPlan] = useState<UnavailabilityPlan | null>(null);

  const { data: allTeamMembers = [] } = useTeamMembers();
  const teamMembers = allTeamMembers.filter(
    (m) => m.teamProfileId === teamProfileId,
  );
  const createPlan = useCreateUnavailabilityPlan();
  const approveDay = useApproveDay();
  const skipDay = useSkipDay();

  // Resume flow: load existing plan on open
  const { data: resumedPlan } = useUnavailabilityPlan(
    open && resumePlanId ? resumePlanId : null,
  );

  useEffect(() => {
    if (resumedPlan && open) {
      setPlan(resumedPlan);
      setStep('review');
    }
  }, [resumedPlan, open]);

  // Apply prefill when it changes
  useEffect(() => {
    if (prefill) {
      setSelectedMemberId(prefill.memberId);
      setDateRange({
        from: new Date(prefill.startDate),
        to: new Date(prefill.endDate),
      });
    }
  }, [prefill]);

  const handleAnalyze = () => {
    if (!selectedMemberId || !dateRange?.from || !dateRange?.to) return;
    setStep('loading');
    createPlan.mutate(
      {
        team_profile_id: teamProfileId,
        absent_member_id: selectedMemberId,
        start_date: format(dateRange.from, 'yyyy-MM-dd'),
        end_date: format(dateRange.to, 'yyyy-MM-dd'),
      },
      {
        onSuccess: (data) => {
          setPlan(data);
          setStep('review');
        },
        onError: () => {
          setStep('select');
        },
      },
    );
  };

  const handleApprove = (dayId: string, memberId: string) => {
    if (!plan) return;
    approveDay.mutate(
      { planId: plan.id, dayId, approvedMemberId: memberId },
      {
        onSuccess: (updatedPlan) => setPlan(updatedPlan),
      },
    );
  };

  const handleSkip = (dayId: string) => {
    if (!plan) return;
    skipDay.mutate(
      { planId: plan.id, dayId },
      {
        onSuccess: (updatedPlan) => setPlan(updatedPlan),
      },
    );
  };

  const handleClose = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setTimeout(() => {
        setStep('select');
        setSelectedMemberId(prefill?.memberId ?? '');
        setDateRange(
          prefill
            ? { from: new Date(prefill.startDate), to: new Date(prefill.endDate) }
            : undefined,
        );
        setPlan(null);
      }, 200);
    }
  };

  const totalDays = plan?.days.length ?? 0;
  const resolvedCount = plan?.days.filter(
    (d) => d.status !== 'pending',
  ).length ?? 0;
  const progressPercent = totalDays > 0 ? Math.round((resolvedCount / totalDays) * 100) : 0;

  const selectedMember = teamMembers.find((m) => m.id === selectedMemberId);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5" />
            {step === 'select' && 'Mark Employee Unavailable'}
            {step === 'loading' && 'Analyzing Coverage...'}
            {step === 'review' && 'Review Replacement Plan'}
          </DialogTitle>
          {step === 'review' && plan && (
            <DialogDescription>
              {selectedMember
                ? `${selectedMember.name} — ${plan.start_date} to ${plan.end_date}`
                : `${plan.start_date} to ${plan.end_date}`}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* ── Step: Select ─────────────────────────────────────────── */}
        {step === 'select' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Employee</label>
              <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name} — {member.region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Unavailability Period</label>
              <div className="flex justify-center">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={1}
                />
              </div>
              {dateRange?.from && dateRange?.to && (
                <p className="text-xs text-muted-foreground text-center">
                  {format(dateRange.from, 'MMM d')} — {format(dateRange.to, 'MMM d, yyyy')}
                </p>
              )}
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={!selectedMemberId || !dateRange?.from || !dateRange?.to}
              className="w-full"
            >
              Analyze Coverage Impact
            </Button>
          </div>
        )}

        {/* ── Step: Loading ────────────────────────────────────────── */}
        {step === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Computing replacements...</p>
              <p className="text-xs text-muted-foreground">
                Analyzing coverage gaps and ranking candidates by fatigue, region, and cascade risk
              </p>
            </div>
          </div>
        )}

        {/* ── Step: Review ─────────────────────────────────────────── */}
        {step === 'review' && plan && (
          <div className="flex flex-col gap-3 min-h-0">
            {/* Progress header */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {resolvedCount} of {totalDays} days reviewed
                </span>
                <Badge variant={plan.status === 'completed' ? 'default' : 'secondary'}>
                  {plan.status}
                </Badge>
              </div>
              <Progress value={progressPercent} className="h-1.5" />
            </div>

            {/* Day cards - scrollable */}
            <div className="overflow-y-auto space-y-2 pr-1 flex-1">
              {plan.days.map((day) => (
                <DayCard
                  key={day.id}
                  day={day}
                  onApprove={handleApprove}
                  onSkip={handleSkip}
                  isApproving={approveDay.isPending}
                  isSkipping={skipDay.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Day Card Component ────────────────────────────────────────────────

function DayCard({
  day,
  onApprove,
  onSkip,
  isApproving,
  isSkipping,
}: {
  day: UnavailabilityDay;
  onApprove: (dayId: string, memberId: string) => void;
  onSkip: (dayId: string) => void;
  isApproving: boolean;
  isSkipping: boolean;
}) {
  const config = STATUS_CONFIG[day.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  return (
    <div
      className={`border rounded-lg p-3 space-y-2 transition-colors ${config.className}`}
      style={day.cascade_depth > 0 ? { marginLeft: `${day.cascade_depth * 12}px` } : undefined}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon className="h-4 w-4 shrink-0" />
          <span className="font-medium text-sm">
            {format(new Date(day.date), 'EEE, MMM d')}
          </span>
          {day.cascade_depth > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Cascade L{day.cascade_depth}
            </Badge>
          )}
        </div>
        <Badge variant={config.badgeVariant} className="text-xs">
          {config.label}
        </Badge>
      </div>

      {/* Needs manual warning */}
      {day.status === 'needs_manual' && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          Cascade depth limit reached — manual assignment required
        </p>
      )}

      {/* Recommendation cards */}
      {day.status === 'pending' && day.recommendations.length > 0 && (
        <div className="space-y-1.5">
          {day.recommendations.map((rec, idx) => (
            <div
              key={rec.member_id}
              className="flex items-center justify-between text-sm bg-background/60 border rounded px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground font-mono w-4">
                    {idx + 1}.
                  </span>
                  <span className="font-medium truncate">{rec.member_name}</span>
                  <span className="text-xs text-muted-foreground">{rec.region}</span>
                </div>
                <div className="flex items-center gap-2 ml-[22px] mt-0.5">
                  <span className="text-[11px] text-muted-foreground">
                    Fatigue {(rec.fatigue_score * 100).toFixed(0)}%
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Rest {rec.rest_hours.toFixed(1)}h
                  </span>
                  {rec.consecutive_days > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {rec.consecutive_days}d streak
                    </span>
                  )}
                  {rec.cascade_cost > 0 && (
                    <span className="text-[11px] text-yellow-600 dark:text-yellow-400">
                      {rec.cascade_cost} cascade risk
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 shrink-0 ml-2 h-7 text-xs"
                onClick={() => onApprove(day.id, rec.member_id)}
                disabled={isApproving}
              >
                <Check className="h-3 w-3" />
                Approve
              </Button>
            </div>
          ))}
        </div>
      )}

      {day.status === 'pending' && day.recommendations.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No replacement candidates available
        </p>
      )}

      {/* Skip button */}
      {day.status === 'pending' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs h-7 text-muted-foreground hover:text-foreground"
            onClick={() => onSkip(day.id)}
            disabled={isSkipping}
          >
            <SkipForward className="h-3 w-3" />
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}
