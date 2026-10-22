import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, Gift, Mail, RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConsultantFullProfileSheet from '@/components/admin/ConsultantFullProfileSheet';
import InviteUserDialog from '@/components/admin/InviteUserDialog';
import UsersToolbar, { ALL_COLUMNS, DEFAULT_COLUMNS, type Column } from '@/components/admin/users/UsersToolbar';
import UsersList from '@/components/admin/users/UsersList';
import UserDetailSheet from '@/components/admin/users/UserDetailSheet';
import BulkBar from '@/components/admin/users/BulkBar';
import BulkInviteDialog from '@/components/admin/users/BulkInviteDialog';
import ReferralInviteDialog from '@/components/admin/users/ReferralInviteDialog';
import { useInviteStatus } from '@/hooks/useReferralInvitations';
import { filterSummary, inviteStatusMap } from '@/lib/referralInvitations';
import { AccessReviewPanel, AdminAuditPanel, PermissionsPanel } from '@/components/admin/users/AccessPanels';
import { useNotificationPauseOverview } from '@/components/admin/NotificationPauseAdminCard';
import { callRpc, searchAll, searchIds, useMyAdminPermissions, useUsersSearch, useUsersStats, useInvalidateUsers } from '@/hooks/useUserAdmin';
import { BULK_LIMIT, DEFAULT_FILTERS, filtersToParams, nextIndex, parseFilters, usersCsv, type UserFilters } from '@/lib/userAdmin';

const COLS_KEY = 'um.columns.v1';
const TABS = ['users', 'access', 'permissions', 'history'] as const;

