import { useState, useEffect } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Clock, Shield, Users, AlertTriangle, ChevronDown, BarChart3 } from 'lucide-react';
import { CoverageRules } from '@/types/scheduler';
import { DemandOverrides, DemandOverrideGroup, SlotPolicy, WorkloadTemplatePoint } from '@/types/teamProfile';
import { cn } from '@/lib/utils';

type ShiftSlot = 'day' | 'evening' | 'night';
type DayType = 'weekday' | 'weekend';
type WorkloadDayType = 'weekday' | 'weekend';

interface ToggleState {
  weekday: Record<ShiftSlot, boolean>;
  weekend: Record<ShiftSlot, boolean>;
}

interface ValueState {
  weekday: Record<ShiftSlot, { minimum: number; ideal: number }>;
  weekend: Record<ShiftSlot, { minimum: number; ideal: number }>;
}

interface WorkloadRowState {
  enabled: boolean;
  minimum: number;
  ideal: number;
  priority_weight: number;
}

type WorkloadState = Record<string, Record<WorkloadDayType, WorkloadRowState>>;

const SLOTS: ShiftSlot[] = ['day', 'evening', 'night'];
const SLOT_LABELS: Record<ShiftSlot, string> = { day: 'Day', evening: 'Evening', night: 'Night' };

function buildDefaultWorkloadRow(policy?: SlotPolicy): WorkloadRowState {
  const minimum = Math.max(0, policy?.min_headcount ?? 0);
  return {
    enabled: minimum > 0,
    minimum,
    ideal: minimum,
    priority_weight: policy?.canonical ? 2 : 1,
  };
}

function initWorkloadState(
  slotPolicies: Record<string, SlotPolicy>,
  workloadTemplate?: WorkloadTemplatePoint[],
): WorkloadState {
  const state: WorkloadState = {};

  Object.entries(slotPolicies).forEach(([slotName, policy]) => {
    state[slotName] = {
      weekday: buildDefaultWorkloadRow(policy),
      weekend: buildDefaultWorkloadRow(policy),
    };
  });

  for (const row of workloadTemplate ?? []) {
    if (!state[row.slot_name]) {
      state[row.slot_name] = {
        weekday: buildDefaultWorkloadRow(),
        weekend: buildDefaultWorkloadRow(),
      };
    }

    const targets: WorkloadDayType[] = row.day_type === 'all'
      ? ['weekday', 'weekend']
      : [row.day_type as WorkloadDayType];

    for (const target of targets) {
      state[row.slot_name][target] = {
        enabled: true,
        minimum: row.minimum_headcount ?? row.required_headcount ?? 0,
        ideal: row.ideal_headcount ?? row.required_headcount ?? row.minimum_headcount ?? 0,
        priority_weight: row.priority_weight ?? 1,
      };
    }
  }

  return state;
}

function initToggleState(overrides?: DemandOverrides): ToggleState {
  const t: ToggleState = {
    weekday: { day: false, evening: false, night: false },
    weekend: { day: false, evening: false, night: false },
  };
  if (!overrides) return t;
  for (const dt of ['weekday', 'weekend'] as DayType[]) {
    const group = overrides[dt];
    if (!group) continue;
    for (const s of SLOTS) {
      if (group[s]) t[dt][s] = true;
    }
  }
  return t;
}

function initValueState(overrides?: DemandOverrides): ValueState {
  const def = { minimum: 0, ideal: 0 };
  const v: ValueState = {
    weekday: { day: { ...def }, evening: { ...def }, night: { ...def } },
    weekend: { day: { ...def }, evening: { ...def }, night: { ...def } },
  };
  if (!overrides) return v;
  for (const dt of ['weekday', 'weekend'] as DayType[]) {
    const group = overrides[dt];
    if (!group) continue;
    for (const s of SLOTS) {
      if (group[s]) v[dt][s] = { ...group[s] };
    }
  }
  return v;
}

