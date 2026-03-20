import { useMemo, useState } from 'react';
import { useTeamMembers, useUpsertTeamMember, useDeleteTeamMember } from '@/hooks/useSchedulerData';
import { TeamMember, TIMEZONE_LABELS, Region } from '@/types/scheduler';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmployeeFormModal } from '@/components/employees/EmployeeFormModal';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Search, Users, UserPlus, Link2 } from 'lucide-react';
import { InviteUserModal } from '@/components/employees/InviteUserModal';
import { LinkProfileModal } from '@/components/employees/LinkProfileModal';
import { useToast } from '@/hooks/use-toast';

const regionLabels: Record<Region, string> = { canada: 'Canada', india: 'India', serbia: 'Serbia' };
const contractLabels: Record<string, string> = { 'full-time': 'Full-Time', 'part-time': 'Part-Time', contract: 'Contract' };

const Employees = () => {
  const { data: employees = [], isLoading } = useTeamMembers();
  const upsertMember = useUpsertTeamMember();
  const deleteMember = useDeleteTeamMember();

  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [seniorityFilter, setSeniorityFilter] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<TeamMember | null>(null);

  const { toast } = useToast();

  const filtered = useMemo(() => {
    return employees.filter(e => {
      const matchesSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.role.toLowerCase().includes(search.toLowerCase());
      const matchesRegion = regionFilter === 'all' || e.region === regionFilter;
      const matchesSeniority = seniorityFilter === 'all' || e.seniority === seniorityFilter;
      return matchesSearch && matchesRegion && matchesSeniority;
    });
  }, [employees, search, regionFilter, seniorityFilter]);

  const handleSave = (emp: TeamMember) => { upsertMember.mutate(emp); };
  const openCreate = () => { setEditingEmployee(null); setModalOpen(true); };
  const openEdit = (emp: TeamMember) => { setEditingEmployee(emp); setModalOpen(true); };
  const handleDelete = (emp: TeamMember) => {
    deleteMember.mutate(emp.id);
    toast({ title: 'Employee removed', description: `${emp.name} has been deleted.` });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading employees…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Employees</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setLinkOpen(true)} size="sm" variant="outline" className="gap-1.5">
            <Link2 className="h-3.5 w-3.5" /> Link Profiles
          </Button>
          <Button onClick={() => setInviteOpen(true)} size="sm" variant="outline" className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Invite User
          </Button>
          <Button onClick={openCreate} size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Create Employee
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or role..." className="pl-8 h-8 text-sm bg-secondary border-border" />
        </div>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-[140px] h-8 text-sm bg-secondary border-border"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            <SelectItem value="canada">Canada</SelectItem>
            <SelectItem value="india">India</SelectItem>
            <SelectItem value="serbia">Serbia</SelectItem>
          </SelectContent>
        </Select>
        <Select value={seniorityFilter} onValueChange={setSeniorityFilter}>
          <SelectTrigger className="w-[140px] h-8 text-sm bg-secondary border-border"><SelectValue placeholder="Seniority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="senior">Senior</SelectItem>
            <SelectItem value="junior">Junior</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-auto flex-1">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="text-xs font-medium text-muted-foreground">Name</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Role</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Region</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Timezone</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Contract</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground text-right">Max Hrs</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(emp => (
              <TableRow key={emp.id} className="border-border hover:bg-secondary/50 h-10">
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7 text-[10px]">
                      <AvatarFallback className="bg-primary/15 text-primary font-medium">{emp.initials}</AvatarFallback>
                    </Avatar>
                    <div>
                      <span className="text-sm font-medium text-foreground">{emp.name}</span>
                      <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-border">
                        {emp.seniority === 'senior' ? 'SR' : 'JR'}
                      </Badge>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground py-1.5">{emp.role}</TableCell>
                <TableCell className="py-1.5"><Badge variant="secondary" className="text-xs">{regionLabels[emp.region]}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground py-1.5">{TIMEZONE_LABELS[emp.timezone]}</TableCell>
                <TableCell className="py-1.5"><Badge variant="outline" className="text-[10px] border-border">{contractLabels[emp.contractType]}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground text-right py-1.5">{emp.maxHours}h</TableCell>
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(emp)}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {emp.name}?</AlertDialogTitle>
                          <AlertDialogDescription>This will permanently remove this employee from the roster.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(emp)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No employees found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <EmployeeFormModal open={modalOpen} onOpenChange={setModalOpen} employee={editingEmployee} onSave={handleSave} />
      <InviteUserModal open={inviteOpen} onOpenChange={setInviteOpen} />
      <LinkProfileModal open={linkOpen} onOpenChange={setLinkOpen} teamMembers={employees} />
    </div>
  );
};

export default Employees;
