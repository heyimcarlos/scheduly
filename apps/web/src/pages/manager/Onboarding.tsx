import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTemplates, SCRATCH_KEY } from '@/hooks/useTemplates';
import { useRegions } from '@/hooks/useRegions';
import { useTeamMembers } from '@/hooks/useSchedulerData';
import { useBulkUpsertTeamMembers } from '@/hooks/useSchedulerData';
import {
  buildTeamProfileConfig,
  DEFAULT_RULES,
  type TeamProfileConfig,
  type SlotPolicy,
} from '@/types/teamProfile';
import { REGISTRY, getRegionColor, type RegionMeta } from '@/types/scheduler';
import { type TeamMember } from '@/types/scheduler';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmployeeFormModal } from '@/components/employees/EmployeeFormModal';
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
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
} from 'lucide-react';
import logo from '@/assets/logo.png';

// ── Slot creation form types ───────────────────────────────────────────────

const SHIFT_TYPES = [
  { value: 'day', label: 'Day' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];

const COVERAGE_ROLES = [
  { value: 'canada_day', label: 'Canada Day' },
  { value: 'canada_evening', label: 'Canada Evening' },
  { value: 'serbia_hybrid', label: 'Serbia Hybrid' },
  { value: 'overnight_exception', label: 'Overnight Exception' },
  { value: 'fallback', label: 'Fallback' },
];

export interface SlotFormData {
  name: string;
  localStartTime: string; // "HH:mm"
  localEndTime: string;   // "HH:mm"
  shiftType: 'day' | 'evening' | 'night';
  coverageLabel: string;
  coverageRole: string;
  allowedRegions: string[];
  minHeadcount: number;
  maxHeadcount: number | undefined;
  canonical: boolean;
}

function makeDefaultSlotForm(): SlotFormData {
  return {
    name: '',
    localStartTime: '09:00',
    localEndTime: '17:00',
    shiftType: 'day',
    coverageLabel: '',
    coverageRole: 'canada_day',
    allowedRegions: [],
    minHeadcount: 1,
    maxHeadcount: undefined,
    canonical: true,
  };
}

const EMPTY_SLOT_FORM = makeDefaultSlotForm();

/** Full slot definition for scratch mode — includes both the slot metadata and its policy */
export interface ScratchSlot {
  name: string;
  localStartTime: string;
  localEndTime: string;
  shiftType: 'day' | 'evening' | 'night';
  coverageLabel: string;
  coverageRole: string;
  allowedRegions: string[];
  preferredRegions: string[];
  minHeadcount: number;
  maxHeadcount: number | undefined;
  canonical: boolean;
}

/** Convert a ScratchSlot to a SlotPolicy for the shared config format */
function scratchSlotToPolicy(slot: ScratchSlot): SlotPolicy {
  return {
    coverage_label: slot.coverageLabel,
    coverage_role: slot.coverageRole,
    allowed_regions: slot.allowedRegions.map(r => r.charAt(0).toUpperCase() + r.slice(1)), // capitalize
    preferred_regions: slot.preferredRegions.map(r => r.charAt(0).toUpperCase() + r.slice(1)),
    canonical: slot.canonical,
    min_headcount: slot.minHeadcount,
    max_headcount: slot.maxHeadcount,
  };
}

/** Convert SlotPolicy back to ScratchSlot (for editing) */
function policyToScratchSlot(key: string, policy: SlotPolicy, localStart = '09:00', localEnd = '17:00', shiftType: 'day' | 'evening' | 'night' = 'day'): ScratchSlot {
  return {
    name: policy.coverage_label || key,
    localStartTime: localStart,
    localEndTime: localEnd,
    shiftType,
    coverageLabel: policy.coverage_label,
    coverageRole: policy.coverage_role,
    allowedRegions: (policy.allowed_regions || []).map(r => r.toLowerCase()),
    preferredRegions: (policy.preferred_regions || []).map(r => r.toLowerCase()),
    minHeadcount: policy.min_headcount ?? 1,
    maxHeadcount: policy.max_headcount,
    canonical: policy.canonical ?? true,
  };
}
import { SCRATCH_KEY as S_KEY } from '@/hooks/useTemplates';

// ── Slot policy helpers ──────────────────────────────────────────────────────

interface AdaptedSlot {
  key: string;
  policy: SlotPolicy;
  isInvalid: boolean; // true when allowed_regions became empty
}

/** Strip a deselected region from a slot policy, returning adapted policy + invalid flag */
function adaptSlotPolicy(policy: SlotPolicy, deselectedRegion: string): SlotPolicy {
  const allowed = policy.allowed_regions?.filter(r => r !== deselectedRegion) ?? [];
  const preferred = policy.preferred_regions?.filter(r => r !== deselectedRegion) ?? [];
  const patch = policy.patch_regions?.filter(r => r !== deselectedRegion) ?? [];
  return {
    ...policy,
    allowed_regions: allowed,
    preferred_regions: preferred,
    patch_regions: patch.length > 0 ? patch : undefined,
  };
}

/** Check if a slot becomes invalid (no allowed regions left) after region deselection */
function isSlotInvalid(policy: SlotPolicy): boolean {
  return !policy.allowed_regions || policy.allowed_regions.length === 0;
}

/** Filter slot policies: remove slots that ONLY the deselected region covered */
function filterSlotsByDeselectedRegion(
  slots: Record<string, SlotPolicy>,
  deselectedRegion: string,
): Record<string, SlotPolicy> {
  const result: Record<string, SlotPolicy> = {};
  for (const [key, policy] of Object.entries(slots)) {
    const onlyDeselected =
      policy.allowed_regions?.length === 1 &&
      policy.allowed_regions[0] === deselectedRegion;
    if (onlyDeselected) continue; // drop this slot
    result[key] = adaptSlotPolicy(policy, deselectedRegion);
  }
  return result;
}

// ── Step definitions ────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Template', icon: Globe },
  { label: 'Regions', icon: MapPin },
  { label: 'Rules', icon: ShieldCheck },
  { label: 'Slots', icon: Users },
  { label: 'Team', icon: Users },
  { label: 'Review', icon: CheckCircle2 },
];