function DemandRow({
  label,
  enabled,
  onToggle,
  minimum,
  ideal,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  minimum: number;
  ideal: number;
  onChange: (field: 'minimum' | 'ideal', value: number) => void;
}) {
  const handleMin = (raw: string) => {
    const v = Math.max(0, parseInt(raw) || 0);
    onChange('minimum', v);
    if (ideal < v) onChange('ideal', v);
  };
  const handleIdeal = (raw: string) => {
    const v = Math.max(0, parseInt(raw) || 0);
    onChange('ideal', v < minimum ? minimum : v);
  };

  return (
    <div className="flex items-center gap-3">
      <Switch checked={enabled} onCheckedChange={onToggle} />
      <span className={cn('text-sm w-16', !enabled && 'text-muted-foreground')}>{label}</span>
      <div className="flex items-center gap-2 flex-1">
        <div className="space-y-0.5 flex-1">
          <Label className="text-[10px] text-muted-foreground">Min</Label>
          <Input
            type="number"
            min={0}
            value={minimum}
            onChange={(e) => handleMin(e.target.value)}
            disabled={!enabled}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-0.5 flex-1">
          <Label className="text-[10px] text-muted-foreground">Ideal</Label>
          <Input
            type="number"
            min={0}
            value={ideal}
            onChange={(e) => handleIdeal(e.target.value)}
            disabled={!enabled}
            className="h-7 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

interface CoverageRulesModalProps {
  rules: CoverageRules;
  onSave: (rules: CoverageRules) => void;
  demandOverrides?: DemandOverrides;
  onSaveDemandOverrides?: (overrides: DemandOverrides | undefined) => void;
  workloadTemplate?: WorkloadTemplatePoint[];
  slotPolicies?: Record<string, SlotPolicy>;
  onSaveWorkloadTemplate?: (template: WorkloadTemplatePoint[] | undefined) => void;
  trigger?: React.ReactNode;
}

export function CoverageRulesModal({
  rules,
  onSave,
  demandOverrides,
  onSaveDemandOverrides,
  workloadTemplate,
  slotPolicies = {},
  onSaveWorkloadTemplate,
  trigger,
}: CoverageRulesModalProps) {
  const [open, setOpen] = useState(false);
  const [localRules, setLocalRules] = useState<CoverageRules>(rules);
  const [toggles, setToggles] = useState<ToggleState>(() => initToggleState(demandOverrides));
  const [values, setValues] = useState<ValueState>(() => initValueState(demandOverrides));
  const [demandOpen, setDemandOpen] = useState(false);
  const [workloadOpen, setWorkloadOpen] = useState(false);
  const [workload, setWorkload] = useState<WorkloadState>(() => initWorkloadState(slotPolicies, workloadTemplate));

  // Re-sync when props change
  useEffect(() => {
    setToggles(initToggleState(demandOverrides));
    setValues(initValueState(demandOverrides));
  }, [demandOverrides]);

  useEffect(() => {
    setWorkload(initWorkloadState(slotPolicies, workloadTemplate));
  }, [slotPolicies, workloadTemplate]);

  const updateToggle = (dt: DayType, slot: ShiftSlot, v: boolean) =>
    setToggles((prev) => ({ ...prev, [dt]: { ...prev[dt], [slot]: v } }));

  const updateValue = (dt: DayType, slot: ShiftSlot, field: 'minimum' | 'ideal', v: number) =>
    setValues((prev) => ({
      ...prev,
      [dt]: { ...prev[dt], [slot]: { ...prev[dt][slot], [field]: v } },
    }));

  const buildDemandOverrides = (): DemandOverrides | undefined => {
    const result: DemandOverrides = {};
    for (const dt of ['weekday', 'weekend'] as DayType[]) {
      const group: DemandOverrideGroup = {};
      let hasAny = false;
      for (const s of SLOTS) {
        if (toggles[dt][s]) {
          group[s] = { ...values[dt][s] };
          hasAny = true;
        }
      }
      if (hasAny) result[dt] = group;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  const updateWorkloadToggle = (slotName: string, dayType: WorkloadDayType, enabled: boolean) =>
    setWorkload((prev) => ({
      ...prev,
      [slotName]: {
        ...prev[slotName],
        [dayType]: { ...prev[slotName][dayType], enabled },
      },
    }));

  const updateWorkloadValue = (
    slotName: string,
    dayType: WorkloadDayType,
    field: 'minimum' | 'ideal' | 'priority_weight',
    value: number,
  ) =>
    setWorkload((prev) => {
      const next = { ...prev[slotName][dayType], [field]: value };
      if (field === 'minimum' && next.ideal < value) {
        next.ideal = value;
      }
      return {
        ...prev,
        [slotName]: {
          ...prev[slotName],
          [dayType]: next,
        },
      };
    });

  const buildWorkloadTemplate = (): WorkloadTemplatePoint[] | undefined => {
    const template: WorkloadTemplatePoint[] = [];
    for (const [slotName, dayTypes] of Object.entries(workload)) {
      (['weekday', 'weekend'] as WorkloadDayType[]).forEach((dayType) => {
        const row = dayTypes[dayType];
        if (!row?.enabled) return;
        template.push({
          slot_name: slotName,
          day_type: dayType,
          minimum_headcount: row.minimum,
          ideal_headcount: Math.max(row.minimum, row.ideal),
          priority_weight: Math.max(1, row.priority_weight),
          source: 'template',
        });
      });
    }
    return template.length > 0 ? template : undefined;
  };

  const handleSave = () => {
    onSave(localRules);
    onSaveDemandOverrides?.(buildDemandOverrides());
    onSaveWorkloadTemplate?.(buildWorkloadTemplate());
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Settings className="w-4 h-4" />
            Coverage Rules
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Coverage Rules
          </DialogTitle>
          <DialogDescription>
            Configure scheduling constraints and compliance requirements.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Peak Windows Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-warning" />
              <h4 className="text-sm font-semibold">Threat Heat Map - Peak Windows</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              Define high-priority coverage windows requiring additional staffing.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Start Time (Toronto)</Label>
                <Input
                  type="time"
                  value={localRules.peakWindowStart}
                  onChange={(e) => setLocalRules(prev => ({ ...prev, peakWindowStart: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End Time (Toronto)</Label>
                <Input
                  type="time"
                  value={localRules.peakWindowEnd}
                  onChange={(e) => setLocalRules(prev => ({ ...prev, peakWindowEnd: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Minimum Staffing During Peak</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={localRules.minimumStaffing}
                onChange={(e) => setLocalRules(prev => ({ ...prev, minimumStaffing: parseInt(e.target.value) || 1 }))}
                className="h-8 text-sm w-24"
              />
            </div>
          </div>

          <Separator />

          {/* Labor Laws Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <h4 className="text-sm font-semibold">Regional Compliance - Labor Laws</h4>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Serbia: 12-Hour Mandatory Rest</Label>
                  <p className="text-xs text-muted-foreground">
                    Enforce minimum 12-hour gap between shifts
                  </p>
                </div>
                <Switch
                  checked={localRules.serbiaRestRule}
                  onCheckedChange={(checked) => setLocalRules(prev => ({ ...prev, serbiaRestRule: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Sequential Days Off Preference</Label>
                  <p className="text-xs text-muted-foreground">
                    Prefer consecutive off days for well-being
                  </p>
                </div>
                <Switch
                  checked={localRules.sequentialDaysOff}
                  onCheckedChange={(checked) => setLocalRules(prev => ({ ...prev, sequentialDaysOff: checked }))}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Seniority Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-semibold">Seniority Guardrails</h4>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">Enforce 1 Senior per Shift</Label>
                <p className="text-xs text-muted-foreground">
                  Require at least one senior team member on every shift
                </p>
              </div>
              <Switch
                checked={localRules.enforceSeniorPerShift}
                onCheckedChange={(checked) => setLocalRules(prev => ({ ...prev, enforceSeniorPerShift: checked }))}
              />
            </div>
          </div>

          <Separator />

          {/* Overtime Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-warning" />
              <h4 className="text-sm font-semibold">Overtime Limits</h4>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Overtime Threshold</Label>
              <Input
                type="number"
                min={20}
                max={60}
                value={localRules.weeklyHourLimit}
                onChange={(e) => setLocalRules(prev => ({ ...prev, weeklyHourLimit: parseInt(e.target.value) || 40 }))}
                className="h-8 text-sm w-24"
              />
            </div>
          </div>

          <Separator />

          {/* Demand Overrides Section */}
          <Collapsible open={demandOpen} onOpenChange={setDemandOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold">Demand Overrides (Optional)</h4>
              </div>
              <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', demandOpen && 'rotate-180')} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-5 pt-3">
              <p className="text-xs text-muted-foreground">
                Manually set minimum and ideal staffing targets per shift when you want to bias planning above the baseline workload template.
              </p>

              {(['weekday', 'weekend'] as DayType[]).map((dt) => (
                <div key={dt} className="space-y-3">
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {dt === 'weekday' ? 'Weekday (Mon–Fri)' : 'Weekend (Sat–Sun)'}
                  </h5>
                  {SLOTS.map((slot) => (
                    <DemandRow
                      key={`${dt}-${slot}`}
                      label={SLOT_LABELS[slot]}
                      enabled={toggles[dt][slot]}
                      onToggle={(v) => updateToggle(dt, slot, v)}
                      minimum={values[dt][slot].minimum}
                      ideal={values[dt][slot].ideal}
                      onChange={(field, v) => updateValue(dt, slot, field, v)}
                    />
                  ))}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          <Collapsible open={workloadOpen} onOpenChange={setWorkloadOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold">Known Workload Template</h4>
              </div>
              <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', workloadOpen && 'rotate-180')} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <p className="text-xs text-muted-foreground">
                Define slot-level demand the optimizer should treat as fact for weekdays and weekends.
              </p>

              {Object.keys(slotPolicies).length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                  Complete team setup before editing known workload.
                </div>
              ) : (
                Object.entries(slotPolicies).map(([slotName, policy]) => (
                  <div key={slotName} className="rounded-md border border-border/70 bg-muted/10 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{slotName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {policy.coverage_label} · {policy.coverage_role}
                        </div>
                      </div>
                      {policy.canonical && (
                        <div className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          Canonical
                        </div>
                      )}
                    </div>

                    {(['weekday', 'weekend'] as WorkloadDayType[]).map((dayType) => {
                      const row = workload[slotName]?.[dayType] ?? buildDefaultWorkloadRow(policy);
                      return (
                        <div key={dayType} className="grid grid-cols-[auto_1fr] gap-3 items-start">
                          <div className="flex items-center gap-2 pt-2">
                            <Switch
                              checked={row.enabled}
                              onCheckedChange={(checked) => updateWorkloadToggle(slotName, dayType, checked)}
                            />
                            <span className="text-xs font-medium capitalize w-16">{dayType}</span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground">Min</Label>
                              <Input
                                type="number"
                                min={0}
                                value={row.minimum}
                                disabled={!row.enabled}
                                onChange={(e) => updateWorkloadValue(slotName, dayType, 'minimum', Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground">Ideal</Label>
                              <Input
                                type="number"
                                min={0}
                                value={row.ideal}
                                disabled={!row.enabled}
                                onChange={(e) => updateWorkloadValue(slotName, dayType, 'ideal', Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground">Priority</Label>
                              <Select
                                value={String(row.priority_weight)}
                                onValueChange={(value) => updateWorkloadValue(slotName, dayType, 'priority_weight', parseInt(value, 10))}
                                disabled={!row.enabled}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {[1, 2, 3, 4, 5].map((priority) => (
                                    <SelectItem key={priority} value={String(priority)} className="text-xs">
                                      {priority}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
