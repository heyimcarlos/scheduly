import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Check, X, Clock, CalendarOff, ArrowLeftRight, AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  rejected: 'bg-destructive/15 text-destructive border-destructive/30',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  vacation: <CalendarOff className="h-4 w-4" />,
  sick_leave: <AlertCircle className="h-4 w-4" />,
  personal: <Clock className="h-4 w-4" />,
  shift_swap: <ArrowLeftRight className="h-4 w-4" />,
  partial_availability: <Clock className="h-4 w-4" />,
};

interface ConflictingShift {
  id: string;
  start_time: string;
  end_time: string;
  title: string | null;
}

interface ConfirmDialogState {
  open: boolean;
  request: any | null;
  conflictingShifts: ConflictingShift[];
  loading: boolean;
}

export default function ManagerRequests() {
  const queryClient = useQueryClient();
  const [managerNotes, setManagerNotes] = useState<Record<string, string>>({});
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    request: null,
    conflictingShifts: [],
    loading: false,
  });

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['manager-time-off-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('*, team_members!time_off_requests_team_member_id_fkey(name, initials)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const { error } = await supabase
        .from('time_off_requests')
        .update({ status, manager_notes: notes || null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['manager-time-off-requests'] });
      queryClient.invalidateQueries({ queryKey: ['pending-requests-count'] });
      queryClient.invalidateQueries({ queryKey: ['approved-time-off'] });
      toast({ title: variables.status === 'approved' ? 'Request approved' : 'Request updated' });
    },
  });

  const handleApproveClick = async (req: any) => {
    // Check for conflicting shifts before approving
    const startDate = new Date(req.start_date + 'T00:00:00');
    const endDate = new Date(req.end_date + 'T23:59:59');

    setConfirmDialog({ open: false, request: req, conflictingShifts: [], loading: true });

    const { data: conflicts } = await supabase
      .from('shifts')
      .select('id, start_time, end_time, title')
      .eq('member_id', req.team_member_id)
      .gte('start_time', startDate.toISOString())
      .lte('start_time', endDate.toISOString());

    const conflictingShifts = (conflicts ?? []) as ConflictingShift[];

    if (conflictingShifts.length > 0) {
      // Show confirmation dialog with conflicts
      setConfirmDialog({
        open: true,
        request: req,
        conflictingShifts,
        loading: false,
      });
    } else {
      // No conflicts, approve directly
      setConfirmDialog({ open: false, request: null, conflictingShifts: [], loading: false });
      updateMutation.mutate({ id: req.id, status: 'approved', notes: managerNotes[req.id] });
    }
  };

  const handleConfirmApproval = () => {
    if (!confirmDialog.request) return;
    const req = confirmDialog.request;
    updateMutation.mutate({ id: req.id, status: 'approved', notes: managerNotes[req.id] });
    setConfirmDialog({ open: false, request: null, conflictingShifts: [], loading: false });
  };

  const handleReject = (id: string) => {
    updateMutation.mutate({ id, status: 'rejected', notes: managerNotes[id] });
  };

  const pending = requests.filter((r: any) => r.status === 'pending');
  const resolved = requests.filter((r: any) => r.status !== 'pending');

  const renderRequest = (req: any, showActions: boolean) => (
    <Card key={req.id} className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              {TYPE_ICONS[req.request_type] || <Clock className="h-4 w-4" />}
              <span className="font-medium">{(req as any).team_members?.name ?? 'Unknown'}</span>
              <Badge className={STATUS_COLORS[req.status] || ''}>
                {req.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground capitalize">
              {req.request_type.replace(/_/g, ' ')} · {format(new Date(req.start_date), 'MMM d')}
              {req.start_date !== req.end_date && ` – ${format(new Date(req.end_date), 'MMM d')}`}
            </p>
            {req.notes && <p className="text-sm text-muted-foreground">{req.notes}</p>}
            {req.manager_notes && (
              <p className="text-sm text-muted-foreground italic">Manager: {req.manager_notes}</p>
            )}
          </div>
          {showActions && (
            <div className="flex flex-col gap-2 items-end">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={() => handleApproveClick(req)}
                  disabled={updateMutation.isPending || confirmDialog.loading}
                >
                  {confirmDialog.loading && confirmDialog.request?.id === req.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5 mr-1" />
                  )}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => handleReject(req.id)}
                  disabled={updateMutation.isPending}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
              <Textarea
                placeholder="Notes (optional)"
                className="text-xs h-16 w-56"
                value={managerNotes[req.id] || ''}
                onChange={(e) => setManagerNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const memberName = confirmDialog.request?.team_members?.name ?? 'Employee';

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Employee Requests</h1>
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Pending {pending.length > 0 && `(${pending.length})`}
            </TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : pending.length === 0 ? (
              <p className="text-muted-foreground">No pending requests.</p>
            ) : (
              pending.map((r: any) => renderRequest(r, true))
            )}
          </TabsContent>
          <TabsContent value="resolved" className="mt-4">
            {resolved.length === 0 ? (
              <p className="text-muted-foreground">No resolved requests yet.</p>
            ) : (
              resolved.map((r: any) => renderRequest(r, false))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirmation Dialog for Conflicts */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog({ open: false, request: null, conflictingShifts: [], loading: false });
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Schedule Conflict Detected
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  <strong>{memberName}</strong> has{' '}
                  <strong>{confirmDialog.conflictingShifts.length}</strong> scheduled shift(s) during this{' '}
                  {confirmDialog.request?.request_type?.replace(/_/g, ' ')} period
                  {confirmDialog.request && (
                    <span>
                      {' '}({format(new Date(confirmDialog.request.start_date), 'MMM d')}
                      {confirmDialog.request.start_date !== confirmDialog.request.end_date &&
                        ` – ${format(new Date(confirmDialog.request.end_date), 'MMM d')}`})
                    </span>
                  )}:
                </p>
                <div className="rounded-md border border-border bg-muted/50 divide-y divide-border max-h-48 overflow-auto">
                  {confirmDialog.conflictingShifts.map((shift) => (
                    <div key={shift.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span>
                        {format(new Date(shift.start_time), 'EEE, MMM d · HH:mm')} – {format(new Date(shift.end_time), 'HH:mm')}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Approving will highlight these shifts on the calendar so you can reassign them.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmApproval}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Approve Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