const TIMEZONES = [
  'America/Toronto', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'Europe/Belgrade', 'Europe/London', 'Asia/Kolkata', 'UTC',
];

const REGION_ROLES = [
  { value: 'primary', label: 'Primary' },
  { value: 'primary-opener', label: 'Primary Opener' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'patch-only', label: 'Patch Only' },
];

// ── Main component ──────────────────────────────────────────────────────────

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState('America/Toronto');

  // Onboarding mode
  const [mode, setMode] = useState<'template' | 'scratch'>('scratch');
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(SCRATCH_KEY);

  // Selected regions (region id → role)
  const [selectedRegions, setSelectedRegions] = useState<Record<string, string>>({});
  // Rules
  const [rules, setRules] = useState<TeamProfileConfig['rules']>({ ...DEFAULT_RULES });
  // Slot policies (key → SlotPolicy)
  const [slotPolicies, setSlotPolicies] = useState<Record<string, SlotPolicy>>({});
  // Scratch-mode slot definitions (key → full slot data including times/shift type)
  // Only used in scratch mode; template mode uses slotPolicies directly
  const [scratchSlots, setScratchSlots] = useState<Record<string, ScratchSlot>>({});
  // Slot creation/edit form state
  const [addingSlot, setAddingSlot] = useState(false);
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState<SlotFormData>(EMPTY_SLOT_FORM);
  // Team members being added during onboarding
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  // Employee modal state
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: templates = [] } = useTemplates();
  const { data: availableRegions = [] } = useRegions();
  const { data: existingMembers = [] } = useTeamMembers();
  const bulkUpsertMembers = useBulkUpsertTeamMembers();

  // ── Derived helpers ──────────────────────────────────────────────────────

  /** Get the currently selected template object */
  const selectedTemplate = templates.find(t => t.key === selectedTemplateKey) ?? null;

  /** Region options for EmployeeFormModal: only selected regions */
  const memberRegionOptions = availableRegions
    .filter(r => selectedRegions[r.id] !== undefined)
    .map(r => ({ value: r.id, label: r.name }));

  /** Timezone options for EmployeeFormModal: predefined list */
  const memberTimezoneOptions = [
    { value: 'UTC', label: 'UTC' },
    { value: 'America/Toronto', label: 'Canada (Toronto)' },
    { value: 'Asia/Kolkata', label: 'India (Kolkata)' },
    { value: 'Europe/Belgrade', label: 'Serbia (Belgrade)' },
  ];

  /** Map from region id → RegionMeta for selected regions */
  const selectedRegionMeta = availableRegions.filter(r => selectedRegions[r.id] !== undefined);

  // ── Template selection handler ────────────────────────────────────────────

  const handleSelectTemplate = useCallback((key: string) => {
    setSelectedTemplateKey(key);
    const isScratch = key === S_KEY;
    setMode(isScratch ? 'scratch' : 'template');

    if (isScratch) {
      setSelectedRegions({});
      setSlotPolicies({});
      setScratchSlots({});
      setRules({ ...DEFAULT_RULES });
    } else {
      const tmpl = templates.find(t => t.key === key);
      if (tmpl) {
        const regionInit: Record<string, string> = {};
        for (const rid of tmpl.defaultRegions) {
          regionInit[rid] = 'primary';
        }
        setSelectedRegions(regionInit);
        setSlotPolicies(JSON.parse(JSON.stringify(tmpl.slotPolicies)));
        if (tmpl.rules) {
          setRules({ ...tmpl.rules });
        }
      }
    }
  }, [templates]);

  // ── Region toggle ─────────────────────────────────────────────────────────

  const handleToggleRegion = useCallback((regionId: string, enabled: boolean) => {
    setSelectedRegions(prev => {
      if (enabled) {
        return { ...prev, [regionId]: 'primary' };
      } else {
        const next = { ...prev };
        delete next[regionId];

        // Filter scratch slots: remove region from allowed_regions; drop slot if no regions left
        setScratchSlots(prevScratch => {
          const adapted: Record<string, ScratchSlot> = {};
          for (const [k, slot] of Object.entries(prevScratch)) {
            const allowed = slot.allowedRegions.filter(r => r !== regionId);
            if (allowed.length === 0) continue; // drop slot
            adapted[k] = { ...slot, allowedRegions: allowed };
          }
          return adapted;
        });

        // Adapt slot policies for template mode
        const adaptedSlots = filterSlotsByDeselectedRegion(slotPolicies, regionId);
        setSlotPolicies(adaptedSlots);
        return next;
      }
    });
  }, [slotPolicies]);

  const handleRegionRoleChange = useCallback((regionId: string, role: string) => {
    setSelectedRegions(prev => ({ ...prev, [regionId]: role }));
  }, []);

  // ── Slot policy updates ───────────────────────────────────────────────────

  const updateSlotPolicy = useCallback((
    slotKey: string,
    field: 'min_headcount' | 'max_headcount',
    value: number | undefined,
  ) => {
    setSlotPolicies(prev => ({
      ...prev,
      [slotKey]: { ...prev[slotKey], [field]: value },
    }));
  }, []);

  // ── Scratch-mode slot handlers ───────────────────────────────────────────

  const handleAddSlot = useCallback(() => {
    setSlotForm(makeDefaultSlotForm());
    setAddingSlot(true);
    setEditingSlotKey(null);
  }, []);

  const handleEditSlot = useCallback((key: string) => {
    const slot = scratchSlots[key];
    if (!slot) return;
    setSlotForm({
      name: slot.name,
      localStartTime: slot.localStartTime,
      localEndTime: slot.localEndTime,
      shiftType: slot.shiftType,
      coverageLabel: slot.coverageLabel,
      coverageRole: slot.coverageRole,
      allowedRegions: slot.allowedRegions,
      minHeadcount: slot.minHeadcount,
      maxHeadcount: slot.maxHeadcount,
      canonical: slot.canonical,
    });
    setEditingSlotKey(key);
    setAddingSlot(false);
  }, [scratchSlots]);

  const handleDeleteSlot = useCallback((key: string) => {
    setScratchSlots(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // Also remove from slotPolicies
    setSlotPolicies(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleSaveSlot = useCallback(() => {
    if (!slotForm.name || !slotForm.coverageLabel) return;
    const key = slotForm.name.replace(/\s+/g, '') + Date.now().toString(36);
    const newSlot: ScratchSlot = {
      name: slotForm.name,
      localStartTime: slotForm.localStartTime,
      localEndTime: slotForm.localEndTime,
      shiftType: slotForm.shiftType,
      coverageLabel: slotForm.coverageLabel,
      coverageRole: slotForm.coverageRole,
      allowedRegions: slotForm.allowedRegions,
      preferredRegions: slotForm.allowedRegions.slice(0, 1),
      minHeadcount: slotForm.minHeadcount,
      maxHeadcount: slotForm.maxHeadcount,
      canonical: slotForm.canonical,
    };
    setScratchSlots(prev => ({ ...prev, [key]: newSlot }));
    setSlotPolicies(prev => ({ ...prev, [key]: scratchSlotToPolicy(newSlot) }));
    setAddingSlot(false);
    setEditingSlotKey(null);
    setSlotForm(EMPTY_SLOT_FORM);
  }, [slotForm]);

  const handleCancelSlotForm = useCallback(() => {
    setAddingSlot(false);
    setEditingSlotKey(null);
    setSlotForm(EMPTY_SLOT_FORM);
  }, []);

  const updateSlotForm = useCallback(<K extends keyof SlotFormData>(field: K, value: SlotFormData[K]) => {
    setSlotForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Team member handlers ──────────────────────────────────────────────────

  const handleAddMember = useCallback(() => {
    setEditingMember(null);
    setMemberModalOpen(true);
  }, []);

  const handleEditMember = useCallback((member: TeamMember) => {
    setEditingMember(member);
    setMemberModalOpen(true);
  }, []);

  const handleDeleteMember = useCallback((id: string) => {
    setTeamMembers(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleSaveMember = useCallback((member: TeamMember) => {
    setTeamMembers(prev => {
      const idx = prev.findIndex(m => m.id === member.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = member;
        return next;
      }
      return [...prev, member];
    });
    setMemberModalOpen(false);
  }, []);

  // ── All members (existing + newly added during onboarding) ─────────────────

  const allMembers = [...existingMembers, ...teamMembers];

  // ── Build config for review ───────────────────────────────────────────────

  const compiledConfig = buildTeamProfileConfig(
    timezone,
    rules,
    selectedRegions,
    slotPolicies,
  );

  // ── Adapted slots for display (with invalid flag) ─────────────────────────

  const adaptedSlots: AdaptedSlot[] = Object.entries(slotPolicies).map(([key, policy]) => ({
    key,
    policy,
    isInvalid: isSlotInvalid(policy),
  }));

  // ── Step navigation ───────────────────────────────────────────────────────

  const canProceed = step < STEPS.length - 1;
  const canGoBack = step > 0;

  const handleContinue = () => {
    setStep(s => s + 1);
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // 1. Save team profile
      const { data: newProfile, error: insertErr } = await supabase
        .from('team_profiles')
        .insert({
          owner_user_id: user.id,
          name: 'Primary Team Profile',
          template_key: selectedTemplateKey,
          config: JSON.parse(JSON.stringify(compiledConfig)),
          is_active: true,
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      // 2. Mark onboarding complete
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          active_team_profile_id: newProfile.id,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateErr) throw updateErr;

      // 3. Deactivate old profiles
      const { error: deactivateErr } = await supabase
        .from('team_profiles')
        .update({ is_active: false })
        .eq('owner_user_id', user.id)
        .neq('id', newProfile.id);

      if (deactivateErr) throw deactivateErr;

      // 4. Save newly added team members (fire-and-forget)
      if (teamMembers.length > 0) {
        bulkUpsertMembers.mutate(teamMembers, {
          onError: (err) => {
            console.error('Failed to save team members:', err);
          },
        });
      }

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

  // ── Render ─────────────────────────────────────────────────────────────────

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
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-primary' : 'bg-muted'
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
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${i <= step ? 'text-primary' : 'text-muted-foreground'
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
            {step === 0 && (
              <StepTemplate
                timezone={timezone}
                setTimezone={setTimezone}
                selectedTemplateKey={selectedTemplateKey}
                onSelectTemplate={handleSelectTemplate}
                templates={templates}
              />
            )}
            {step === 1 && (
              <StepRegions
                mode={mode}
                availableRegions={availableRegions}
                selectedRegions={selectedRegions}
                onToggleRegion={handleToggleRegion}
                onRegionRoleChange={handleRegionRoleChange}
              />
            )}
            {step === 2 && (
              <StepRules rules={rules} onUpdateRule={setRules} />
            )}
            {step === 3 && (
              <StepSlots
                mode={mode}
                slots={adaptedSlots}
                addingSlot={addingSlot}
                editingSlotKey={editingSlotKey}
                slotForm={slotForm}
                selectedRegionIds={Object.keys(selectedRegions)}
                onAddSlot={handleAddSlot}
                onEditSlot={handleEditSlot}
                onDeleteSlot={handleDeleteSlot}
                onUpdateSlotForm={updateSlotForm}
                onSaveSlot={handleSaveSlot}
                onCancelSlotForm={handleCancelSlotForm}
                onUpdateSlotPolicy={updateSlotPolicy}
              />
            )}
            {step === 4 && (
              <StepTeamMembers
                members={allMembers}
                regionOptions={memberRegionOptions}
                timezoneOptions={memberTimezoneOptions}
                onAdd={handleAddMember}
                onEdit={handleEditMember}
                onDelete={handleDeleteMember}
              />
            )}
            {step === 5 && (
              <StepReview
                config={compiledConfig}
                selectedTemplate={selectedTemplate}
                regionMetas={selectedRegionMeta}
                memberCount={allMembers.length}
              />
            )}
          </div>

          {/* Right panel — context */}
          <div className="hidden lg:col-span-2 lg:block">
            <RightPanel
              step={step}
              config={compiledConfig}
              selectedRegions={selectedRegions}
              regionMetas={selectedRegionMeta}
              slots={adaptedSlots}
              memberCount={allMembers.length}
            />
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
            <Button onClick={handleContinue} className="gap-1.5">
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

      {/* Employee form modal */}
      <EmployeeFormModal
        open={memberModalOpen}
        onOpenChange={setMemberModalOpen}
        employee={editingMember}
        onSave={handleSaveMember}
        regionOptions={memberRegionOptions}
        timezoneOptions={memberTimezoneOptions}
        defaultRegion={memberRegionOptions[0]?.value}
        defaultTimezone={memberTimezoneOptions[0]?.value}
      />
    </div>
  );
}

// ── Step Components ─────────────────────────────────────────────────────────

function StepTemplate({
  timezone,
  setTimezone,
  selectedTemplateKey,
  onSelectTemplate,
  templates,
}: {
  timezone: string;
  setTimezone: (tz: string) => void;
  selectedTemplateKey: string | null;
  onSelectTemplate: (key: string) => void;
  templates: Array<{ key: string; name: string; description: string; defaultRegions: string[] }>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Choose your template</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We'll pre-configure slots and rules based on your operating model.
        </p>
      </div>

      <div className="grid gap-3">
        {templates.map(t => {
          const isSelected = selectedTemplateKey === t.key;
          return (
            <Card
              key={t.key}
              className={`cursor-pointer transition-all ${isSelected ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
              onClick={() => onSelectTemplate(t.key)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">{t.name}</CardTitle>
                  </div>
                  {isSelected && <Badge variant="secondary">Selected</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t.description}</p>
                {t.defaultRegions.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t.defaultRegions.length} region{t.defaultRegions.length !== 1 ? 's' : ''}
                    {t.defaultRegions.length > 0 && ` · ${t.defaultRegions.join(', ')}`}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

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
  mode,
  availableRegions,
  selectedRegions,
  onToggleRegion,
  onRegionRoleChange,
}: {
  mode: 'template' | 'scratch';
  availableRegions: RegionMeta[];
  selectedRegions: Record<string, string>;
  onToggleRegion: (id: string, enabled: boolean) => void;
  onRegionRoleChange: (id: string, role: string) => void;
}) {
  const isTemplateMode = mode === 'template';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Regional operating model</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isTemplateMode
            ? 'Select the regions your team operates in. Deselect regions you do not use.'
            : 'Add regions where your team members are located.'}
        </p>
      </div>

      {isTemplateMode ? (
        // Template mode: toggle chips
        <div className="space-y-3">
          {availableRegions.map(region => {
            const isEnabled = selectedRegions[region.id] !== undefined;
            return (
              <Card key={region.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={isEnabled}
                      onCheckedChange={checked => onToggleRegion(region.id, checked)}
                    />
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: region.color }}
                    />
                    <span className="font-medium text-foreground">{region.name}</span>
                  </div>
                  {isEnabled && (
                    <Select
                      value={selectedRegions[region.id]}
                      onValueChange={v => onRegionRoleChange(region.id, v)}
                    >
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
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        // Scratch mode: all regions available to add
        <div className="space-y-3">
          {availableRegions.map(region => {
            const isAdded = selectedRegions[region.id] !== undefined;
            return (
              <Card key={region.id} className={isAdded ? 'border-primary/50' : 'opacity-60'}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: region.color }}
                    />
                    <span className="font-medium text-foreground">{region.name}</span>
                    <Badge variant="outline" className="text-xs">{region.timezone}</Badge>
                  </div>
                  {!isAdded ? (
                    <Button size="sm" variant="outline" onClick={() => onToggleRegion(region.id, true)}>
                      <Plus className="h-4 w-4 mr-1" /> Add
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => onToggleRegion(region.id, false)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
                {isAdded && (
                  <CardContent className="pt-0 pb-4">
                    <Select
                      value={selectedRegions[region.id]}
                      onValueChange={v => onRegionRoleChange(region.id, v)}
                    >
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
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepRules({
  rules,
  onUpdateRule,
}: {
  rules: TeamProfileConfig['rules'];
  onUpdateRule: (r: TeamProfileConfig['rules']) => void;
}) {
  const update = <K extends keyof TeamProfileConfig['rules']>(
    key: K,
    value: TeamProfileConfig['rules'][K],
  ) => onUpdateRule({ ...rules, [key]: value });

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
            onChange={e => update('min_rest_hours', Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Days off required (per month)</Label>
          <Input
            type="number"
            min={0}
            value={rules.days_off_required}
            onChange={e => update('days_off_required', Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Minimum weekly hours</Label>
          <Input
            type="number"
            min={0}
            value={rules.min_weekly_hours_required}
            onChange={e => update('min_weekly_hours_required', Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Overtime threshold hours</Label>
          <Input
            type="number"
            min={0}
            value={rules.overtime_threshold_hours}
            onChange={e => update('overtime_threshold_hours', Number(e.target.value))}
          />
        </div>
        <Card className="flex items-center justify-between p-4">
          <Label className="cursor-pointer">Enforce senior per shift</Label>
          <Switch
            checked={rules.enforce_senior_per_shift}
            onCheckedChange={v => update('enforce_senior_per_shift', v)}
          />
        </Card>
      </div>
    </div>
  );
}

function StepSlots({
  mode,
  slots,
  addingSlot,
  editingSlotKey,
  slotForm,
  selectedRegionIds,
  onAddSlot,
  onEditSlot,
  onDeleteSlot,
  onUpdateSlotForm,
  onSaveSlot,
  onCancelSlotForm,
  onUpdateSlotPolicy,
}: {
  mode: 'template' | 'scratch';
  slots: AdaptedSlot[];
  addingSlot: boolean;
  editingSlotKey: string | null;
  slotForm: SlotFormData;
  selectedRegionIds: string[];
  onAddSlot: () => void;
  onEditSlot: (key: string) => void;
  onDeleteSlot: (key: string) => void;
  onUpdateSlotForm: <K extends keyof SlotFormData>(field: K, value: SlotFormData[K]) => void;
  onSaveSlot: () => void;
  onCancelSlotForm: () => void;
  onUpdateSlotPolicy: (key: string, field: 'min_headcount' | 'max_headcount', value: number | undefined) => void;
}) {
  const isScratch = mode === 'scratch';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Coverage slots</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isScratch
              ? 'Define your shift slots and coverage policies.'
              : 'Review and adjust headcount per slot. Invalid slots (no allowed regions) are marked with a warning.'}
          </p>
        </div>
        {isScratch && (
          <Button size="sm" onClick={onAddSlot} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Slot
          </Button>
        )}
      </div>

      {/* ── Inline slot creation / edit form ── */}
      {(addingSlot || editingSlotKey) && (
        <Card className="border-primary/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {editingSlotKey ? 'Edit Slot' : 'New Shift Slot'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Slot Name *</Label>
                <Input
                  placeholder="e.g. Morning Core"
                  value={slotForm.name}
                  onChange={e => onUpdateSlotForm('name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Coverage Label *</Label>
                <Input
                  placeholder="e.g. Canada Day Core"
                  value={slotForm.coverageLabel}
                  onChange={e => onUpdateSlotForm('coverageLabel', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Local Start</Label>
                <Input
                  type="time"
                  value={slotForm.localStartTime}
                  onChange={e => onUpdateSlotForm('localStartTime', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Local End</Label>
                <Input
                  type="time"
                  value={slotForm.localEndTime}
                  onChange={e => onUpdateSlotForm('localEndTime', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Shift Type</Label>
                <Select value={slotForm.shiftType} onValueChange={v => onUpdateSlotForm('shiftType', v as SlotFormData['shiftType'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SHIFT_TYPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Coverage Role</Label>
                <Select value={slotForm.coverageRole} onValueChange={v => onUpdateSlotForm('coverageRole', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COVERAGE_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Min Headcount</Label>
                <Input
                  type="number"
                  min={0}
                  value={slotForm.minHeadcount}
                  onChange={e => onUpdateSlotForm('minHeadcount', Math.max(0, parseInt(e.target.value) || 0))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max Headcount</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="No limit"
                  value={slotForm.maxHeadcount ?? ''}
                  onChange={e => {
                    const raw = e.target.value;
                    onUpdateSlotForm('maxHeadcount', raw === '' ? undefined : Math.max(0, parseInt(raw) || 0));
                  }}
                />
              </div>
            </div>

            {selectedRegionIds.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Allowed Regions</Label>
                <div className="flex flex-wrap gap-2">
                  {selectedRegionIds.map(rid => {
                    const isSelected = slotForm.allowedRegions.includes(rid);
                    return (
                      <button
                        key={rid}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            onUpdateSlotForm('allowedRegions', slotForm.allowedRegions.filter(r => r !== rid));
                          } else {
                            onUpdateSlotForm('allowedRegions', [...slotForm.allowedRegions, rid]);
                          }
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-secondary text-foreground border-border hover:border-primary/50'
                        }`}
                      >
                        {rid.charAt(0).toUpperCase() + rid.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="canonical-toggle"
                  checked={slotForm.canonical}
                  onCheckedChange={v => onUpdateSlotForm('canonical', v)}
                />
                <Label htmlFor="canonical-toggle" className="text-xs cursor-pointer">Canonical (required coverage)</Label>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                onClick={onSaveSlot}
                disabled={!slotForm.name || !slotForm.coverageLabel}
              >
                {editingSlotKey ? 'Save Changes' : 'Add Slot'}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelSlotForm}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Slot list ── */}
      {slots.length === 0 && !addingSlot && !editingSlotKey ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-4">No coverage slots yet.</p>
            {isScratch && selectedRegionIds.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Add regions in the previous step first.
              </p>
            )}
            {isScratch && selectedRegionIds.length > 0 && (
              <Button variant="outline" onClick={onAddSlot} className="gap-1.5">
                <Plus className="h-4 w-4" /> Add your first shift slot
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {slots.map(({ key, policy, isInvalid }) => (
            <Card key={key} className={isInvalid ? 'border-destructive/50' : undefined}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{policy.coverage_label}</span>
                    <span className="text-xs text-muted-foreground font-mono">{key}</span>
                    {isInvalid && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Invalid
                      </Badge>
                    )}
                    {policy.canonical && !isInvalid && (
                      <Badge variant="secondary" className="text-xs">Canonical</Badge>
                    )}
                  </div>
                  {isScratch && (
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEditSlot(key)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDeleteSlot(key)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {policy.allowed_regions && policy.allowed_regions.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Allowed: {policy.allowed_regions.join(', ')}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Min Staff</Label>
                    <Input
                      type="number"
                      min={0}
                      value={policy.min_headcount ?? 0}
                      onChange={e => {
                        const v = Math.max(0, parseInt(e.target.value) || 0);
                        onUpdateSlotPolicy(key, 'min_headcount', v);
                        if (policy.max_headcount !== undefined && policy.max_headcount < v) {
                          onUpdateSlotPolicy(key, 'max_headcount', v);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Max Staff</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="No limit"
                      value={policy.max_headcount ?? ''}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') {
                          onUpdateSlotPolicy(key, 'max_headcount', undefined);
                          return;
                        }
                        const v = Math.max(0, parseInt(raw) || 0);
                        const min = policy.min_headcount ?? 0;
                        onUpdateSlotPolicy(key, 'max_headcount', v < min ? min : v);
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StepTeamMembers({
  members,
  regionOptions,
  timezoneOptions,
  onAdd,
  onEdit,
  onDelete,
}: {
  members: TeamMember[];
  regionOptions: Array<{ value: string; label: string }>;
  timezoneOptions: Array<{ value: string; label: string }>;
  onAdd: () => void;
  onEdit: (m: TeamMember) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add employees to your team. You can also do this later from the Employees page.
          </p>
        </div>
        {regionOptions.length > 0 && (
          <Button onClick={onAdd} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Employee
          </Button>
        )}
      </div>

      {regionOptions.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Add at least one region in the previous step before adding team members.
          </CardContent>
        </Card>
      )}

      {members.length > 0 && (
        <div className="space-y-2">
          {members.map(member => (
            <Card key={member.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {member.initials}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.role} · {member.region}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="ghost" onClick={() => onEdit(member)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => onDelete(member.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {members.length === 0 && regionOptions.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-4">No team members added yet.</p>
            <Button variant="outline" onClick={onAdd} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add your first employee
            </Button>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        You can skip this step and add employees later from the Employees page.
      </p>
    </div>
  );
}

function StepReview({
  config,
  selectedTemplate,
  regionMetas,
  memberCount,
}: {
  config: TeamProfileConfig;
  selectedTemplate: { name: string } | null;
  regionMetas: RegionMeta[];
  memberCount: number;
}) {
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
            <p className="font-medium text-foreground">
              {selectedTemplate?.name ?? 'Custom'}
            </p>
            <p className="text-sm text-muted-foreground">
              {config.service_timezone.replace(/_/g, ' ')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Regions ({regionMetas.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {regionMetas.map(meta => (
              <Badge key={meta.id} variant="outline">
                {meta.name}: {config.answers.regions[meta.id] ?? '—'}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium text-foreground">
              {memberCount} employee{memberCount !== 1 ? 's' : ''} will be added
            </p>
            <p className="text-sm text-muted-foreground">
              You can add more later from the Employees page.
            </p>
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

// ── Right Panel ─────────────────────────────────────────────────────────────

function RightPanel({
  step,
  config,
  selectedRegions,
  regionMetas,
  slots,
  memberCount,
}: {
  step: number;
  config: TeamProfileConfig;
  selectedRegions: Record<string, string>;
  regionMetas: RegionMeta[];
  slots: AdaptedSlot[];
  memberCount: number;
}) {
  return (
    <Card className="sticky top-24 border-border/50 bg-card/50">
      <CardContent className="p-5">
        {step === 0 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Coverage Model
            </p>
            <p className="text-xs text-muted-foreground">
              Select a template above to pre-configure your team setup, or start from scratch.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Selected Regions
            </p>
            {regionMetas.length === 0 ? (
              <p className="text-xs text-muted-foreground">No regions selected.</p>
            ) : (
              regionMetas.map(meta => (
                <div key={meta.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="text-sm font-medium text-foreground">{meta.name}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {selectedRegions[meta.id]}
                  </Badge>
                </div>
              ))
            )}
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
            {slots.length === 0 ? (
              <p className="text-xs text-muted-foreground">No slots defined.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {slots.map(({ key, policy, isInvalid }) => (
                  <div key={key} className="flex justify-between">
                    <span className={`text-muted-foreground truncate mr-2 ${isInvalid ? 'line-through' : ''}`}>
                      {policy.coverage_label}
                    </span>
                    <span className={`font-medium whitespace-nowrap ${isInvalid ? 'text-destructive' : 'text-foreground'}`}>
                      {policy.min_headcount ?? 0}–{policy.max_headcount ?? '∞'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Team Members
            </p>
            <p className="text-sm text-foreground font-medium">{memberCount} added</p>
            <p className="text-xs text-muted-foreground">
              Employees can be managed from the Employees page after onboarding.
            </p>
          </div>
        )}

        {step === 5 && (
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
