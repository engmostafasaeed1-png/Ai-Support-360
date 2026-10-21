import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertTriangle, Ban, CheckCircle2, Copy, Download, KeyRound, LogOut, Mail, MoreHorizontal, Pencil, RotateCcw, Send, Shield, ShieldOff, Trash2, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { callRpc, useUserDetail } from '@/hooks/useUserAdmin';
import { restoreDaysLeft, type UserRow } from '@/lib/userAdmin';
import { EditProfileDialog, MergeDialog, MessageDialog, ReasonDialog, RolesDialog } from './UserDialogs';
import { useUserActions } from './useUserActions';
import { STATUS_VARIANT, fmtDate, roleLabel, statusLabel, verificationLabel } from './labels';

type Dialog =
  | 'edit' | 'roles' | 'suspend' | 'reactivate' | 'force_sign_out' | 'password_reset' | 'resend_verification' | 'mfa_reset'
  | 'soft_delete' | 'restore' | 'anonymise' | 'delete' | 'merge' | 'unmerge' | 'message' | null;

export interface DetailProps {
  userId: string | null;
  installed: boolean;
  perms: string[];
  me: { id: string; roles: string[] };
  superAdminCount: number;
  fourEyes: boolean;
  onClose: () => void;
  onOpenConsultant: (consultantId: string) => void;
}

export default function UserDetailSheet(props: DetailProps) {
  const { userId, onClose } = props;
  const { t } = useTranslation();
  return (
    <Sheet open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="sr-only"><SheetTitle>{t('um.user_details', 'User details')}</SheetTitle><SheetDescription>{t('um.user_details_desc', 'Account, activity and security')}</SheetDescription></SheetHeader>
        {userId && <Loaded key={userId} {...props} userId={userId} />}
      </SheetContent>
    </Sheet>
  );
}

