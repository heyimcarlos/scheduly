import { AlertTriangle, AlertCircle, TrendingUp } from 'lucide-react';
import { FatigueAlert } from '@/lib/api';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface FatigueAlertsPanelProps {
  alerts: FatigueAlert[];
  className?: string;
}

export function FatigueAlertsPanel({ alerts, className }: FatigueAlertsPanelProps) {
  if (alerts.length === 0) return null;

  const critical = alerts.filter(a => a.severity === 'critical');
  const warning = alerts.filter(a => a.severity === 'warning');

  return (
    <div className={cn('space-y-3', className)}>
      {critical.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs font-medium text-destructive uppercase tracking-wide">
              Critical Fatigue
            </span>
            <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-destructive/20 text-destructive">
              {critical.length}
            </span>
          </div>
          {critical.map((alert, i) => (
            <FatigueAlertItem key={i} alert={alert} />
          ))}
        </div>
      )}

      {warning.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            <span className="text-xs font-medium text-warning uppercase tracking-wide">
              Elevated Fatigue
            </span>
            <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-warning/20 text-warning">
              {warning.length}
            </span>
          </div>
          {warning.map((alert, i) => (
            <FatigueAlertItem key={i} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}

function FatigueAlertItem({ alert }: { alert: FatigueAlert }) {
  let dateLabel: string;
  try {
    dateLabel = format(parseISO(alert.utc_date), 'MMM d');
  } catch {
    dateLabel = alert.utc_date;
  }

  return (
    <div className={cn(
      'flex items-start gap-2 p-2 rounded-md border text-xs',
      alert.severity === 'critical'
        ? 'border-destructive/30 bg-destructive/5'
        : 'border-warning/30 bg-warning/5'
    )}>
      <TrendingUp className={cn(
        'h-3.5 w-3.5 mt-0.5 shrink-0',
        alert.severity === 'critical' ? 'text-destructive' : 'text-warning'
      )} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="font-medium truncate">
            {alert.employee_name ?? `Employee ${alert.employee_id}`}
          </span>
          <span className={cn(
            'text-[10px] font-bold px-1 rounded',
            alert.severity === 'critical'
              ? 'bg-destructive/20 text-destructive'
              : 'bg-warning/20 text-warning'
          )}>
            {Math.round(alert.fatigue_score * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
          <span>{dateLabel}</span>
          {alert.slot_name && (
            <>
              <span>·</span>
              <span className="truncate">{alert.slot_name}</span>
            </>
          )}
          {alert.shift_type && (
            <>
              <span>·</span>
              <span className="capitalize">{alert.shift_type}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
