import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TeamMember, Region, Timezone, SeniorityLevel, ContractType, REGISTRY } from '@/types/scheduler';
import { useToast } from '@/hooks/use-toast';

// --- Static defaults for backward compatibility with /employees page ---
const DEFAULT_REGION_OPTIONS = Object.values(REGISTRY).map(r => ({ value: r.id, label: r.name }));
const DEFAULT_TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Toronto', label: 'Canada (Toronto)' },
  { value: 'Asia/Kolkata', label: 'India (Kolkata)' },
  { value: 'Europe/Belgrade', label: 'Serbia (Belgrade)' },
];
const DEFAULT_REGION = 'canada';
const DEFAULT_TIMEZONE = 'America/Toronto';

interface EmployeeFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: TeamMember | null;
  onSave: (employee: TeamMember) => void;
  /** Dynamic region options — omit to use predefined static list */
  regionOptions?: Array<{ value: string; label: string }>;
  /** Dynamic timezone options — omit to use predefined static list */
  timezoneOptions?: Array<{ value: string; label: string }>;
  /** Pre-selected region when creating a new employee */
  defaultRegion?: string;
  /** Pre-selected timezone when creating a new employee */
  defaultTimezone?: string;
}

const emptyForm = {
  name: '',
  initials: '',
  email: '',
  role: '',
  region: DEFAULT_REGION as Region,
  timezone: DEFAULT_TIMEZONE as Timezone,
  seniority: 'junior' as SeniorityLevel,
  contractType: 'full-time' as ContractType,
  maxHours: 40,
  skills: '',
};

export function EmployeeFormModal({
  open,
  onOpenChange,
  employee,
  onSave,
  regionOptions = DEFAULT_REGION_OPTIONS,
  timezoneOptions = DEFAULT_TIMEZONE_OPTIONS,
  defaultRegion = DEFAULT_REGION,
  defaultTimezone = DEFAULT_TIMEZONE,
}: EmployeeFormModalProps) {
  const { toast } = useToast();
  const isEdit = !!employee;

  const defaultForm = {
    ...emptyForm,
    region: (defaultRegion || DEFAULT_REGION) as Region,
    timezone: (defaultTimezone || DEFAULT_TIMEZONE) as Timezone,
  };

  const [form, setForm] = useState(defaultForm);

  useEffect(() => {
    if (employee) {
      setForm({
        name: employee.name,
        initials: employee.initials,
        email: employee.email || '',
        role: employee.role,
        region: employee.region,
        timezone: employee.timezone,
        seniority: employee.seniority,
        contractType: employee.contractType,
        maxHours: employee.maxHours,
        skills: employee.skills.join(', '),
      });
    } else {
      setForm({
        ...defaultForm,
        region: (defaultRegion || DEFAULT_REGION) as Region,
        timezone: (defaultTimezone || DEFAULT_TIMEZONE) as Timezone,
      });
    }
  }, [employee, open, defaultRegion, defaultTimezone]);

  const handleSubmit = () => {
    if (!form.name || !form.initials || !form.role) {
      toast({ title: 'Validation Error', description: 'Name, Initials, and Role are required.', variant: 'destructive' });
      return;
    }

    const saved: TeamMember = {
      id: employee?.id || crypto.randomUUID(),
      name: form.name,
      initials: form.initials,
      email: form.email || undefined,
      role: form.role,
      region: form.region,
      timezone: form.timezone,
      seniority: form.seniority,
      contractType: form.contractType,
      maxHours: form.maxHours,
      skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
      fatigueScore: employee?.fatigueScore ?? 0,
      weeklyHours: employee?.weeklyHours ?? 0,
    };

    onSave(saved);
    onOpenChange(false);
    toast({ title: isEdit ? 'Employee Updated' : 'Employee Created', description: `${saved.name} has been ${isEdit ? 'updated' : 'added'}.` });
  };

  const set = (key: string, value: string | number) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">{isEdit ? 'Edit Employee' : 'Create Employee'}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit ? 'Update the employee details below.' : 'Fill in the details for the new employee.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name *</Label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} className="h-8 text-sm bg-secondary border-border" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Initials *</Label>
            <Input value={form.initials} onChange={e => set('initials', e.target.value.toUpperCase())} maxLength={3} className="h-8 text-sm bg-secondary border-border" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <Input value={form.email} onChange={e => set('email', e.target.value)} type="email" className="h-8 text-sm bg-secondary border-border" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Role *</Label>
            <Input value={form.role} onChange={e => set('role', e.target.value)} className="h-8 text-sm bg-secondary border-border" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Region</Label>
            <Select value={form.region} onValueChange={v => set('region', v)}>
              <SelectTrigger className="h-8 text-sm bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                {regionOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Timezone</Label>
            <Select value={form.timezone} onValueChange={v => set('timezone', v)}>
              <SelectTrigger className="h-8 text-sm bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                {timezoneOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Seniority</Label>
            <Select value={form.seniority} onValueChange={v => set('seniority', v)}>
              <SelectTrigger className="h-8 text-sm bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="senior">Senior</SelectItem>
                <SelectItem value="junior">Junior</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Contract Type</Label>
            <Select value={form.contractType} onValueChange={v => set('contractType', v)}>
              <SelectTrigger className="h-8 text-sm bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full-time">Full-Time</SelectItem>
                <SelectItem value="part-time">Part-Time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max Hours/Week</Label>
            <Input type="number" value={form.maxHours} onChange={e => set('maxHours', Number(e.target.value))} className="h-8 text-sm bg-secondary border-border" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Skills (comma-separated)</Label>
            <Input value={form.skills} onChange={e => set('skills', e.target.value)} placeholder="e.g. SIEM, Forensics" className="h-8 text-sm bg-secondary border-border" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-8 text-sm">Cancel</Button>
          <Button onClick={handleSubmit} className="h-8 text-sm">{isEdit ? 'Save Changes' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
