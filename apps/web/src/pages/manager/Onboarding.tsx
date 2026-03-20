import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  buildTeamProfileConfig,
  DEFAULT_REGIONS,
  DEFAULT_RULES,
  DEFAULT_SLOT_POLICIES,
  type TeamProfileConfig,
  type SlotPolicy,
} from '@/types/teamProfile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Globe,
  Clock,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Users,
} from 'lucide-react';
import logo from '@/assets/logo.png';

const STEPS = [
  { label: 'Template', icon: Globe },
  { label: 'Regions', icon: MapPin },
  { label: 'Rules', icon: ShieldCheck },
  { label: 'Slots', icon: Users },
  { label: 'Review', icon: CheckCircle2 },
];

const TIMEZONES = [
  'America/Toronto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'Europe/Belgrade',
  'Europe/London',
  'Asia/Kolkata',
  'UTC',
];

const REGION_ROLES = [
  { value: 'primary', label: 'Primary' },
  { value: 'primary-opener', label: 'Primary Opener' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'patch-only', label: 'Patch Only' },
];

const REGION_COLORS: Record<string, string> = {
  canada: 'bg-[hsl(var(--team-canada))]',
  serbia: 'bg-[hsl(var(--team-serbia))]',
  india: 'bg-[hsl(var(--team-india))]',
};

