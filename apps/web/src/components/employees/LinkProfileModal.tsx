import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Link2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { TeamMember } from '@/types/scheduler';

interface Profile {
  id: string;
  display_name: string | null;
  team_member_id: string | null;
}

interface LinkProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMembers: TeamMember[];
}

export function LinkProfileModal({ open, onOpenChange, teamMembers }: LinkProfileModalProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [selectedMember, setSelectedMember] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setFetching(true);
      supabase
        .from('profiles')
        .select('id, display_name, team_member_id')
        .then(({ data }) => {
          setProfiles(data || []);
          setFetching(false);
        });
    }
  }, [open]);

  const linkedMemberIds = new Set(profiles.filter(p => p.team_member_id).map(p => p.team_member_id));
  const unlinkedProfiles = profiles.filter(p => !p.team_member_id);
  const availableMembers = teamMembers.filter(m => !linkedMemberIds.has(m.id));

  const handleLink = async () => {
    if (!selectedProfile || !selectedMember) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ team_member_id: selectedMember })
        .eq('id', selectedProfile);
      if (error) throw error;
      toast({ title: 'Profile linked', description: 'User account is now linked to the team member.' });
      setSelectedProfile('');
      setSelectedMember('');
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ['profiles'] });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Show already linked pairs
  const linkedProfiles = profiles.filter(p => p.team_member_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Link User Accounts to Team Members
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Connect a user login to a team member record so they see their shifts and can submit requests.
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5 py-2">
            {/* New Link */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Create New Link</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">User Account</Label>
                  <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                    <SelectTrigger className="h-8 text-sm bg-secondary border-border">
                      <SelectValue placeholder="Select user..." />
                    </SelectTrigger>
                    <SelectContent>
                      {unlinkedProfiles.length === 0 ? (
                        <SelectItem value="_none" disabled>All users linked</SelectItem>
                      ) : (
                        unlinkedProfiles.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.display_name || p.id.slice(0, 8)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Team Member</Label>
                  <Select value={selectedMember} onValueChange={setSelectedMember}>
                    <SelectTrigger className="h-8 text-sm bg-secondary border-border">
                      <SelectValue placeholder="Select member..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableMembers.length === 0 ? (
                        <SelectItem value="_none" disabled>All members linked</SelectItem>
                      ) : (
                        availableMembers.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleLink} disabled={loading || !selectedProfile || !selectedMember} size="sm" className="gap-1.5">
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <Link2 className="h-3.5 w-3.5" /> Link
              </Button>
            </div>

            {/* Existing Links */}
            {linkedProfiles.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Existing Links</Label>
                <div className="rounded-md border border-border divide-y divide-border text-sm">
                  {linkedProfiles.map(p => {
                    const member = teamMembers.find(m => m.id === p.team_member_id);
                    return (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2">
                        <span className="text-muted-foreground">{p.display_name || p.id.slice(0, 8)}</span>
                        <span className="text-foreground font-medium">{member?.name || 'Unknown'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-8 text-sm">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
