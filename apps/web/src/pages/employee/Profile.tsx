import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMembersSafe } from '@/hooks/useSchedulerData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, Save } from 'lucide-react';

export default function EmployeeProfile() {
  const { user, teamMemberId } = useAuth();
  const { data: teamMembers = [] } = useTeamMembersSafe();
  const { toast } = useToast();

  const member = teamMembers.find(m => m.id === teamMemberId);

  const [phone, setPhone] = useState('');
  const [availability, setAvailability] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('phone, availability_preferences, avatar_url')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setPhone(data.phone || '');
            setAvailability(data.availability_preferences || '');
            setAvatarUrl(data.avatar_url);
          }
        });
    }
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ phone, availability_preferences: availability })
        .eq('id', user.id);
      if (error) throw error;
      toast({ title: 'Profile updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({ title: 'Error', description: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: 'Error', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast({ title: 'Password updated' });
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
      setAvatarUrl(publicUrl);
      toast({ title: 'Avatar updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-3 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">My Profile</h1>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6 max-w-2xl">
        {/* Avatar */}
        <Card>
          <CardContent className="py-4 flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={avatarUrl || ''} />
              <AvatarFallback className="text-lg">{member?.initials || user?.email?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{member?.name || user?.email}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <label className="mt-2 inline-flex items-center gap-1 text-xs text-primary cursor-pointer hover:underline">
                <Upload className="h-3 w-3" />
                {uploadingAvatar ? 'Uploading...' : 'Change photo'}
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Read-only info */}
        {member && (
          <Card>
            <CardHeader><CardTitle className="text-base">Work Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Role</p>
                <p>{member.role}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Region</p>
                <p>{member.region}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Timezone</p>
                <p>{member.timezone}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Contract Type</p>
                <p>{member.contractType}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Max Hours</p>
                <p>{member.maxHours}h/week</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Seniority</p>
                <p>{member.seniority}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Editable fields */}
        <Card>
          <CardHeader><CardTitle className="text-base">Contact & Preferences</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
            </div>
            <div className="space-y-2">
              <Label>Availability Preferences</Label>
              <Textarea value={availability} onChange={e => setAvailability(e.target.value)} placeholder="e.g. Prefer morning shifts, unavailable on Fridays..." />
            </div>
            <Button onClick={handleSaveProfile} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
          <CardContent className="space-y-4 max-w-sm">
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" minLength={6} />
            </div>
            <div className="space-y-2">
              <Label>Confirm Password</Label>
              <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <Button onClick={handleChangePassword} disabled={saving || !newPassword}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