/** Admin › Users: accounts, roles and access (also shown at Super admin › User management). */
export default function UsersPage() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => parseFilters(sp), [sp]);
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? sp.get('tab')! : 'users';
  const openUser = sp.get('user');
  const me = useMyAdminPermissions();
  const installed = me.data?.installed;
  const perms = me.data?.permissions ?? [];
  const invalidate = useInvalidateUsers();
  const search = useUsersSearch(filters, installed);
  const stats = useUsersStats(installed);
  const pauseOverview = useNotificationPauseOverview();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(-1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [bulkInvite, setBulkInvite] = useState(false);
  const [refInvite, setRefInvite] = useState<'selected' | 'all_eligible' | null>(null);
  const [consultant, setConsultant] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [columns, setColumns] = useState<Column[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null'); return Array.isArray(v) ? ALL_COLUMNS.filter((c) => v.includes(c)) : DEFAULT_COLUMNS; } catch { return DEFAULT_COLUMNS; }
  });
  useEffect(() => { localStorage.setItem(COLS_KEY, JSON.stringify(columns)); }, [columns]);

  const session = useQuery({ queryKey: ['um', 'session'], queryFn: async () => (await supabase.auth.getSession()).data.session?.user.id ?? '' });
  const myRoles = useQuery({ queryKey: ['um', 'myroles', session.data], enabled: !!session.data, queryFn: async () => ((await supabase.from('user_roles').select('role').eq('user_id', session.data!)).data ?? []).map((r) => String(r.role)) });
  const superCount = useQuery({ queryKey: ['um', 'supercount'], queryFn: async () => (await supabase.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'super_admin')).count ?? 1 });

  const rows = search.data?.rows ?? [];
  const total = search.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / filters.page_size));
  // "Invited on <date> (v1)" per row (Refer & earn invitation); no badges until that database update is applied.
  const inviteStatus = useInviteStatus(rows.map((r) => r.id));
  const invited = useMemo(() => inviteStatusMap(inviteStatus.data), [inviteStatus.data]);

  const setFilters = (f: UserFilters) => { setSp(filtersToParams(f, sp), { replace: true }); setFocus(-1); };
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: k !== 'user' }); };

  // Keyboard: "/" search, j/k move, Enter open, x select (rows handle Enter/x themselves).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      if (tab !== 'users' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const i = nextIndex(focus, e.key, rows.length);
        setFocus(i);
        document.querySelector<HTMLElement>(`[data-row="${i}"]:not([hidden])`)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, rows.length, tab]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = (on: boolean) => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (on ? n.add(r.id) : n.delete(r.id))); return n; });
  const selectMatching = async () => {
    try { const r = await searchIds(filters, !!installed); setSelected(new Set(r.ids)); if (r.total > BULK_LIMIT) toast.message(t('um.first_200', 'The first {{n}} matching people are selected.', { n: BULK_LIMIT })); }
    catch (e) { toast.error((e as Error).message); }
  };

  const exportCsv = async (onlySelected: boolean) => {
    try {
      let list = await searchAll(filters, !!installed);
      if (onlySelected) list = list.filter((r) => selected.has(r.id));
      if (!list.length) { toast.message(t('um.nothing_export', 'Nothing to export')); return; }
      if (installed) await callRpc('admin_log_export', { _kind: 'users', _count: list.length, _filters: Object.fromEntries(filtersToParams(filters).entries()) });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([usersCsv(list)], { type: 'text/csv' }));
      a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast.success(t('um.exported_n', 'Exported {{n}} people', { n: list.length }));
    } catch (e) { toast.error((e as Error).message); }
  };

  const s = stats.data;
  const statCards: Array<[string, number | undefined, Partial<UserFilters> | null]> = [
    [t('um.stat_total', 'Total'), s?.total, {}],
    [t('um.stat_active', 'Active (30 days)'), s?.active_30d, { status: ['active'], active_from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) }],
    [t('um.stat_new', 'New this week'), s?.new_week, { created_from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) }],
    [t('um.stat_suspended', 'Suspended'), s?.suspended, { status: ['suspended'] }],
    [t('um.stat_unverified', 'E-mail not verified'), s?.unverified_email, { status: ['pending', 'invited'] }],
    [t('um.stat_pending', 'Pending approvals'), s?.pending_approvals, { verification: ['pending', 'under_review'] }],
    [t('um.stat_incomplete', 'Incomplete profiles'), installed ? s?.incomplete_profiles : undefined, installed ? { roles: ['consultant'], completion_max: '99' } : null],
    [t('um.stat_inactive', 'Inactive 90+ days'), s?.inactive_90d, { status: ['active'], inactive_days: '90' }],
    // Feature Q: read-only count (no filter), shown once the pause update is applied.
    ...(pauseOverview.data ? [[t('npause.stat_paused', 'Notifications paused'), pauseOverview.data.paused_now, null] as [string, number, null]] : []),
  ];

  const meProps = { id: session.data ?? '', roles: myRoles.data ?? [] };

  return (
    <div className="space-y-5">
      <ConsultantFullProfileSheet consultantId={consultant} onClose={() => setConsultant(null)} />
      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <BulkInviteDialog open={bulkInvite} onOpenChange={setBulkInvite} />
      <ReferralInviteDialog open={!!refInvite} onOpenChange={(o) => { if (!o) setRefInvite(null); }} mode={refInvite ?? 'selected'}
        ids={[...selected]} filters={refInvite === 'all_eligible' ? { source: 'all_eligible' } : filterSummary(filtersToParams(filters))} />

      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('um.title_page', 'Users')}</h1>
          <p className="text-sm text-muted-foreground">{t('um.subtitle', 'Manage accounts, roles and access')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => invalidate()} disabled={search.isFetching}><RefreshCw className={`me-1 h-4 w-4 ${search.isFetching ? 'animate-spin' : ''}`} />{t('um.refresh', 'Refresh')}</Button>
          {(perms.includes('users.export') || me.isLoading) && <Button variant="outline" size="sm" className={me.isLoading ? 'invisible' : undefined} onClick={() => exportCsv(false)} disabled={!total}><Download className="me-1 h-4 w-4" />{t('um.export_csv', 'Export CSV')}</Button>}
          <Button variant="outline" size="sm" onClick={() => setRefInvite('all_eligible')}><Gift className="me-1 h-4 w-4" />{t('rinv.all_button', 'Refer & earn: all eligible consultants')}</Button>
          {(perms.includes('users.invite') || me.isLoading) && <Button variant="outline" size="sm" className={me.isLoading ? 'invisible' : undefined} onClick={() => setBulkInvite(true)}><Mail className="me-1 h-4 w-4" />{t('um.invite_many', 'Invite people')}</Button>}
          {(perms.includes('users.invite') || me.isLoading) && <Button className={`gradient-primary border-0 ${me.isLoading ? 'invisible' : ''}`} size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="me-1 h-4 w-4" />{t('um.invite_one', 'Invite user')}</Button>}
        </div>
      </header>


      <Tabs value={tab} onValueChange={(v) => setParam('tab', v === 'users' ? null : v)}>
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="users">{t('um.tab_people', 'People')}</TabsTrigger>
          {perms.includes('users.roles') && <TabsTrigger value="access">{t('um.access_review', 'Access review')}</TabsTrigger>}
          <TabsTrigger value="permissions">{t('um.tab_permissions', 'Roles & permissions')}</TabsTrigger>
          {perms.includes('audit.read') && <TabsTrigger value="history">{t('um.tab_history', 'Admin history')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {statCards.map(([label, n, preset]) => (
              <button key={label} type="button" disabled={!preset} className="text-start disabled:cursor-default"
                onClick={() => preset && setFilters({ ...DEFAULT_FILTERS, roles: [], status: [], verification: [], badge: [], tags: [], ...preset })}>
                <Card className="h-full rounded-2xl border-border/50 transition-colors hover:border-primary/40">
                  <CardContent className="p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{n ?? '—'}</p></CardContent>
                </Card>
              </button>
            ))}
          </div>

          <UsersToolbar filters={filters} onChange={setFilters} installed={!!installed} searchRef={searchRef} columns={columns} onColumns={setColumns} />

          <Card className="overflow-hidden rounded-2xl border-border/50">
            {search.error ? <p className="p-8 text-center text-sm text-destructive" role="alert">{(search.error as Error).message}</p>
              : !search.isLoading && rows.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="font-medium">{t('um.empty_title', 'No one matches these filters')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('um.empty_desc', 'Try fewer filters or a different search.')}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setFilters(DEFAULT_FILTERS)}>{t('um.clear', 'Clear')}</Button>
                </div>
              ) : (
                <UsersList rows={rows} loading={search.isLoading || me.isLoading} columns={columns} selected={selected} focus={focus}
                  sort={filters.sort} dir={filters.dir} onFocus={setFocus}
                  onSort={(key) => setFilters({ ...filters, sort: key, dir: filters.sort === key && filters.dir === 'desc' ? 'asc' : filters.sort === key ? 'desc' : key === 'name' ? 'asc' : 'desc', page: 1 })}
                  onToggle={toggle} onTogglePage={togglePage} onOpen={(u) => setParam('user', u.id)} invited={invited} />
              )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">
              <span aria-live="polite">{t('um.showing', 'Showing {{a}}–{{b}} of {{n}}', { a: total ? (filters.page - 1) * filters.page_size + 1 : 0, b: Math.min(filters.page * filters.page_size, total), n: total })}</span>
              <div className="flex items-center gap-2">
                <Select value={String(filters.page_size)} onValueChange={(v) => setFilters({ ...filters, page_size: Number(v), page: 1 })}>
                  <SelectTrigger className="h-8 w-20" aria-label={t('um.per_page', 'Per page')}><SelectValue /></SelectTrigger>
                  <SelectContent>{[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>{t('um.prev', 'Previous')}</Button>
                <span>{t('um.page_of', 'Page {{p}} of {{n}}', { p: filters.page, n: pages })}</span>
                <Button size="sm" variant="outline" className="h-8" disabled={filters.page >= pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>{t('um.next', 'Next')}</Button>
              </div>
            </div>
          </Card>
          <p className="text-xs text-muted-foreground">{t('um.shortcuts', 'Shortcuts: / search · j / k move · Enter open · x select')}</p>

          {selected.size > 0 && (
            <BulkBar ids={[...selected]} total={total} installed={!!installed} perms={perms} onClear={() => setSelected(new Set())}
              onSelectMatching={selectMatching} onExport={() => exportCsv(true)} onReferralInvite={() => setRefInvite('selected')} />
          )}
        </TabsContent>

        <TabsContent value="access">{me.data && <AccessReviewPanel me={me.data} onOpenUser={(id) => setParam('user', id)} />}</TabsContent>
        <TabsContent value="permissions">{me.data && <PermissionsPanel me={me.data} />}</TabsContent>
        <TabsContent value="history">{me.data && <AdminAuditPanel me={me.data} onOpenUser={(id) => setParam('user', id)} />}</TabsContent>
      </Tabs>

      {/* Shown under the console: it is only known after loading, so placing it above would make the page jump. */}
      {installed === false && (
        <p className="rounded-2xl border border-info/30 bg-info/10 p-3 text-sm text-foreground" role="status">
          {t('um.legacy_banner', 'Basic mode: paging, more filters, history, notes, groups and 30-day restore turn on once the prepared database update for user management is applied.')}
        </p>
      )}

      <UserDetailSheet userId={openUser} installed={!!installed} perms={perms} me={meProps} superAdminCount={superCount.data ?? 1}
        fourEyes={!!me.data?.four_eyes} onClose={() => setParam('user', null)} onOpenConsultant={setConsultant} />
    </div>
  );
}
