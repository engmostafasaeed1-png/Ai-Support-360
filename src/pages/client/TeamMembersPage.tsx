import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Users, Plus, Mail, Shield, Crown, UserCog } from 'lucide-react';
import { toast } from 'sonner';

const mockMembers = [
  { id: '1', name: 'Mostafa A.', email: 'mostafa@company.com', role: 'Owner', status: 'Active', initials: 'MA' },
  { id: '2', name: 'Sara M.', email: 'sara@company.com', role: 'Admin', status: 'Active', initials: 'SM' },
  { id: '3', name: 'Ahmed K.', email: 'ahmed@company.com', role: 'Member', status: 'Active', initials: 'AK' },
  { id: '4', name: 'Fatima R.', email: 'fatima@company.com', role: 'Member', status: 'Invited', initials: 'FR' },
];

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

  const handleInvite = () => {
    if (!inviteEmail) return;
    toast.success(`Invitation sent to ${inviteEmail}`);
    setInviteEmail('');
    setOpen(false);
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
            <Button size="sm" className="gap-1.5">
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
              <Button className="w-full" onClick={handleInvite}>
                <Mail className="w-4 h-4 me-2" />
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
            {mockMembers.length} Members
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {mockMembers.map((member) => {
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
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