function Loaded({ userId, installed, perms, me, superAdminCount, fourEyes, onOpenConsultant }: DetailProps & { userId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useUserDetail(userId, installed);
  const { busy, run } = useUserActions(installed);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState('');
  const [tagInput, setTagInput] = useState('');
  const can = (p: string) => perms.includes(p);

  if (isLoading) return <div className="space-y-3 p-6" aria-busy="true">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (error || !data?.user) return <p className="p-6 text-sm text-destructive" role="alert">{(error as Error)?.message || t('um.not_found', 'User not found')}</p>;

  const u = data.user as UserRow & { invited_at?: string; banned_until?: string };
  const legacy = !!data.legacy;
  const self = u.id === me.id;
  const targetSuper = u.roles.includes('super_admin');
  const lockedBySuper = targetSuper && !me.roles.includes('super_admin');
  const deleted = u.status === 'deleted';
  const merged = !!u.merged_into;
  const flags = (data.flags ?? {}) as Record<string, boolean>;
  const close = () => setDialog(null);
  const after = async (res: unknown) => { if (res) { close(); await refetch(); } };
  const act = (action: string, ok: string, extra: { payload?: Record<string, unknown>; undo?: () => Promise<unknown> } = {}) =>
    async (reason: string) => after(await run(action, u.id, { ...extra, reason, ok }));

  const tags: string[] = u.tags ?? [];
  const saveTags = async (next: string[]) => { await run('set_tags', u.id, { payload: { tags: next }, ok: t('um.tags_saved', 'Tags saved') }); await refetch(); };

  const exportData = async () => {
    try {
      const json = await callRpc('admin_user_export', { _uid: u.id });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
      a.download = `user-data-${u.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast.success(t('um.export_done', 'Personal data exported (recorded in the history)'));
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-5 pe-12">
        <div className="flex items-start gap-3">
          {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
            : <div className="gradient-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-primary-foreground" aria-hidden>{(u.name || u.email).slice(0, 2).toUpperCase()}</div>}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-foreground">{u.name || u.email}{self && <span className="text-xs font-normal text-muted-foreground"> · {t('um.you', 'you')}</span>}</h2>
            <p className="truncate text-sm text-muted-foreground" dir="ltr">{u.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant={STATUS_VARIANT[u.status]}>{statusLabel(t, u.status)}</Badge>
              {u.roles.map((r) => <Badge key={r} variant="outline">{roleLabel(t, r)}</Badge>)}
              {merged && <Badge variant="secondary">{t('um.merged', 'Merged')}</Badge>}
              {tags.map((tag) => <Badge key={tag} variant="secondary">#{tag}</Badge>)}
            </div>
          </div>
        </div>
        {u.status === 'suspended' && (u.suspended_reason || u.suspended_until) && (
          <p className="mt-3 rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
            {t('um.suspended_because', 'Suspended')}: {u.suspended_reason || '—'}{u.suspended_until ? ` · ${t('um.until', 'until')} ${fmtDate(u.suspended_until, true)}` : ''}
          </p>
        )}
        {deleted && (
          <p className="mt-3 rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
            {t('um.deleted_restore', 'Deleted. Can be restored for {{n}} more days.', { n: restoreDaysLeft(u.anonymise_after) })}
          </p>
        )}
        {Object.keys(flags).length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1" aria-label={t('um.security_flags', 'Security flags')}>
            {Object.keys(flags).map((f) => (
              <li key={f}><Badge variant="outline" className="border-warning/40 bg-warning/10 text-foreground"><AlertTriangle className="me-1 h-3 w-3" aria-hidden />{flagLabel(t, f)}</Badge></li>
            ))}
          </ul>
        )}
        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2">
          {can('users.edit') && !lockedBySuper && <Button size="sm" variant="outline" onClick={() => setDialog('edit')}><Pencil className="me-1 h-4 w-4" />{t('um.edit', 'Edit')}</Button>}
          {can('users.roles') && !self && <Button size="sm" variant="outline" onClick={() => setDialog('roles')}><Shield className="me-1 h-4 w-4" />{t('um.roles', 'Roles')}</Button>}
          {can('users.suspend') && !self && !deleted && !merged && !lockedBySuper && (u.status === 'suspended'
            ? <Button size="sm" variant="outline" onClick={() => setDialog('reactivate')}><CheckCircle2 className="me-1 h-4 w-4" />{t('um.reactivate', 'Reactivate')}</Button>
            : <Button size="sm" variant="outline" onClick={() => setDialog('suspend')}><Ban className="me-1 h-4 w-4" />{t('um.suspend', 'Suspend')}</Button>)}
          {can('users.message') && installed && <Button size="sm" variant="outline" onClick={() => setDialog('message')}><Send className="me-1 h-4 w-4" />{t('um.message', 'Message')}</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label={t('um.more_actions', 'More actions')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(u.email); toast.success(t('um.email_copied', 'E-mail copied')); }}><Copy className="me-2 h-4 w-4" />{t('um.copy_email', 'Copy e-mail')}</DropdownMenuItem>
              {can('users.edit') && !lockedBySuper && <DropdownMenuItem onClick={() => setDialog('password_reset')}><KeyRound className="me-2 h-4 w-4" />{t('um.password_reset', 'Send password reset')}</DropdownMenuItem>}
              {can('users.edit') && !u.email_verified && <DropdownMenuItem onClick={() => setDialog('resend_verification')}><Mail className="me-2 h-4 w-4" />{t('um.resend_verification', 'Resend verification e-mail')}</DropdownMenuItem>}
              {can('users.sessions') && !self && !lockedBySuper && <DropdownMenuItem onClick={() => setDialog('force_sign_out')}><LogOut className="me-2 h-4 w-4" />{t('um.force_sign_out', 'Sign out everywhere')}</DropdownMenuItem>}
              {can('users.mfa_reset') && !self && u.mfa_enabled && <DropdownMenuItem onClick={() => setDialog('mfa_reset')}><ShieldOff className="me-2 h-4 w-4" />{t('um.mfa_reset', 'Reset two-step sign-in')}</DropdownMenuItem>}
              {can('users.export') && installed && <DropdownMenuItem onClick={exportData}><Download className="me-2 h-4 w-4" />{t('um.export_data', 'Export personal data')}</DropdownMenuItem>}
              {can('users.merge') && installed && !self && !merged && !deleted && !u.roles.some((r) => r === 'admin' || r === 'super_admin') && <DropdownMenuItem onClick={() => setDialog('merge')}><Users className="me-2 h-4 w-4" />{t('um.merge_dup', 'Merge duplicate…')}</DropdownMenuItem>}
              {can('users.merge') && merged && <DropdownMenuItem onClick={() => setDialog('unmerge')}><RotateCcw className="me-2 h-4 w-4" />{t('um.unmerge', 'Unmerge')}</DropdownMenuItem>}
              {!self && !lockedBySuper && <DropdownMenuSeparator />}
              {can('users.delete') && installed && !self && !lockedBySuper && !deleted && <DropdownMenuItem className="text-destructive" onClick={() => setDialog('soft_delete')}><Trash2 className="me-2 h-4 w-4" />{t('um.delete', 'Delete (30-day restore)')}</DropdownMenuItem>}
              {can('users.delete') && deleted && !data.state?.anonymised_at && <DropdownMenuItem onClick={() => setDialog('restore')}><RotateCcw className="me-2 h-4 w-4" />{t('um.restore', 'Restore')}</DropdownMenuItem>}
              {can('users.anonymise') && deleted && !data.state?.anonymised_at && <DropdownMenuItem className="text-destructive" onClick={() => setDialog('anonymise')}><UserX className="me-2 h-4 w-4" />{t('um.anonymise', 'Anonymise')}</DropdownMenuItem>}
              {can('users.hard_delete') && !self && (deleted || !installed) && <DropdownMenuItem className="text-destructive" onClick={() => setDialog('delete')}><Trash2 className="me-2 h-4 w-4" />{t('um.hard_delete', 'Delete permanently')}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {legacy ? (
        <div className="flex-1 overflow-auto p-5 text-sm">
          <Overview u={u} data={data} onOpenConsultant={onOpenConsultant} />
          <p className="mt-4 rounded-xl bg-muted p-3 text-xs text-muted-foreground">{t('um.legacy_detail', 'Activity, sessions, notes and messages appear here once the prepared database update is applied.')}</p>
        </div>
      ) : (
        <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 w-auto justify-start overflow-x-auto">
            <TabsTrigger value="overview">{t('um.tab_overview', 'Overview')}</TabsTrigger>
            <TabsTrigger value="activity">{t('um.tab_activity', 'Activity')}</TabsTrigger>
            <TabsTrigger value="security">{t('um.tab_security', 'Security')}</TabsTrigger>
            {can('users.notes') && <TabsTrigger value="notes">{t('um.tab_notes', 'Notes')}</TabsTrigger>}
            <TabsTrigger value="comms">{t('um.tab_comms', 'Messages')}</TabsTrigger>
            <TabsTrigger value="data">{t('um.tab_data', 'Data')}</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-auto p-5 text-sm">
            <TabsContent value="overview" className="mt-0 space-y-5">
              <Overview u={u} data={data} onOpenConsultant={onOpenConsultant} />
              {can('users.edit') && (
                <section aria-labelledby="um-tags-h" className="space-y-2">
                  <h3 id="um-tags-h" className="font-semibold">{t('um.tags', 'Tags')}</h3>
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">#{tag}
                        <button type="button" className="ms-1 text-muted-foreground hover:text-foreground" aria-label={t('um.remove_tag', 'Remove tag {{tag}}', { tag })} onClick={() => saveTags(tags.filter((x) => x !== tag))}>×</button>
                      </Badge>
                    ))}
                    {!tags.length && <span className="text-xs text-muted-foreground">{t('um.no_tags', 'No tags yet')}</span>}
                  </div>
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = tagInput.trim().toLowerCase(); if (v && !tags.includes(v)) { saveTags([...tags, v]); setTagInput(''); } }}>
                    <Label htmlFor="um-tag" className="sr-only">{t('um.add_tag', 'Add tag')}</Label>
                    <Input id="um-tag" value={tagInput} maxLength={30} placeholder={t('um.add_tag', 'Add tag')} onChange={(e) => setTagInput(e.target.value)} className="h-8 max-w-48" />
                    <Button type="submit" size="sm" variant="outline" disabled={busy || !/^[a-z0-9][a-z0-9 _-]{0,29}$/i.test(tagInput.trim())}>{t('um.add', 'Add')}</Button>
                  </form>
                </section>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              <ol className="space-y-2" aria-label={t('um.tab_activity', 'Activity')}>
                {(data.timeline ?? []).map((e: { id: string; action: string; created_at: string; by: string; actor_name: string; metadata: Record<string, unknown> }) => (
                  <li key={e.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{actionLabel(t, e.action)}</span>
                      <time className="text-xs text-muted-foreground" dateTime={e.created_at}>{fmtDate(e.created_at, true)}</time>
                    </div>
                    <p className="text-xs text-muted-foreground">{e.by === 'self' ? t('um.by_them', 'By this person') : t('um.by_admin', 'By {{name}}', { name: e.actor_name || t('um.role_admin', 'Admin') })}
                      {typeof e.metadata?.reason === 'string' ? ` · ${t('um.reason', 'Reason')}: ${e.metadata.reason}` : ''}</p>
                  </li>
                ))}
                {!data.timeline?.length && <p className="text-muted-foreground">{t('um.no_activity', 'No activity recorded yet.')}</p>}
              </ol>
            </TabsContent>

            <TabsContent value="security" className="mt-0 space-y-5">
              <section className="space-y-2" aria-labelledby="um-sess-h">
                <h3 id="um-sess-h" className="font-semibold">{t('um.active_sessions', 'Active sessions')} ({data.sessions?.length ?? 0})</h3>
                {(data.sessions ?? []).map((s: { created_at: string; last_seen_at: string; user_agent: string; network: string; aal: string }, i: number) => (
                  <div key={i} className="rounded-xl border border-border p-3 text-xs">
                    <p className="font-medium text-foreground">{deviceName(s.user_agent)}</p>
                    <p className="text-muted-foreground">{t('um.network', 'Network')}: <span dir="ltr">{s.network || '—'}</span> · {t('um.started', 'Started')} {fmtDate(s.created_at, true)} · {t('um.last_seen', 'Last seen')} {fmtDate(s.last_seen_at, true)}{s.aal === 'aal2' ? ` · ${t('um.two_step', 'two-step')}` : ''}</p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">{t('um.country_unavailable', 'Sign-in country is not available; networks are shortened for privacy.')}</p>
              </section>
              <section className="space-y-2" aria-labelledby="um-signin-h">
                <h3 id="um-signin-h" className="font-semibold">{t('um.sign_in_history', 'Sign-in history')}</h3>
                <ul className="space-y-1 text-xs">
                  {(data.sign_ins ?? []).map((s: { action: string; created_at: string; user_agent: string | null }, i: number) => (
                    <li key={i} className="flex justify-between gap-2"><span className={s.action.includes('failed') ? 'text-destructive' : ''}>{actionLabel(t, s.action)} · {deviceName(s.user_agent)}</span><time dateTime={s.created_at} className="text-muted-foreground">{fmtDate(s.created_at, true)}</time></li>
                  ))}
                </ul>
                {!data.sign_ins?.length && <p className="text-xs text-muted-foreground">{t('um.no_sign_ins', 'No sign-ins recorded.')}</p>}
                <p className="text-xs text-muted-foreground">{t('um.failed_note', 'Failed attempts before sign-in cannot be linked to an account, so only some appear here.')}</p>
              </section>
              <section className="space-y-1" aria-labelledby="um-2fa-h">
                <h3 id="um-2fa-h" className="font-semibold">{t('um.two_step_title', 'Two-step sign-in')}</h3>
                <p>{data.mfa?.length ? data.mfa.map((m: { type: string; status: string }) => `${m.type} (${m.status})`).join(', ') : t('um.off', 'Off')}</p>
                {data.suppression && <p className="text-destructive">{t('um.suppressed', 'E-mails to this address are blocked')}: {data.suppression.reason} · {fmtDate(data.suppression.created_at)}</p>}
              </section>
            </TabsContent>

            {can('users.notes') && (
              <TabsContent value="notes" className="mt-0 space-y-3">
                <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; if (await run('add_note', u.id, { payload: { body: note.trim() }, ok: t('um.note_saved', 'Note saved') })) { setNote(''); refetch(); } }}>
                  <Label htmlFor="um-note">{t('um.internal_note', 'Internal note (admins only)')}</Label>
                  <Textarea id="um-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button type="submit" size="sm" disabled={busy || !note.trim()}>{t('um.add_note', 'Add note')}</Button>
                </form>
                {(data.notes ?? []).map((n: { id: string; body: string; created_at: string; author_name: string; author_id: string }) => (
                  <div key={n.id} className="rounded-xl border border-border p-3">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{n.author_name} · {fmtDate(n.created_at, true)}</span>
                      {(n.author_id === me.id || me.roles.includes('super_admin')) && (
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={async () => { if (await run('delete_note', u.id, { payload: { note_id: n.id }, ok: t('um.note_deleted', 'Note deleted') })) refetch(); }}>{t('um.delete_short', 'Delete')}</Button>
                      )}
                    </div>
                  </div>
                ))}
              </TabsContent>
            )}

            <TabsContent value="comms" className="mt-0 space-y-5">
              <section className="space-y-1" aria-labelledby="um-em-h">
                <h3 id="um-em-h" className="font-semibold">{t('um.emails_sent', 'E-mails')}</h3>
                {(data.emails ?? []).map((m: { template_name: string; status: string; created_at: string; error: string | null }, i: number) => (
                  <p key={i} className="flex justify-between gap-2 text-xs"><span>{m.template_name} · <span className={m.status === 'sent' ? '' : 'text-destructive'}>{m.status}</span></span><span className="text-muted-foreground">{fmtDate(m.created_at, true)}</span></p>
                ))}
                {!data.emails?.length && <p className="text-xs text-muted-foreground">{t('um.none', 'None')}</p>}
              </section>
              <section className="space-y-1" aria-labelledby="um-nt-h">
                <h3 id="um-nt-h" className="font-semibold">{t('um.notifications', 'Notifications')}</h3>
                {(data.notifications ?? []).map((m: { title: string; is_read: boolean; created_at: string }, i: number) => (
                  <p key={i} className="flex justify-between gap-2 text-xs"><span>{m.title}{m.is_read ? '' : ` · ${t('um.unread', 'unread')}`}</span><span className="text-muted-foreground">{fmtDate(m.created_at, true)}</span></p>
                ))}
                {!data.notifications?.length && <p className="text-xs text-muted-foreground">{t('um.none', 'None')}</p>}
              </section>
            </TabsContent>

            <TabsContent value="data" className="mt-0 space-y-3">
              <p>{t('um.gdpr_desc', 'Export everything stored about this person as a JSON file (bank and payout numbers are never included). Exports are recorded.')}</p>
              {can('users.export') && <Button size="sm" variant="outline" onClick={exportData}><Download className="me-1 h-4 w-4" />{t('um.export_data', 'Export personal data')}</Button>}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t('um.deletion', 'Deletion')}</dt><dd>{data.state?.deleted_at ? fmtDate(data.state.deleted_at, true) : t('um.not_requested', 'Not requested')}</dd>
                <dt className="text-muted-foreground">{t('um.anonymise_after', 'Anonymise after')}</dt><dd>{fmtDate(data.state?.anonymise_after)}</dd>
                <dt className="text-muted-foreground">{t('um.anonymised', 'Anonymised')}</dt><dd>{fmtDate(data.state?.anonymised_at)}</dd>
              </dl>
            </TabsContent>
          </div>
        </Tabs>
      )}

      {/* Dialogs */}
      {dialog === 'edit' && <EditProfileDialog user={u} phone={u.phone} language={null} busy={busy} onClose={close}
        onSave={async (v) => after(await run('update_profile', u.id, { payload: v, ok: t('um.saved', 'Saved') }))} />}
      {dialog === 'roles' && <RolesDialog user={u} actorId={me.id} actorRoles={me.roles} superAdminCount={superAdminCount} fourEyes={fourEyes} busy={busy} onClose={close}
        onSave={async (roles, reason) => after(await run('set_roles', u.id, { payload: { roles }, reason, ok: t('um.roles_saved', 'Roles updated') }))} />}
      {dialog === 'message' && <MessageDialog user={u} busy={busy} onClose={close}
        onSend={async (v) => after(await run('notify', u.id, { payload: v, ok: t('um.message_sent', 'Notification sent') }))} />}
      {dialog === 'merge' && <MergeDialog user={u} busy={busy} onClose={close}
        onMerge={async (keep, reason) => after(await run('merge', u.id, { payload: { into: keep }, reason, ok: t('um.merged_ok', 'Accounts merged') }))} />}
      <SuspendDialog open={dialog === 'suspend'} user={u} busy={busy} onClose={close}
        onConfirm={async (reason, until) => after(await run('suspend', u.id, { payload: { until: until || null }, reason, ok: t('um.suspended_ok', 'Suspended and signed out'),
          undo: () => run('reactivate', u.id, { ok: t('um.reactivated_ok', 'Reactivated') }) }))} />
      {(['reactivate', 'force_sign_out', 'password_reset', 'resend_verification', 'mfa_reset', 'soft_delete', 'restore', 'anonymise', 'delete', 'unmerge'] as const).map((a) => (
        <ReasonDialog key={a} open={dialog === a} busy={busy} onClose={close} {...confirmCopy(t, a, u)} onConfirm={act(a, confirmCopy(t, a, u).ok)} />
      ))}
    </div>
  );
}

function SuspendDialog({ open, user, busy, onClose, onConfirm }: { open: boolean; user: UserRow; busy: boolean; onClose: () => void; onConfirm: (reason: string, until: string) => void }) {
  const { t } = useTranslation();
  const [until, setUntil] = useState('');
  const minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return (
    <ReasonDialog open={open} busy={busy} needsReason destructive onClose={onClose}
      title={t('um.suspend_title', 'Suspend {{name}}?', { name: user.name || user.email })}
      description={t('um.suspend_desc', 'They are signed out now, cannot sign in, and their consultant profile leaves the directory and matching. The reason is shown in this console.')}
      confirmLabel={t('um.suspend', 'Suspend')} onConfirm={(r) => onConfirm(r, until ? `${until}T00:00:00Z` : '')}>
      <div className="space-y-1.5">
        <Label htmlFor="um-until">{t('um.until_optional', 'Automatically end on (optional)')}</Label>
        <Input id="um-until" type="date" min={minDate} value={until} onChange={(e) => setUntil(e.target.value)} className="max-w-48" />
      </div>
    </ReasonDialog>
  );
}

function Overview({ u, data, onOpenConsultant }: { u: UserRow & { invited_at?: string }; data: Record<string, any>; onOpenConsultant: (id: string) => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { t } = useTranslation();
  const row = (label: string, value: React.ReactNode) => <><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{value ?? '—'}</dd></>;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {row(t('um.phone', 'Phone'), u.phone ? <span dir="ltr">{u.phone}</span> : '—')}
        {row(t('um.company', 'Company'), u.company)}
        {row(t('um.country', 'Country'), u.country)}
        {row(t('um.sign_in_with', 'Signs in with'), u.providers?.length ? u.providers.map((p) => p === 'google' ? 'Google' : t('um.email_password', 'E-mail')).join(', ') : '—')}
        {row(t('um.email_verified', 'E-mail verified'), u.email_verified ? t('um.yes', 'Yes') : t('um.no', 'No'))}
        {row(t('um.two_step_title', 'Two-step sign-in'), u.mfa_enabled ? t('um.on', 'On') : t('um.off', 'Off'))}
        {row(t('um.joined', 'Joined'), fmtDate(u.created_at, true))}
        {row(t('um.last_sign_in', 'Last sign-in'), fmtDate(u.last_sign_in_at, true))}
        {row(t('um.last_active', 'Last active'), fmtDate(u.last_active_at, true))}
        {row(t('um.user_id', 'User ID'), <span className="font-mono text-xs" dir="ltr">{u.id}</span>)}
      </dl>
      {data.organisations?.length > 0 && (
        <section aria-labelledby="um-org-h" className="space-y-1">
          <h3 id="um-org-h" className="font-semibold">{t('um.organisations', 'Organisations')}</h3>
          {data.organisations.map((o: { tenant_id: string; name: string; org_role: string }) => <p key={o.tenant_id}>{o.name} · <span className="text-muted-foreground">{o.org_role}</span></p>)}
        </section>
      )}
      <section aria-labelledby="um-link-h" className="space-y-2">
        <h3 id="um-link-h" className="font-semibold">{t('um.linked_records', 'Linked records')}</h3>
        {u.consultant_id && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
            <span>{t('um.role_consultant', 'Consultant')} · {u.verification_status ? verificationLabel(t, u.verification_status) : '—'}{u.completion != null ? ` · ${u.completion}%` : ''}{u.badge ? ` · ${u.badge}` : ''}</span>
            <Button size="sm" variant="outline" onClick={() => onOpenConsultant(u.consultant_id!)}>{t('admin.fullProfile.view', 'View full profile')}</Button>
            <Button size="sm" variant="ghost" asChild><Link to={`/admin/approvals?consultant=${u.consultant_id}`}>{t('um.verification', 'Verification')}</Link></Button>
          </div>
        )}
        {u.roles.includes('client') && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
            <span>{t('um.role_client', 'Client')}{u.client_approval ? ` · ${u.client_approval.replace(/_/g, ' ')}` : ''}</span>
            {u.client_approval && <Button size="sm" variant="ghost" asChild><Link to={`/admin/client-approvals?user=${u.id}`}>{t('um.review_client', 'Review client')}</Link></Button>}
          </div>
        )}
        {data.counts && <p className="text-xs text-muted-foreground">{t('um.counts', '{{a}} tickets as client · {{b}} as consultant · {{c}} bids · {{d}} payments', { a: data.counts.tickets_as_client, b: data.counts.tickets_as_consultant, c: data.counts.bids, d: data.counts.payments })}</p>}
        {(data.recent_tickets ?? []).length > 0 && (
          <ul className="space-y-1">
            {data.recent_tickets.map((tk: { id: string; title: string; status: string }) => <li key={tk.id}><Link className="text-primary underline-offset-2 hover:underline" to={`/admin/tickets/${tk.id}`}>{tk.title}</Link> <span className="text-xs text-muted-foreground">· {tk.status.replace(/_/g, ' ')}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

function deviceName(ua: string | null | undefined) {
  if (!ua) return '—';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 60);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flagLabel(t: any, f: string) {
  return ({
    disposable_email: t('um.flag_disposable', 'Disposable e-mail'), suppressed_email: t('um.flag_suppressed', 'E-mails blocked'),
    many_networks: t('um.flag_networks', '3+ networks this week'), failed_sign_ins: t('um.flag_failed', 'Many failed sign-ins'),
    admin_without_mfa: t('um.flag_admin_mfa', 'Admin without two-step sign-in'), never_signed_in: t('um.flag_never', 'Never signed in'),
  } as Record<string, string>)[f] ?? f;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function actionLabel(t: any, a: string) {
  const k = a.replace(/^admin_user[._]/, '');
  const known: Record<string, string> = {
    login: t('um.a_login', 'Signed in'), logout: t('um.a_logout', 'Signed out'), login_failed: t('um.a_login_failed', 'Failed sign-in'),
    login_preflight_failed: t('um.a_login_failed', 'Failed sign-in'), viewed: t('um.a_viewed', 'Details viewed by an admin'),
    set_roles: t('um.a_set_roles', 'Roles changed'), update_profile: t('um.a_update_profile', 'Profile edited by an admin'),
    set_tags: t('um.a_set_tags', 'Tags changed'), add_note: t('um.a_add_note', 'Internal note added'), delete_note: t('um.a_delete_note', 'Internal note deleted'),
    notify: t('um.a_notify', 'Notification sent'), suspend: t('um.a_suspend', 'Suspended'), reactivate: t('um.a_reactivate', 'Reactivated'),
    force_sign_out: t('um.a_force_sign_out', 'Signed out everywhere'), password_reset: t('um.a_password_reset', 'Password reset sent'),
    resend_verification: t('um.a_resend', 'Verification e-mail resent'), mfa_reset: t('um.a_mfa_reset', 'Two-step sign-in reset'),
    soft_delete: t('um.a_soft_delete', 'Deleted (restorable)'), restore: t('um.a_restore', 'Restored'), anonymised: t('um.a_anonymised', 'Anonymised'),
    hard_delete: t('um.a_hard_delete', 'Deleted permanently'), merge: t('um.a_merge', 'Merged into another account'), unmerge: t('um.a_unmerge', 'Unmerged'),
    gdpr_export: t('um.a_gdpr', 'Personal data exported'), export_users: t('um.a_export_users', 'User list exported'), export_audit: t('um.a_export_audit', 'History exported'),
    invite: t('um.a_invite', 'Invitation sent'), bulk_invite: t('um.a_bulk_invite', 'Invitations sent'),
  };
  return known[k] ?? k.replace(/[._]/g, ' ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function confirmCopy(t: any, a: string, u: UserRow) {
  const n = u.name || u.email;
  const c: Record<string, { title: string; description: string; confirmLabel: string; ok: string; needsReason?: boolean; destructive?: boolean }> = {
    reactivate: { title: t('um.reactivate_title', 'Reactivate {{n}}?', { n }), description: t('um.reactivate_desc', 'They can sign in again and return to the directory if their profile qualifies.'), confirmLabel: t('um.reactivate', 'Reactivate'), ok: t('um.reactivated_ok', 'Reactivated') },
    force_sign_out: { title: t('um.signout_title', 'Sign {{n}} out everywhere?', { n }), description: t('um.signout_desc', 'All their sessions end now. They can sign in again.'), confirmLabel: t('um.force_sign_out', 'Sign out everywhere'), ok: t('um.signed_out_ok', 'Signed out everywhere'), needsReason: true },
    password_reset: { title: t('um.pw_title', 'Send password reset?'), description: t('um.pw_desc', '{{n}} gets an e-mail with a link to set a new password.', { n }), confirmLabel: t('um.send', 'Send'), ok: t('um.pw_ok', 'Password reset e-mail sent') },
    resend_verification: { title: t('um.verify_title', 'Resend verification e-mail?'), description: t('um.verify_desc', '{{n}} gets a new link to confirm their e-mail address.', { n }), confirmLabel: t('um.send', 'Send'), ok: t('um.verify_ok', 'Verification e-mail sent') },
    mfa_reset: { title: t('um.mfa_title', 'Reset two-step sign-in?'), description: t('um.mfa_desc', 'Their authenticator is removed and they are signed out. Only do this after confirming who they are.'), confirmLabel: t('um.mfa_reset', 'Reset two-step sign-in'), ok: t('um.mfa_ok', 'Two-step sign-in reset'), needsReason: true, destructive: true },
    soft_delete: { title: t('um.delete_title', 'Delete {{n}}?', { n }), description: t('um.delete_desc', 'They are signed out and hidden. You can restore the account for 30 days; after that a super admin can anonymise it.'), confirmLabel: t('um.delete_short', 'Delete'), ok: t('um.deleted_ok', 'Deleted — restorable for 30 days'), needsReason: true, destructive: true },
    restore: { title: t('um.restore_title', 'Restore {{n}}?', { n }), description: t('um.restore_desc', 'The account can sign in again.'), confirmLabel: t('um.restore', 'Restore'), ok: t('um.restored_ok', 'Restored') },
    anonymise: { title: t('um.anon_title', 'Anonymise {{n}}?', { n }), description: t('um.anon_desc', 'Their e-mail, name, phone and sign-in methods are removed for good. Tickets and invoices stay, without personal details. This cannot be undone.'), confirmLabel: t('um.anonymise', 'Anonymise'), ok: t('um.anon_ok', 'Anonymised'), needsReason: true, destructive: true },
    delete: { title: t('um.hard_title', 'Delete {{n}} permanently?', { n }), description: t('um.hard_desc', 'The account is removed and cannot be restored. Records linked to it may be removed too. Prefer Anonymise.'), confirmLabel: t('um.hard_delete', 'Delete permanently'), ok: t('um.hard_ok', 'Deleted permanently'), needsReason: true, destructive: true },
    unmerge: { title: t('um.unmerge_title', 'Unmerge {{n}}?', { n }), description: t('um.unmerge_desc', 'The account is reactivated and the roles it gave to the other account are removed again.'), confirmLabel: t('um.unmerge', 'Unmerge'), ok: t('um.unmerged_ok', 'Unmerged') },
  };
  return c[a];
}
