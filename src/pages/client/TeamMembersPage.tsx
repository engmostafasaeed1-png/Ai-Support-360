import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Users, Plus, Mail, Shield, Crown, UserCog, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';


const roleIcons: Record<string, typeof Crown> = {
  Owner: Crown,
  Admin: Shield,
  Member: UserCog,
};

const roleColors: Record<string, string> = {
  Owner: 'bg-amber-500/10 text-amber-600 border-amber-200',
  Admin: 'bg-blue-500/10 text-blue-600 border-blue-200',
  Member: 'bg-muted text-muted-foreground',
};

export default function TeamMembersPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [members, setMembers] = useState<{ id: string; name: string; email: string; role: string; status: string; initials: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenant, isOwnerOrAdmin } = useTenant();
  const [inviting, setInviting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      // the members of the company that is active now
      if (!tenant?.id) { if (active) { setMembers([]); setLoading(false); } return; }

      const { data: rows } = await supabase
        .from('tenant_members')
        .select('id, user_id, org_role, accepted_at')
        .eq('tenant_id', tenant.id);

      if (!rows || rows.length === 0) { if (active) setLoading(false); return; }

      const userIds = rows.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from('profile_directory')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const nameMap = new Map((profiles || []).map(p => [p.user_id, p.display_name || 'Member']));

      if (!active) return;
      setMembers(rows.map(r => {
        const name = nameMap.get(r.user_id) || 'Member';
        return {
          id: r.id,
          name,
          email: '',
          role: r.org_role === 'owner' ? 'Owner' : r.org_role === 'admin' ? 'Admin' : 'Member',
          status: r.accepted_at ? 'Active' : 'Invited',
          initials: name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        };
      }));
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, [tenant?.id, reloadKey]);

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    if (!tenant?.id) {
      toast.error('Choose a company first.');
      return;
    }
    setInviting(true);
    const { error } = await supabase.rpc('invite_to_company', {
      _tenant_id: tenant.id,
      _email: email,
      _role: inviteRole === 'admin' ? 'admin' : 'member',
    });
    setInviting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Invitation sent. If this e-mail address has an account, the person sees it under Companies and can accept it.');
    setInviteEmail('');
    setOpen(false);
    setReloadKey((k) => k + 1);
  };

  const cancelInvitation = async (memberId: string) => {
    const { error } = await supabase.from('tenant_members').delete().eq('id', memberId).is('accepted_at', null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Invitation cancelled.');
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('sidebar.team_members', 'Team Members')}</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage who can access your company portal</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" disabled={!isOwnerOrAdmin} title={isOwnerOrAdmin ? undefined : 'Only company owners and administrators can invite people'}>
              <Plus className="w-4 h-4" />
              Invite
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">The person needs an account on this platform. They see the invitation under Companies and decide whether to join.</p>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Mail className="w-4 h-4 me-2" />}
                Send Invitation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            {members.length} Members
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? null : members.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nothing here yet</p>
              <p className="text-xs text-muted-foreground mt-1">Invite teammates to collaborate on your company portal.</p>
            </div>
          ) : (
          <div className="divide-y divide-border">
            {members.map((member) => {
              const RoleIcon = roleIcons[member.role] || UserCog;
              return (
                <div key={member.id} className="flex items-center gap-3 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <Avatar className="w-9 h-9">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">{member.initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Badge variant="outline" className={`gap-1 ${roleColors[member.role]}`}>
                    <RoleIcon className="w-3 h-3" />
                    {member.role}
                  </Badge>
                  {member.status === 'Invited' && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-[10px]">Pending</Badge>
                  )}
                  {member.status === 'Invited' && isOwnerOrAdmin && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => cancelInvitation(member.id)}>Cancel</Button>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
