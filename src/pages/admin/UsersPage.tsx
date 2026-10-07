import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, MoreHorizontal, UserPlus, Shield, Ban, CheckCircle2, KeyRound, Trash2, Pencil, Download, Copy, RefreshCw } from 'lucide-react';
import InviteUserDialog from '@/components/admin/InviteUserDialog';
import { toast } from 'sonner';

type AdminUser = {
  id: string; email: string; name: string; avatar_url: string | null; roles: string[];
  created_at: string; last_sign_in_at: string | null; status: 'active' | 'pending' | 'suspended'; is_self: boolean;
};
const ALL_ROLES = ['client', 'consultant', 'admin', 'super_admin'] as const;
const roleLabel: Record<string, string> = { client: 'Client', consultant: 'Consultant', admin: 'Admin', super_admin: 'Super admin' };
const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { active: 'default', pending: 'secondary', suspended: 'destructive' };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('admin-manage-user', { body: { action, ...payload } });
  if (error || data?.error) {
    let msg = data?.error;
    if (!msg && error && (error as any).context?.json) { try { msg = (await (error as any).context.json()).error; } catch { /* ignore */ } }
    throw new Error(msg || 'Action failed');
  }
  return data;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 250).toLowerCase();
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesFor, setRolesFor] = useState<AdminUser | null>(null);
  const [nameFor, setNameFor] = useState<AdminUser | null>(null);
  const [details, setDetails] = useState<AdminUser | null>(null);
  const [confirm, setConfirm] = useState<{ user: AdminUser; action: 'suspend' | 'reactivate' | 'delete' | 'password_reset' } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: users = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-manage-users'],
    queryFn: async () => (await call('list')).users as AdminUser[],
  });

  const filtered = useMemo(() => {
    const list = users.filter((u) =>
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
      (roleFilter === 'all' || (roleFilter === 'none' ? u.roles.length === 0 : u.roles.includes(roleFilter))) &&
      (statusFilter === 'all' || u.status === statusFilter));
    return [...list].sort((a, b) =>
      sort === 'name' ? (a.name || a.email).localeCompare(b.name || b.email)
        : sort === 'last_sign_in' ? (b.last_sign_in_at ?? '').localeCompare(a.last_sign_in_at ?? '')
        : sort === 'oldest' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
  }, [users, q, roleFilter, statusFilter, sort]);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.status === 'active').length,
    pending: users.filter((u) => u.status === 'pending').length,
    suspended: users.filter((u) => u.status === 'suspended').length,
  }), [users]);

  const run = async (action: string, user: AdminUser, payload: Record<string, unknown> = {}, ok = 'Done') => {
    setBusy(true);
    try {
      await call(action, { user_id: user.id, ...payload });
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ['admin-manage-users'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      return true;
    } catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(false); }
  };

  const exportCsv = () => {
    const rows = [['Name', 'Email', 'Roles', 'Status', 'Joined', 'Last sign-in'],
      ...filtered.map((u) => [u.name, u.email, u.roles.join(' '), u.status, fmt(u.created_at), fmt(u.last_sign_in_at)])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const confirmText = {
    suspend: { t: 'Suspend user?', d: 'They will be signed out and cannot sign in until reactivated.', b: 'Suspend', ok: 'User suspended' },
    reactivate: { t: 'Reactivate user?', d: 'They will be able to sign in again.', b: 'Reactivate', ok: 'User reactivated' },
    delete: { t: 'Delete user permanently?', d: 'Their account is removed and cannot be restored. Records they created may be removed too.', b: 'Delete', ok: 'User deleted' },
    password_reset: { t: 'Send password reset?', d: 'They will get an email with a link to set a new password.', b: 'Send', ok: 'Password reset email sent' },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">Manage accounts, roles and access</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`w-4 h-4 me-1 ${isFetching ? 'animate-spin' : ''}`} /> Refresh</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}><Download className="w-4 h-4 me-1" /> Export CSV</Button>
          <Button className="gradient-primary border-0" size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="w-4 h-4 me-1" /> Invite user</Button>
        </div>
      </div>
      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([['Total', counts.total, 'all'], ['Active', counts.active, 'active'], ['Awaiting email confirmation', counts.pending, 'pending'], ['Suspended', counts.suspended, 'suspended']] as const).map(([l, n, s]) => (
          <button key={l} type="button" onClick={() => setStatusFilter(s)} className="text-start">
            <Card className={`rounded-2xl ${statusFilter === s ? 'border-primary' : 'border-border/50'}`}>
              <CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-2xl font-bold">{n}</p></CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="lg:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ALL_ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>)}
                <SelectItem value="none">No role</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="lg:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Awaiting confirmation</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="lg:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="last_sign_in">Last sign-in</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : error ? (
            <p className="p-8 text-center text-destructive text-sm">{(error as Error).message}</p>
          ) : filtered.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">No users match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    {['User', 'Roles', 'Status', 'Joined', 'Last sign-in'].map((h) => <th key={h} className="text-start py-3 px-4 font-medium text-muted-foreground">{h}</th>)}
                    <th className="text-end py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filtered.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20">
                      <td className="py-3 px-4">
                        <button type="button" className="flex items-center gap-3 text-start" onClick={() => setDetails(u)}>
                          {u.avatar_url ? <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            : <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">{(u.name || u.email).slice(0, 2).toUpperCase()}</div>}
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{u.name || '—'}{u.is_self && <span className="text-xs text-muted-foreground"> (you)</span>}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4"><div className="flex flex-wrap gap-1">{u.roles.length ? u.roles.map((r) => <Badge key={r} variant="outline" className="text-[10px]">{roleLabel[r] ?? r}</Badge>) : <span className="text-xs text-muted-foreground">None</span>}</div></td>
                      <td className="py-3 px-4"><Badge variant={statusVariant[u.status]} className="text-[10px] capitalize">{u.status === 'pending' ? 'Awaiting confirmation' : u.status}</Badge></td>
                      <td className="py-3 px-4 text-muted-foreground">{fmt(u.created_at)}</td>
                      <td className="py-3 px-4 text-muted-foreground">{fmt(u.last_sign_in_at)}</td>
                      <td className="py-3 px-4 text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${u.email}`}><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDetails(u)}>View details</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setNameFor(u)}><Pencil className="w-4 h-4 me-2" /> Edit name</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setRolesFor(u)}><Shield className="w-4 h-4 me-2" /> Change roles</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setConfirm({ user: u, action: 'password_reset' })}><KeyRound className="w-4 h-4 me-2" /> Send password reset</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(u.email); toast.success('Email copied'); }}><Copy className="w-4 h-4 me-2" /> Copy email</DropdownMenuItem>
                            {!u.is_self && <>
                              <DropdownMenuSeparator />
                              {u.status === 'suspended'
                                ? <DropdownMenuItem onClick={() => setConfirm({ user: u, action: 'reactivate' })}><CheckCircle2 className="w-4 h-4 me-2" /> Reactivate</DropdownMenuItem>
                                : <DropdownMenuItem onClick={() => setConfirm({ user: u, action: 'suspend' })}><Ban className="w-4 h-4 me-2" /> Suspend</DropdownMenuItem>}
                              <DropdownMenuItem className="text-destructive" onClick={() => setConfirm({ user: u, action: 'delete' })}><Trash2 className="w-4 h-4 me-2" /> Delete</DropdownMenuItem>
                            </>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-xs text-muted-foreground">Showing {filtered.length} of {users.length}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {rolesFor && <RolesDialog user={rolesFor} busy={busy} onClose={() => setRolesFor(null)}
        onSave={async (roles) => { if (await run('set_roles', rolesFor, { roles }, 'Roles updated')) setRolesFor(null); }} />}
      {nameFor && <NameDialog user={nameFor} busy={busy} onClose={() => setNameFor(null)}
        onSave={async (name) => { if (await run('update_name', nameFor, { name }, 'Name updated')) setNameFor(null); }} />}

      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{details?.name || details?.email}</DialogTitle><DialogDescription>{details?.email}</DialogDescription></DialogHeader>
          {details && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Roles</dt><dd>{details.roles.map((r) => roleLabel[r] ?? r).join(', ') || 'None'}</dd>
              <dt className="text-muted-foreground">Status</dt><dd className="capitalize">{details.status}</dd>
              <dt className="text-muted-foreground">Joined</dt><dd>{new Date(details.created_at).toLocaleString()}</dd>
              <dt className="text-muted-foreground">Last sign-in</dt><dd>{details.last_sign_in_at ? new Date(details.last_sign_in_at).toLocaleString() : 'Never'}</dd>
              <dt className="text-muted-foreground">User ID</dt><dd className="font-mono text-xs break-all">{details.id}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          {confirm && <>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmText[confirm.action].t}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.user.name || confirm.user.email} — {confirmText[confirm.action].d}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={busy} className={confirm.action === 'delete' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
                onClick={() => { const c = confirm; setConfirm(null); run(c.action, c.user, {}, confirmText[c.action].ok); }}>
                {confirmText[confirm.action].b}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RolesDialog({ user, busy, onClose, onSave }: { user: AdminUser; busy: boolean; onClose: () => void; onSave: (r: string[]) => void }) {
  const [roles, setRoles] = useState<string[]>(user.roles);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Change roles</DialogTitle><DialogDescription>{user.email}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {ALL_ROLES.map((r) => (
            <label key={r} className="flex items-center gap-3 text-sm">
              <Checkbox checked={roles.includes(r)} onCheckedChange={(v) => setRoles(v ? [...roles, r] : roles.filter((x) => x !== r))} />
              {roleLabel[r]}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">A user can hold several roles. Only a super admin can grant or remove super admin.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => onSave(roles)}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({ user, busy, onClose, onSave }: { user: AdminUser; busy: boolean; onClose: () => void; onSave: (n: string) => void }) {
  const [name, setName] = useState(user.name);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Edit name</DialogTitle><DialogDescription>{user.email}</DialogDescription></DialogHeader>
        <div><Label>Display name</Label><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={() => onSave(name.trim())}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
