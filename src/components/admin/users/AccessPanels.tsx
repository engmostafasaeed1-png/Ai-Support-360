import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Download, Plus, ShieldOff, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ADMIN_PERMISSIONS, APP_ROLES, CONSOLE_ENFORCED, ROLE_MATRIX, SUPER_ONLY_PERMISSIONS, allowedActions, csvCell, effectivePermissions } from '@/lib/userAdmin';
import { callRpc, useRpcQuery, type MyAdminPermissions } from '@/hooks/useUserAdmin';
import { ReasonDialog } from './UserDialogs';
import { actionLabel } from './UserDetailSheet';
import { fmtDate, permissionLabel, roleLabel } from './labels';

const NotInstalled = () => {
  const { t } = useTranslation();
  return <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">{t('um.needs_update_long', 'This part works once the prepared database update for user management is applied.')}</p>;
};

// ---------------------------------------------------------------------------------------------------------------
interface ReviewRow { id: string; email: string; name: string; roles: string[]; status: string; last_sign_in_at: string | null; last_active_at: string | null; mfa_enabled: boolean; is_self: boolean; groups: string[]; scoped: boolean; permissions: string[] }

export function AccessReviewPanel({ me, onOpenUser }: { me: MyAdminPermissions; onOpenUser: (id: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useRpcQuery<ReviewRow[]>('review', 'admin_access_review', me.installed);
  const [revoke, setRevoke] = useState<ReviewRow | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me.installed) return <NotInstalled />;
  const superCount = (q.data ?? []).filter((r) => r.roles.includes('super_admin')).length;
  return (
    <Card className="rounded-2xl">
      <CardHeader><CardTitle>{t('um.access_review', 'Access review')}</CardTitle><CardDescription>{t('um.access_review_desc', 'Everyone with admin access, when they last signed in and what they can do here. Review this regularly.')}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {q.isLoading ? <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : (
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-border/50 bg-muted/30 text-start text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('um.person', 'Person')}</th>
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('um.roles', 'Roles')}</th>
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('um.last_sign_in', 'Last sign-in')}</th>
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('um.two_step_title', 'Two-step sign-in')}</th>
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('um.permissions', 'Permissions')}</th>
              <th scope="col" className="px-4 py-2"><span className="sr-only">{t('um.actions', 'Actions')}</span></th>
            </tr></thead>
            <tbody className="divide-y divide-border/50">
              {(q.data ?? []).map((r) => {
                const stale = !r.last_sign_in_at || Date.parse(r.last_sign_in_at) < Date.now() - 90 * 86_400_000;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2"><button type="button" className="text-start" onClick={() => onOpenUser(r.id)}><span className="block font-medium">{r.name || r.email}{r.is_self && ` · ${t('um.you', 'you')}`}</span><span className="block text-xs text-muted-foreground" dir="ltr">{r.email}</span></button></td>
                    <td className="px-4 py-2">{r.roles.filter((x) => x === 'admin' || x === 'super_admin').map((x) => <Badge key={x} variant="outline" className="me-1">{roleLabel(t, x)}</Badge>)}{r.groups.map((g) => <Badge key={g} variant="secondary" className="me-1">{g}</Badge>)}</td>
                    <td className={stale ? 'px-4 py-2 text-destructive' : 'px-4 py-2'}>{fmtDate(r.last_sign_in_at)}{stale && <span className="block text-xs">{t('um.stale_90', 'Not in 90+ days')}</span>}</td>
                    <td className="px-4 py-2">{r.mfa_enabled ? t('um.on', 'On') : <span className="text-destructive">{t('um.off', 'Off')}</span>}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.roles.includes('super_admin') ? t('um.all_permissions', 'Everything') : r.scoped ? t('um.n_permissions', '{{n}} of {{m}}', { n: r.permissions.length, m: ADMIN_PERMISSIONS.length }) : t('um.all_admin_permissions', 'All admin permissions')}</td>
                    <td className="px-4 py-2 text-end">
                      {me.is_super && !r.is_self && !(r.roles.includes('super_admin') && superCount <= 1) && (
                        <Button size="sm" variant="outline" onClick={() => setRevoke(r)}><ShieldOff className="me-1 h-4 w-4" />{t('um.revoke', 'Revoke')}</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
      <ReasonDialog open={!!revoke} busy={busy} needsReason destructive onClose={() => setRevoke(null)}
        title={t('um.revoke_title', 'Revoke admin access for {{n}}?', { n: revoke?.name || revoke?.email })}
        description={t('um.revoke_desc', 'Admin and super admin roles are removed. Client or consultant roles stay. Super admins are alerted.')}
        confirmLabel={t('um.revoke', 'Revoke')}
        onConfirm={async (reason) => {
          if (!revoke) return;
          setBusy(true);
          try {
            await callRpc('admin_user_action', { _uid: revoke.id, _action: 'set_roles', _payload: { roles: revoke.roles.filter((x) => x !== 'admin' && x !== 'super_admin') }, _reason: reason });
            toast.success(t('um.revoked', 'Admin access revoked')); setRevoke(null); qc.invalidateQueries({ queryKey: ['um'] });
          } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }} />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
interface Group { id: string; name: string; description: string | null; permissions: string[]; members: Array<{ id: string; name: string }> }
interface GrantRequest { id: string; target: string; requested_by: string; reason: string; status: string; created_at: string; expires_at: string; decided_by: string | null; mine: boolean }

export function PermissionsPanel({ me }: { me: MyAdminPermissions }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const groups = useRpcQuery<{ catalog: string[]; groups: Group[] }>('groups', 'admin_permission_groups_list', me.installed);
  const admins = useRpcQuery<ReviewRow[]>('review', 'admin_access_review', me.installed && me.permissions.includes('users.roles'));
  const requests = useRpcQuery<GrantRequest[]>('requests', 'admin_grant_requests', me.installed && me.is_super);
  const [edit, setEdit] = useState<Partial<Group> | null>(null);
  const [viewAs, setViewAs] = useState<string>('self');
  const refresh = () => qc.invalidateQueries({ queryKey: ['um'] });
  const guard = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); refresh(); } catch (e) { toast.error((e as Error).message); } };

  const asPerms = viewAs === 'self' ? me.permissions
    : viewAs.startsWith('group:') ? effectivePermissions({ roles: ['admin'], groupPermissions: [groups.data?.groups.find((g) => g.id === viewAs.slice(6))?.permissions ?? []] })
    : viewAs === 'admin' ? effectivePermissions({ roles: ['admin'] }) : effectivePermissions({ roles: [viewAs] });
  const actions = allowedActions(asPerms);

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle>{t('um.role_matrix', 'What each role can do')}</CardTitle><CardDescription>{t('um.role_matrix_desc', 'Account roles are fixed. A person can hold several roles.')}</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-border/50 bg-muted/30"><th scope="col" className="px-4 py-2 text-start font-medium text-muted-foreground">{t('um.capability', 'Capability')}</th>
              {APP_ROLES.map((r) => <th key={r} scope="col" className="px-4 py-2 text-center font-medium text-muted-foreground">{roleLabel(t, r)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border/50">
              {ROLE_MATRIX.map((row) => (
                <tr key={row.key}><th scope="row" className="px-4 py-2 text-start font-normal">{matrixLabel(t, row.key)}</th>
                  {APP_ROLES.map((r) => <td key={r} className="px-4 py-2 text-center">{row.roles[r] ? <Check className="mx-auto h-4 w-4 text-success" aria-label={t('um.yes', 'Yes')} /> : <X className="mx-auto h-4 w-4 text-muted-foreground/50" aria-label={t('um.no', 'No')} />}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {!me.installed ? <NotInstalled /> : (
        <>
          <Card className="rounded-2xl">
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div><CardTitle>{t('um.admin_groups', 'Admin groups')}</CardTitle><CardDescription>{t('um.admin_groups_desc', 'Limit what an admin can do in this Users console. Admins in no group keep every admin permission; super admins always have everything.')}</CardDescription></div>
              {me.is_super && <Button size="sm" onClick={() => setEdit({ name: '', description: '', permissions: ['users.read'] })}><Plus className="me-1 h-4 w-4" />{t('um.new_group', 'New group')}</Button>}
            </CardHeader>
            <CardContent className="space-y-3">
              {(groups.data?.groups ?? []).map((g) => (
                <div key={g.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="font-medium">{g.name}</p>{g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}</div>
                    {me.is_super && <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEdit(g)}>{t('um.edit', 'Edit')}</Button>
                      <Button size="sm" variant="ghost" aria-label={t('um.delete_group', 'Delete group {{n}}', { n: g.name })} onClick={() => guard(() => callRpc('admin_delete_permission_group', { _id: g.id }), t('um.group_deleted', 'Group deleted'))}><Trash2 className="h-4 w-4" /></Button>
                    </div>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">{g.permissions.map((p) => <Badge key={p} variant="secondary" className="text-[10px]">{permissionLabel(t, p)}</Badge>)}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                    <span className="text-muted-foreground">{t('um.members', 'Members')}:</span>
                    {g.members.map((m) => (
                      <Badge key={m.id} variant="outline" className="gap-1">{m.name}{me.is_super && <button type="button" aria-label={t('um.remove_member', 'Remove {{n}}', { n: m.name })} onClick={() => guard(() => callRpc('admin_set_group_member', { _group: g.id, _user: m.id, _member: false }), t('um.member_removed', 'Removed'))}>×</button>}</Badge>
                    ))}
                    {me.is_super && (
                      <Select onValueChange={(uid) => guard(() => callRpc('admin_set_group_member', { _group: g.id, _user: uid, _member: true }), t('um.member_added', 'Added'))}>
                        <SelectTrigger className="h-7 w-40 text-xs" aria-label={t('um.add_member', 'Add member')}><SelectValue placeholder={t('um.add_member', 'Add member')} /></SelectTrigger>
                        <SelectContent>{(admins.data ?? []).filter((a) => !a.roles.includes('super_admin') && !g.members.some((m) => m.id === a.id)).map((a) => <SelectItem key={a.id} value={a.id}>{a.name || a.email}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              ))}
              {!groups.data?.groups.length && <p className="text-sm text-muted-foreground">{t('um.no_groups', 'No admin groups yet, so every admin has full admin permissions.')}</p>}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader><CardTitle>{t('um.view_as', 'View as permissions')}</CardTitle><CardDescription>{t('um.view_as_desc', 'Preview which actions this console allows for a role or group.')}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <Select value={viewAs} onValueChange={setViewAs}>
                <SelectTrigger className="max-w-xs" aria-label={t('um.view_as', 'View as permissions')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">{t('um.me', 'Me')}</SelectItem>
                  <SelectItem value="super_admin">{roleLabel(t, 'super_admin')}</SelectItem>
                  <SelectItem value="admin">{t('um.admin_no_group', 'Admin (no group)')}</SelectItem>
                  {(groups.data?.groups ?? []).map((g) => <SelectItem key={g.id} value={`group:${g.id}`}>{t('um.group_x', 'Group: {{n}}', { n: g.name })}</SelectItem>)}
                  <SelectItem value="consultant">{roleLabel(t, 'consultant')}</SelectItem>
                </SelectContent>
              </Select>
              <ul className="grid gap-1 text-sm sm:grid-cols-2" aria-live="polite">
                {CONSOLE_ENFORCED.map((p) => (
                  <li key={p} className="flex items-center gap-2">{asPerms.includes(p) ? <Check className="h-4 w-4 text-success" aria-label={t('um.allowed', 'Allowed')} /> : <X className="h-4 w-4 text-muted-foreground/50" aria-label={t('um.not_allowed', 'Not allowed')} />}{permissionLabel(t, p)}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('um.n_actions', '{{n}} console actions available.', { n: actions.length })} {t('um.other_pages_note', 'Other admin pages still follow the admin role.')}</p>
            </CardContent>
          </Card>

          {me.is_super && (
            <Card className="rounded-2xl">
              <CardHeader><CardTitle>{t('um.security_settings', 'Security settings')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div><Label htmlFor="um-4eyes">{t('um.four_eyes', 'Second approval for new super admins')}</Label><p className="text-xs text-muted-foreground">{t('um.four_eyes_desc', 'When on, granting super admin creates a request that another super admin must approve within 7 days.')}</p></div>
                  <Switch id="um-4eyes" checked={me.four_eyes} onCheckedChange={(v) => guard(() => callRpc('admin_set_security_setting', { _key: 'super_admin_four_eyes', _value: v }), t('um.saved', 'Saved'))} />
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div><Label htmlFor="um-alerts">{t('um.security_alerts', 'Security alerts')}</Label><p className="text-xs text-muted-foreground">{t('um.security_alerts_desc', 'Notify super admins (in the app and by e-mail when administrator e-mails are on) about admin role changes and admin sign-ins from new devices.')}</p></div>
                  <Switch id="um-alerts" checked={me.security_alerts} onCheckedChange={(v) => guard(() => callRpc('admin_set_security_setting', { _key: 'admin_security_alerts', _value: v }), t('um.saved', 'Saved'))} />
                </div>
                <section className="space-y-2" aria-labelledby="um-req-h">
                  <h3 id="um-req-h" className="font-semibold">{t('um.grant_requests', 'Super admin requests')}</h3>
                  {(requests.data ?? []).map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
                      <div><p className="font-medium">{r.target}</p><p className="text-xs text-muted-foreground">{t('um.requested_by', 'Requested by {{n}} · {{d}}', { n: r.requested_by, d: fmtDate(r.created_at, true) })} · {r.reason}</p></div>
                      {r.status === 'pending' ? (
                        <div className="flex gap-1">
                          {!r.mine && <Button size="sm" onClick={() => guard(() => callRpc('admin_decide_grant_request', { _id: r.id, _approve: true, _note: null }), t('um.approved', 'Approved'))}>{t('um.approve', 'Approve')}</Button>}
                          <Button size="sm" variant="outline" onClick={() => guard(() => callRpc('admin_decide_grant_request', { _id: r.id, _approve: false, _note: null }), r.mine ? t('um.cancelled', 'Cancelled') : t('um.rejected', 'Rejected'))}>{r.mine ? t('common.cancel', 'Cancel') : t('um.reject', 'Reject')}</Button>
                        </div>
                      ) : <Badge variant="outline">{r.status}</Badge>}
                    </div>
                  ))}
                  {!requests.data?.length && <p className="text-xs text-muted-foreground">{t('um.none', 'None')}</p>}
                </section>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {edit && <GroupDialog group={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

function GroupDialog({ group, onClose, onSaved }: { group: Partial<Group>; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(group.name ?? '');
  const [desc, setDesc] = useState(group.description ?? '');
  const [perms, setPerms] = useState<string[]>(group.permissions ?? ['users.read']);
  const [busy, setBusy] = useState(false);
  return (
    <ReasonDialog open busy={busy} onClose={onClose} title={group.id ? t('um.edit_group', 'Edit admin group') : t('um.new_group', 'New group')}
      description={t('um.group_dialog_desc', 'Members can only do what is ticked here in the Users console. Super-admin-only actions cannot be granted.')}
      confirmLabel={t('common.save', 'Save')} canConfirm={!!name.trim()}
      onConfirm={async () => {
        setBusy(true);
        try { await callRpc('admin_save_permission_group', { _id: group.id ?? null, _name: name, _description: desc, _permissions: perms }); toast.success(t('um.saved', 'Saved')); onSaved(); }
        catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
      }}>
      <div className="space-y-1.5"><Label htmlFor="um-g-name">{t('um.name', 'Name')}</Label><Input id="um-g-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="um-g-desc">{t('um.description', 'Description')}</Label><Input id="um-g-desc" value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} /></div>
      <fieldset className="grid max-h-56 gap-1.5 overflow-auto sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">{t('um.permissions', 'Permissions')}</legend>
        {ADMIN_PERMISSIONS.map((p) => (
          <label key={p} className="flex items-start gap-2 text-xs"><Checkbox checked={perms.includes(p)} disabled={p === 'users.read'} onCheckedChange={(v) => setPerms(v ? [...perms, p] : perms.filter((x) => x !== p))} />{permissionLabel(t, p)}</label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t('um.super_only_list', 'Super admin only')}: {SUPER_ONLY_PERMISSIONS.map((p) => permissionLabel(t, p)).join(', ')}</p>
    </ReasonDialog>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matrixLabel(t: any, k: string) {
  return ({
    submit_tickets: t('um.m_submit_tickets', 'Submit and manage support tickets'), approve_timesheets: t('um.m_approve_timesheets', 'Approve timesheets and pay invoices'),
    favourites: t('um.m_favourites', 'Keep favourite consultants and groups'), bid_and_accept: t('um.m_bid', 'Bid on and accept requests'),
    timesheets_invoices: t('um.m_timesheets', 'Record work, timesheets and invoices'), payout_details: t('um.m_payout', 'Own payout details'),
    admin_pages: t('um.m_admin_pages', 'Open admin pages'), verify_consultants: t('um.m_verify', 'Verify consultants and approve clients'),
    payments_payouts: t('um.m_payments', 'Confirm payments and payouts'), manage_client_consultant_roles: t('um.m_roles', 'Change client/consultant roles, suspend accounts'),
    grant_admin: t('um.m_grant_admin', 'Grant or remove admin and super admin'), admin_groups: t('um.m_groups', 'Manage admin groups and security settings'),
    merge_mfa_anonymise: t('um.m_merge', 'Merge accounts, reset two-step sign-in, anonymise'),
  } as Record<string, string>)[k] ?? k;
}

// ---------------------------------------------------------------------------------------------------------------
interface AuditRow { id: string; created_at: string; action: string; actor: string | null; actor_id: string | null; target: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown }

export function AdminAuditPanel({ me, onOpenUser }: { me: MyAdminPermissions; onOpenUser: (id: string) => void }) {
  const { t } = useTranslation();
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [adminOnly, setAdminOnly] = useState(true);
  const [page, setPage] = useState(1);
  const args = { _p: { action, from, to: to ? `${to}T23:59:59Z` : '', admin_only: adminOnly, page, page_size: 50 } };
  const q = useRpcQuery<{ total: number; rows: AuditRow[] }>('audit', 'admin_audit_search', me.installed && me.permissions.includes('audit.read'), args);
  if (!me.installed) return <NotInstalled />;
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));

  const exportCsv = async () => {
    try {
      const r = await callRpc<{ rows: AuditRow[] }>('admin_audit_search', { _p: { ...args._p, export: true } });
      const csv = [['When', 'Action', 'By', 'Person', 'Reason', 'Before', 'After'].map(csvCell).join(','),
        ...r.rows.map((x) => [x.created_at, x.action, x.actor, x.target, x.reason, JSON.stringify(x.before ?? ''), JSON.stringify(x.after ?? '')].map(csvCell).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `admin-history-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader><CardTitle>{t('um.admin_history', 'Admin action history')}</CardTitle><CardDescription>{t('um.admin_history_desc', 'Who did what to which account, with the reason and the values before and after.')}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="um-a-action" className="text-xs">{t('um.action_contains', 'Action contains')}</Label><Input id="um-a-action" className="h-9 w-44" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="suspend" /></div>
          <div className="space-y-1"><Label htmlFor="um-a-from" className="text-xs">{t('um.from', 'from')}</Label><Input id="um-a-from" type="date" className="h-9" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></div>
          <div className="space-y-1"><Label htmlFor="um-a-to" className="text-xs">{t('um.to', 'to')}</Label><Input id="um-a-to" type="date" className="h-9" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></div>
          <label className="flex h-9 items-center gap-2 text-sm"><Switch checked={adminOnly} onCheckedChange={(v) => { setAdminOnly(v); setPage(1); }} />{t('um.admin_only', 'Admin actions only')}</label>
          <Button size="sm" variant="outline" className="ms-auto" onClick={exportCsv}><Download className="me-1 h-4 w-4" />{t('um.export_csv', 'Export CSV')}</Button>
        </div>
        {q.isLoading ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : (
          <ol className="space-y-2">
            {(q.data?.rows ?? []).map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{actionLabel(t, r.action)}</span><time className="text-xs text-muted-foreground" dateTime={r.created_at}>{fmtDate(r.created_at, true)}</time></div>
                <p className="text-xs text-muted-foreground">
                  {r.actor_id ? <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenUser(r.actor_id!)}>{r.actor}</button> : '—'}
                  {r.target && <> → {r.target_id ? <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenUser(r.target_id!)}>{r.target}</button> : r.target}</>}
                  {r.reason && ` · ${t('um.reason', 'Reason')}: ${r.reason}`}
                </p>
                {(r.before || r.after) && <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground" dir="ltr">{JSON.stringify(r.before ?? null)} → {JSON.stringify(r.after ?? null)}</p>}
              </li>
            ))}
            {!q.data?.rows.length && <p className="text-sm text-muted-foreground">{t('um.no_history', 'Nothing recorded for these filters.')}</p>}
          </ol>
        )}
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('um.prev', 'Previous')}</Button>
          <span aria-live="polite">{t('um.page_of', 'Page {{p}} of {{n}}', { p: page, n: pages })}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('um.next', 'Next')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
