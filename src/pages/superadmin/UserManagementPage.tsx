import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, Users, Eye, UserX, UserCheck, Mail, Shield,
  MoreHorizontal, Download, Crown, Filter,
} from 'lucide-react';
import { useAdminUsers } from '@/hooks/useAdminData';
import { toast } from 'sonner';

const roleColors: Record<string, string> = {
  client: 'bg-accent/10 text-accent border-accent/20',
  consultant: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  admin: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

export default function UserManagementPage() {
  const { t } = useTranslation();
  const { data: users } = useAdminUsers();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const allUsers = users || [];
  const filtered = allUsers.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const selected = allUsers.find(u => u.id === selectedUser);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('super_admin.users_title', 'User Management')}</h1>
          <p className="text-sm text-muted-foreground">{allUsers.length} {t('super_admin.total_registered', 'total registered users')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => toast.success('Users exported')}>
            <Download className="w-3.5 h-3.5 me-1" /> Export
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* User List */}
        <div className="md:col-span-2">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-32 h-9">
                    <Filter className="w-3 h-3 me-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="consultant">Consultant</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50 max-h-[600px] overflow-y-auto">
                {filtered.map((user) => (
                  <button
                    key={user.id}
                    className={`w-full text-start p-4 flex items-center gap-3 hover:bg-muted/20 transition-colors ${selectedUser === user.id ? 'bg-primary/5' : ''}`}
                    onClick={() => setSelectedUser(user.id)}
                  >
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                      {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{t('super_admin.joined', 'Joined')}: {user.joined}</p>
                    </div>
                    <Badge variant="outline" className={`text-[9px] ${roleColors[user.role]}`}>
                      {user.role}
                    </Badge>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* User Detail */}
        <div>
          {selected ? (
            <Card className="border-border/50 sticky top-20">
              <CardContent className="p-6">
                <div className="text-center mb-4">
                  <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center text-lg font-bold text-primary-foreground mx-auto mb-3">
                    {selected.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{selected.name}</h3>
                  <Badge variant="outline" className={`mt-1 ${roleColors[selected.role]}`}>
                    {selected.role === 'admin' && <Crown className="w-3 h-3 me-1" />}
                    {selected.role}
                  </Badge>
                </div>

                <div className="space-y-3 mt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">Active</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Joined</span>
                    <span className="font-medium">{selected.joined}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tickets</span>
                    <span className="font-medium">{selected.tickets}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">User ID</span>
                    <span className="font-mono text-xs text-muted-foreground">{selected.id.slice(0, 8)}...</span>
                  </div>
                </div>

                <div className="mt-6 space-y-2">
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <Eye className="w-3.5 h-3.5 me-2" /> View Full Profile
                  </Button>
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <Mail className="w-3.5 h-3.5 me-2" /> Send Email
                  </Button>
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <Shield className="w-3.5 h-3.5 me-2" /> Change Role
                  </Button>
                  <Button variant="outline" className="w-full justify-start text-destructive" size="sm" onClick={() => toast.success('User suspended')}>
                    <UserX className="w-3.5 h-3.5 me-2" /> Suspend User
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                Select a user to view details
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
