import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ShieldCheck, Users, Plus, Search, Edit2, Trash2, Lock, Unlock,
  Eye, FileText, Settings, UserCheck, UserX, Crown, Shield,
} from 'lucide-react';
import { useAdminUsers } from '@/hooks/useAdminData';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { toast } from 'sonner';

const permissions = [
  { key: 'view_dashboard', label: 'View Dashboard', category: 'General' },
  { key: 'manage_tickets', label: 'Manage Tickets', category: 'Tickets' },
  { key: 'create_tickets', label: 'Create Tickets', category: 'Tickets' },
  { key: 'assign_tickets', label: 'Assign Tickets', category: 'Tickets' },
  { key: 'view_users', label: 'View Users', category: 'Users' },
  { key: 'manage_users', label: 'Manage Users', category: 'Users' },
  { key: 'change_roles', label: 'Change User Roles', category: 'Users' },
  { key: 'suspend_users', label: 'Suspend Users', category: 'Users' },
  { key: 'view_reports', label: 'View Reports', category: 'Reports' },
  { key: 'export_reports', label: 'Export Reports', category: 'Reports' },
  { key: 'view_payments', label: 'View Payments', category: 'Finance' },
  { key: 'manage_payments', label: 'Manage Payments', category: 'Finance' },
  { key: 'issue_refunds', label: 'Issue Refunds', category: 'Finance' },
  { key: 'manage_settings', label: 'Manage Settings', category: 'System' },
  { key: 'manage_integrations', label: 'Manage Integrations', category: 'System' },
  { key: 'view_audit_logs', label: 'View Audit Logs', category: 'System' },
  { key: 'manage_nda', label: 'Manage NDAs', category: 'Legal' },
  { key: 'approve_consultants', label: 'Approve Consultants', category: 'Consultants' },
  { key: 'manage_environments', label: 'Manage Environments', category: 'Environments' },
];

const rolePermissions: Record<string, string[]> = {
  admin: permissions.map(p => p.key),
  consultant: ['view_dashboard', 'create_tickets', 'view_reports'],
  client: ['view_dashboard', 'create_tickets', 'view_payments'],
};

const roleColors: Record<string, string> = {
  admin: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  consultant: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  client: 'bg-accent/10 text-accent border-accent/20',
};

export default function RolesAuthPage() {
  const { t } = useTranslation();
  const { data: users } = useAdminUsers();
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('admin');
  const [rolePerms, setRolePerms] = useState(rolePermissions);

  const allUsers = users || [];
  const filtered = allUsers.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.role.includes(search.toLowerCase())
  );

  const handlePermToggle = (perm: string) => {
    setRolePerms(prev => {
      const current = prev[selectedRole] || [];
      const next = current.includes(perm)
        ? current.filter(p => p !== perm)
        : [...current, perm];
      return { ...prev, [selectedRole]: next };
    });
  };

  const handleRoleChange = (userId: string, newRole: string) => {
    toast.success(t('super_admin.role_changed', `Role changed to ${newRole}`));
  };

  const handleSuspend = (userId: string) => {
    toast.success(t('super_admin.user_suspended', 'User suspended'));
  };

  const categories = [...new Set(permissions.map(p => p.category))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('super_admin.roles_title', 'Roles & Authorization')}</h1>
        <p className="text-sm text-muted-foreground">{t('super_admin.roles_subtitle', 'Manage user roles, permissions, and access control')}</p>
      </div>

      <Tabs defaultValue="permissions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="permissions">{t('super_admin.permissions', 'Permissions Matrix')}</TabsTrigger>
          <TabsTrigger value="users">{t('super_admin.user_roles', 'User Roles')}</TabsTrigger>
          <TabsTrigger value="access_control">{t('super_admin.access_control', 'Access Control')}</TabsTrigger>
        </TabsList>

        {/* Permissions Matrix Tab */}
        <TabsContent value="permissions">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  {t('super_admin.permission_matrix', 'Permission Matrix')}
                </CardTitle>
                <div className="flex gap-2">
                  {['admin', 'consultant', 'client'].map(role => (
                    <Button
                      key={role}
                      variant={selectedRole === role ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedRole(role)}
                      className={selectedRole === role ? 'gradient-primary border-0' : ''}
                    >
                      {role === 'admin' && <Crown className="w-3 h-3 me-1" />}
                      {role === 'consultant' && <Shield className="w-3 h-3 me-1" />}
                      {role === 'client' && <Users className="w-3 h-3 me-1" />}
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {categories.map(category => (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      {category}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {permissions.filter(p => p.category === category).map(perm => (
                        <div key={perm.key} className="flex items-center justify-between rounded-lg border border-border/50 p-3 bg-muted/10">
                          <Label htmlFor={perm.key} className="text-sm cursor-pointer">{perm.label}</Label>
                          <Switch
                            id={perm.key}
                            checked={(rolePerms[selectedRole] || []).includes(perm.key)}
                            onCheckedChange={() => handlePermToggle(perm.key)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <Button className="gradient-primary border-0" onClick={() => toast.success(t('super_admin.permissions_saved', 'Permissions saved'))}>
                  {t('common.save', 'Save Changes')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Roles Tab */}
        <TabsContent value="users">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t('super_admin.search_users', 'Search users...')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="ps-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.user', 'User')}</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.current_role', 'Current Role')}</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.change_role', 'Change Role')}</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.status', 'Status')}</th>
                      <th className="text-end py-3 px-4 font-medium text-muted-foreground">{t('super_admin.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filtered.map((user) => (
                      <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                              {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{user.name}</p>
                              <p className="text-xs text-muted-foreground">{t('super_admin.joined', 'Joined')}: {user.joined}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className={`text-[10px] ${roleColors[user.role]}`}>
                            {user.role}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Select defaultValue={user.role} onValueChange={(val) => handleRoleChange(user.id, val)}>
                            <SelectTrigger className="w-32 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="client">Client</SelectItem>
                              <SelectItem value="consultant">Consultant</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                            {user.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-end">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="View Details">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleSuspend(user.id)} title="Suspend">
                              <UserX className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Access Control Tab */}
        <TabsContent value="access_control">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('super_admin.route_access', 'Route Access Rules')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { route: '/admin/*', roles: ['admin'], icon: Crown },
                  { route: '/super-admin/*', roles: ['admin'], icon: ShieldCheck },
                  { route: '/client/*', roles: ['client'], icon: Users },
                  { route: '/consultant/*', roles: ['consultant'], icon: Shield },
                  { route: '/chat/*', roles: ['client', 'consultant', 'admin'], icon: FileText },
                ].map((rule) => (
                  <div key={rule.route} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-muted/10">
                    <div className="flex items-center gap-2">
                      <rule.icon className="w-4 h-4 text-muted-foreground" />
                      <code className="text-xs font-mono text-foreground">{rule.route}</code>
                    </div>
                    <div className="flex gap-1">
                      {rule.roles.map(r => (
                        <Badge key={r} variant="outline" className={`text-[9px] ${roleColors[r]}`}>{r}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('super_admin.security_policies', 'Security Policies')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: 'Require email verification', enabled: true },
                  { label: 'Two-factor authentication', enabled: false },
                  { label: 'Session timeout (30 min)', enabled: true },
                  { label: 'IP whitelist for admins', enabled: false },
                  { label: 'Rate limiting (100 req/min)', enabled: true },
                  { label: 'Audit all admin actions', enabled: true },
                ].map((policy) => (
                  <div key={policy.label} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-muted/10">
                    <Label className="text-sm">{policy.label}</Label>
                    <Switch defaultChecked={policy.enabled} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
