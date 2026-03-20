import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shift, TeamMember, ShiftType, Timezone } from '@/types/scheduler';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Trash2 } from 'lucide-react';

export interface ShiftFormData {
  memberId: string;
  date: string;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  title: string;
}

interface ShiftFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMembers: TeamMember[];
  selectedTimezone: Timezone;
  editingShift?: Shift | null;
  defaultDate?: Date;
  defaultHour?: number;
  onSave: (data: ShiftFormData, shiftId?: string) => void;
  onDelete?: (shiftId: string) => void;
}

const SHIFT_TYPES: { value: ShiftType; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'sick', label: 'Sick Leave' },
  { value: 'vacation', label: 'Vacation' },
  { value: 'absent', label: 'Absent' },
];

export function ShiftFormModal({
  open,
  onOpenChange,
  teamMembers,
  selectedTimezone,
  editingShift,
  defaultDate,
  defaultHour,
  onSave,
  onDelete,
}: ShiftFormModalProps) {
  const [memberId, setMemberId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [shiftType, setShiftType] = useState<ShiftType>('regular');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (editingShift) {
      setMemberId(editingShift.memberId);
      setDate(formatInTimeZone(editingShift.startTime, selectedTimezone, 'yyyy-MM-dd'));
      setStartTime(formatInTimeZone(editingShift.startTime, selectedTimezone, 'HH:mm'));
      setEndTime(formatInTimeZone(editingShift.endTime, selectedTimezone, 'HH:mm'));
      setShiftType(editingShift.shiftType);
      setTitle(editingShift.title ?? '');
    } else {
      setMemberId(teamMembers[0]?.id ?? '');
      setDate(defaultDate ? format(defaultDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
      const hour = defaultHour ?? 8;
      setStartTime(`${String(hour).padStart(2, '0')}:00`);
      setEndTime(`${String(Math.min(hour + 8, 23)).padStart(2, '0')}:00`);
      setShiftType('regular');
      setTitle('');
    }
  }, [editingShift, defaultDate, defaultHour, teamMembers, open, selectedTimezone]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ memberId, date, startTime, endTime, shiftType, title }, editingShift?.id);
    onOpenChange(false);
  };

  const isEditing = !!editingShift;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Shift' : 'Create Shift'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Modify shift details below.' : 'Fill in the details for the new shift.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="member">Team Member</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger id="member"><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>
                {teamMembers.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.name} ({m.region})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start">Start Time</Label>
              <Input id="start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End Time</Label>
              <Input id="end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Shift Type</Label>
            <Select value={shiftType} onValueChange={v => setShiftType(v as ShiftType)}>
              <SelectTrigger id="type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SHIFT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title (optional)</Label>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Morning Support" />
          </div>

          <DialogFooter className="flex justify-between sm:justify-between">
            {isEditing && onDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => { onDelete(editingShift!.id); onOpenChange(false); }}
                className="gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={!memberId || !date}>
                {isEditing ? 'Update' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
