import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMyTimeOffRequests, useCreateTimeOffRequest, useDeleteTimeOffRequest } from '@/hooks/useTimeOffRequests';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Trash2, Plus } from 'lucide-react';
import { format } from 'date-fns';

const REQUEST_TYPES = [
  { value: 'day_off', label: 'Day Off' },
  { value: 'sick_day', label: 'Sick Day' },
  { value: 'vacation', label: 'Vacation' },
  { value: 'partial_availability', label: 'Partial Availability' },
  { value: 'shift_swap', label: 'Shift Swap' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-500 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export default function EmployeeRequests() {
  const { user, teamMemberId } = useAuth();
  const { data: requests = [], isLoading } = useMyTimeOffRequests();
  const createRequest = useCreateTimeOffRequest();
  const deleteRequest = useDeleteTimeOffRequest();
  const { toast } = useToast();

  const [requestType, setRequestType] = useState('day_off');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [partialStart, setPartialStart] = useState('');
  const [partialEnd, setPartialEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !teamMemberId) {
      toast({ title: 'Error', description: 'Your profile is not linked to a team member. Contact your manager.', variant: 'destructive' });
      return;
    }
    try {
      await createRequest.mutateAsync({
        user_id: user.id,
        team_member_id: teamMemberId,
        request_type: requestType,
        start_date: startDate,
        end_date: endDate || startDate,
        partial_start: requestType === 'partial_availability' ? partialStart : null,
        partial_end: requestType === 'partial_availability' ? partialEnd : null,
        notes: notes || null,
      });
      toast({ title: 'Request submitted', description: 'Your request is pending manager approval.' });
      setStartDate('');
      setEndDate('');
      setPartialStart('');
      setPartialEnd('');
      setNotes('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRequest.mutateAsync(id);
      toast({ title: 'Request cancelled' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const filteredRequests = statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-3 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Time Off & Requests</h1>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="new" className="space-y-4">
          <TabsList>
            <TabsTrigger value="new">New Request</TabsTrigger>
            <TabsTrigger value="history">My Requests ({requests.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="new">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Submit a Request</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={requestType} onValueChange={setRequestType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REQUEST_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label>End Date</Label>
                      <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                  </div>

                  {requestType === 'partial_availability' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Available From</Label>
                        <Input type="time" value={partialStart} onChange={e => setPartialStart(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Available Until</Label>
                        <Input type="time" value={partialEnd} onChange={e => setPartialEnd(e.target.value)} />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Notes (optional)</Label>
                    <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any details..." />
                  </div>

                  <Button type="submit" disabled={createRequest.isPending || !startDate}>
                    {createRequest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Plus className="mr-2 h-4 w-4" />
                    Submit Request
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <div className="flex items-center gap-2 mb-4">
              <Label className="text-sm">Filter:</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : filteredRequests.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No requests found.</p>
            ) : (
              <div className="space-y-3">
                {filteredRequests.map(req => (
                  <Card key={req.id}>
                    <CardContent className="py-4 flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {REQUEST_TYPES.find(t => t.value === req.request_type)?.label || req.request_type}
                          </span>
                          <Badge variant="outline" className={STATUS_COLORS[req.status] || ''}>
                            {req.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(req.start_date), 'MMM d, yyyy')}
                          {req.end_date !== req.start_date && ` – ${format(new Date(req.end_date), 'MMM d, yyyy')}`}
                        </p>
                        {req.notes && <p className="text-xs text-muted-foreground">{req.notes}</p>}
                        {req.manager_notes && (
                          <p className="text-xs text-primary mt-1">Manager: {req.manager_notes}</p>
                        )}
                      </div>
                      {req.status === 'pending' && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(req.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