function deepCloneSlotPolicies(): Record<string, SlotPolicy> {
  return JSON.parse(JSON.stringify(DEFAULT_SLOT_POLICIES));
}

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState('America/Toronto');
  const [regions, setRegions] = useState<Record<string, string>>({ ...DEFAULT_REGIONS });
  const [rules, setRules] = useState<TeamProfileConfig['rules']>({ ...DEFAULT_RULES });
  const [slotPolicies, setSlotPolicies] = useState<Record<string, SlotPolicy>>(deepCloneSlotPolicies);
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const updateRegion = (key: string, value: string) =>
    setRegions(prev => ({ ...prev, [key]: value }));

  const updateRule = <K extends keyof TeamProfileConfig['rules']>(
    key: K,
    value: TeamProfileConfig['rules'][K],
  ) => setRules(prev => ({ ...prev, [key]: value }));

  const updateSlotPolicy = (slotKey: string, field: 'min_headcount' | 'max_headcount', value: number | undefined) => {
    setSlotPolicies(prev => ({
      ...prev,
      [slotKey]: { ...prev[slotKey], [field]: value },
    }));
  };

  const compiledConfig = buildTeamProfileConfig(timezone, rules, regions, slotPolicies);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const insertPayload = {
        owner_user_id: user.id,
        name: 'Primary Team Profile',
        template_key: 'follow_the_sun_support',
        config: JSON.parse(JSON.stringify(compiledConfig)),
        is_active: true,
      };
      const { data: newProfile, error: insertErr } = await supabase
        .from('team_profiles')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          active_team_profile_id: newProfile.id,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateErr) throw updateErr;

      const { error: deactivateErr } = await supabase
        .from('team_profiles')
        .update({ is_active: false })
        .eq('owner_user_id', user.id)
        .neq('id', newProfile.id);

      if (deactivateErr) throw deactivateErr;

      await refreshProfile();
      toast({ title: 'Setup complete', description: 'Your team profile has been created.' });
      navigate('/manager', { replace: true });
    } catch (err: unknown) {
      toast({
        title: 'Error saving profile',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const canProceed = step < STEPS.length - 1;
  const canGoBack = step > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-6">
          <img src={logo} alt="Logo" className="h-7 w-7" />
          <span className="text-sm font-semibold text-foreground">Team Setup</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <div className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.label}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
        <div className="mt-3 flex justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <button
                key={s.label}
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  i <= step
                    ? 'text-primary'
                    : 'text-muted-foreground'
                } ${i < step ? 'cursor-pointer hover:text-primary/80' : 'cursor-default'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-5">
          {/* Left panel — forms */}
          <div className="lg:col-span-3">
            {step === 0 && <StepTemplate timezone={timezone} setTimezone={setTimezone} />}
            {step === 1 && <StepRegions regions={regions} updateRegion={updateRegion} />}
            {step === 2 && <StepRules rules={rules} updateRule={updateRule} />}
            {step === 3 && <StepSlots slotPolicies={slotPolicies} updateSlotPolicy={updateSlotPolicy} />}
            {step === 4 && <StepReview config={compiledConfig} />}
          </div>

          {/* Right panel — context */}
          <div className="hidden lg:col-span-2 lg:block">
            <RightPanel step={step} config={compiledConfig} regions={regions} />
          </div>
        </div>

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <Button
            variant="ghost"
            onClick={() => setStep(s => s - 1)}
            disabled={!canGoBack}
            className="gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>

          {canProceed ? (
            <Button onClick={() => setStep(s => s + 1)} className="gap-1.5">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Complete Setup
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Step Components ── */

function StepTemplate({
  timezone,
  setTimezone,
}: {
  timezone: string;
  setTimezone: (tz: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Choose your template</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We'll pre-configure slots and rules based on your operating model.
        </p>
      </div>

      <Card className="border-primary bg-primary/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Follow-the-Sun Support</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Multi-region coverage with hand-off slots across time zones. Ideal for 24/7
            support teams spanning Canada, Serbia, and India.
          </p>
          <Badge className="mt-3" variant="secondary">Selected</Badge>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Label>Service Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map(tz => (
              <SelectItem key={tz} value={tz}>
                <span className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {tz.replace(/_/g, ' ')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function StepRegions({
  regions,
  updateRegion,
}: {
  regions: Record<string, string>;
  updateRegion: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Regional operating model</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define each region's role in coverage.
        </p>
      </div>

      <div className="space-y-3">
        {Object.entries(regions).map(([key, value]) => (
          <Card key={key}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full ${REGION_COLORS[key]}`} />
                <span className="font-medium capitalize text-foreground">{key}</span>
              </div>
              <Select value={value} onValueChange={v => updateRegion(key, v)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGION_ROLES.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StepRules({
  rules,
  updateRule,
}: {
  rules: TeamProfileConfig['rules'];
  updateRule: <K extends keyof TeamProfileConfig['rules']>(
    key: K,
    value: TeamProfileConfig['rules'][K],
  ) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Planning rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set compliance and staffing constraints for the scheduler.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Minimum rest hours</Label>
          <Input
            type="number"
            min={0}
            value={rules.min_rest_hours}
            onChange={e => updateRule('min_rest_hours', Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Days off required (per month)</Label>
          <Input
            type="number"
            min={0}
            value={rules.days_off_required}
            onChange={e => updateRule('days_off_required', Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Minimum weekly hours</Label>
          <Input
            type="number"
            min={0}
            value={rules.min_weekly_hours_required}
            onChange={e => updateRule('min_weekly_hours_required', Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Overtime threshold hours</Label>
          <Input
            type="number"
            min={0}
            value={rules.overtime_threshold_hours}
            onChange={e => updateRule('overtime_threshold_hours', Number(e.target.value))}
          />
        </div>
        <Card className="flex items-center justify-between p-4">
          <Label className="cursor-pointer">Enforce senior per shift</Label>
          <Switch
            checked={rules.enforce_senior_per_shift}
            onCheckedChange={v => updateRule('enforce_senior_per_shift', v)}
          />
        </Card>
      </div>
    </div>
  );
}

function StepSlots({
  slotPolicies,
  updateSlotPolicy,
}: {
  slotPolicies: Record<string, SlotPolicy>;
  updateSlotPolicy: (slotKey: string, field: 'min_headcount' | 'max_headcount', value: number | undefined) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Staffing limits per slot</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set minimum and maximum headcount for each coverage slot. Leave max blank for no upper limit.
        </p>
      </div>

      <div className="space-y-3">
        {Object.entries(slotPolicies).map(([key, slot]) => (
          <Card key={key}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-medium text-foreground">{slot.coverage_label}</span>
                  <span className="ml-2 text-xs text-muted-foreground font-mono">{key}</span>
                </div>
                {slot.canonical && <Badge variant="secondary" className="text-xs">Canonical</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Min Staff Required</Label>
                  <Input
                    type="number"
                    min={0}
                    value={slot.min_headcount ?? 0}
                    onChange={e => {
                      const v = Math.max(0, parseInt(e.target.value) || 0);
                      updateSlotPolicy(key, 'min_headcount', v);
                      // Push max up if needed
                      if (slot.max_headcount !== undefined && slot.max_headcount < v) {
                        updateSlotPolicy(key, 'max_headcount', v);
                      }
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Max Staff Allowed</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="No limit"
                    value={slot.max_headcount ?? ''}
                    onChange={e => {
                      const raw = e.target.value;
                      if (raw === '') {
                        updateSlotPolicy(key, 'max_headcount', undefined);
                        return;
                      }
                      const v = Math.max(0, parseInt(raw) || 0);
                      const min = slot.min_headcount ?? 0;
                      updateSlotPolicy(key, 'max_headcount', v < min ? min : v);
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StepReview({ config }: { config: TeamProfileConfig }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Review your setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirm your team profile before saving.
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Template</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium text-foreground">Follow-the-Sun Support</p>
            <p className="text-sm text-muted-foreground">{config.service_timezone.replace(/_/g, ' ')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Regions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(config.answers.regions).map(([region, role]) => (
              <Badge key={region} variant="outline" className="capitalize">
                {region}: {role}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Rules</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Min rest:</span>{' '}
              <span className="font-medium text-foreground">{config.rules.min_rest_hours}h</span>
            </div>
            <div>
              <span className="text-muted-foreground">Days off:</span>{' '}
              <span className="font-medium text-foreground">{config.rules.days_off_required}/mo</span>
            </div>
            <div>
              <span className="text-muted-foreground">Min weekly hours:</span>{' '}
              <span className="font-medium text-foreground">{config.rules.min_weekly_hours_required}h</span>
            </div>
            <div>
              <span className="text-muted-foreground">Overtime starts:</span>{' '}
              <span className="font-medium text-foreground">{config.rules.overtime_threshold_hours}h</span>
            </div>
            <div>
              <span className="text-muted-foreground">Senior per shift:</span>{' '}
              <span className="font-medium text-foreground">
                {config.rules.enforce_senior_per_shift ? 'Yes' : 'No'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Coverage Slots ({Object.keys(config.slot_policies).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(config.slot_policies).map(([key, slot]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{key}</span>
                  <span className="text-foreground">{slot.coverage_label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {slot.min_headcount ?? 0}–{slot.max_headcount ?? '∞'}
                  </span>
                  {slot.canonical && <Badge variant="secondary" className="text-xs">Canonical</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Right Panel ── */

function RightPanel({
  step,
  config,
  regions,
}: {
  step: number;
  config: TeamProfileConfig;
  regions: Record<string, string>;
}) {
  return (
    <Card className="sticky top-24 border-border/50 bg-card/50">
      <CardContent className="p-5">
        {step === 0 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Coverage Model
            </p>
            <div className="space-y-2.5">
              {['Canada', 'Serbia', 'India'].map(r => (
                <div key={r} className="flex items-center gap-2 text-sm">
                  <div className={`h-2.5 w-2.5 rounded-full ${REGION_COLORS[r.toLowerCase()]}`} />
                  <span className="text-foreground">{r}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Three regions handing off coverage across 24 hours, with patch support
              for overnight gaps.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Region Assignments
            </p>
            {Object.entries(regions).map(([key, role]) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${REGION_COLORS[key]}`} />
                  <span className="text-sm font-medium capitalize text-foreground">{key}</span>
                </div>
                <Badge variant="outline" className="text-xs">{role}</Badge>
              </div>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active Rules
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rest between shifts</span>
                <span className="font-medium text-foreground">{config.rules.min_rest_hours}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Days off / month</span>
                <span className="font-medium text-foreground">{config.rules.days_off_required}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Min weekly hours</span>
                <span className="font-medium text-foreground">{config.rules.min_weekly_hours_required}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Overtime starts</span>
                <span className="font-medium text-foreground">{config.rules.overtime_threshold_hours}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Senior required</span>
                <span className="font-medium text-foreground">
                  {config.rules.enforce_senior_per_shift ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Staffing Summary
            </p>
            <div className="space-y-2 text-sm">
              {Object.entries(config.slot_policies).map(([key, slot]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground truncate mr-2">{slot.coverage_label}</span>
                  <span className="font-medium text-foreground whitespace-nowrap">
                    {slot.min_headcount ?? 0}–{slot.max_headcount ?? '∞'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Config Preview
            </p>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs text-foreground">
              {JSON.stringify(config, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
