import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { APP_ROLES, MIN_REASON, checkRoleChange, reasonOk, type UserRow } from '@/lib/userAdmin';
import { callRpc } from '@/hooks/useUserAdmin';
import { roleLabel } from './labels';

/** Confirmation with an optional required reason. */
export function ReasonDialog({ open, title, description, confirmLabel, destructive, needsReason, busy, onClose, onConfirm, children, canConfirm = true }: {
  open: boolean; title: string; description: ReactNode; confirmLabel: string; destructive?: boolean; needsReason?: boolean;
  busy?: boolean; onClose: () => void; onConfirm: (reason: string) => void; children?: ReactNode; canConfirm?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setReason(''); setTouched(false); } }, [open]);
  const bad = needsReason && !reasonOk(reason);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!bad && canConfirm) onConfirm(reason.trim()); }}>
          {children}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-reason`}>{needsReason ? t('um.reason_required', 'Reason (required)') : t('um.reason_optional', 'Reason (optional)')}</Label>
            <Textarea id={`${id}-reason`} value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && bad} aria-describedby={`${id}-hint`} />
            <p id={`${id}-hint`} className={touched && bad ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} aria-live="polite">
              {touched && bad ? t('um.reason_short', 'Please write at least {{n}} characters.', { n: MIN_REASON }) : t('um.reason_hint', 'Saved in the history with your name.')}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || !canConfirm}>{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditProfileDialog({ user, phone, language, busy, onClose, onSave }: {
  user: UserRow; phone?: string | null; language?: string | null; busy?: boolean; onClose: () => void;
  onSave: (v: { display_name: string; phone: string; preferred_language: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(user.name);
  const [ph, setPh] = useState(phone ?? '');
  const [lang, setLang] = useState(language === 'ar' ? 'ar' : 'en');
  const phoneBad = !!ph && !/^[+0-9 ()-]{3,30}$/.test(ph);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('um.edit_profile', 'Edit profile basics')}</DialogTitle><DialogDescription>{user.email}</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !phoneBad) onSave({ display_name: name.trim(), phone: ph.trim(), preferred_language: lang }); }}>
          <div className="space-y-1.5"><Label htmlFor="um-name">{t('um.display_name', 'Display name')}</Label><Input id="um-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="um-phone">{t('um.phone', 'Phone')}</Label>
            <Input id="um-phone" value={ph} maxLength={30} inputMode="tel" dir="ltr" onChange={(e) => setPh(e.target.value)} aria-invalid={phoneBad} />
            {phoneBad && <p className="text-xs text-destructive">{t('um.phone_invalid', 'Use digits, spaces, +, ( ) and - only.')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t('um.language', 'Language')}</Label>
            <Select value={lang} onValueChange={setLang}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem></SelectContent></Select>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button type="submit" disabled={busy || !name.trim() || phoneBad}>{t('common.save', 'Save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesDialog({ user, actorId, actorRoles, superAdminCount, fourEyes, busy, onClose, onSave }: {
  user: UserRow; actorId: string; actorRoles: string[]; superAdminCount: number; fourEyes: boolean; busy?: boolean;
  onClose: () => void; onSave: (roles: string[], reason: string) => void;
}) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [reason, setReason] = useState('');
  const check = checkRoleChange({ actorId, actorRoles, targetId: user.id, targetRoles: user.roles, next: roles, superAdminCount, reason, fourEyes });
  const changed = [...roles.filter((r) => !user.roles.includes(r)), ...user.roles.filter((r) => !roles.includes(r))];
  const adminLevel = changed.some((r) => r === 'admin' || r === 'super_admin');
  const isSuper = actorRoles.includes('super_admin');
  const msg: Record<string, string> = {
    self: t('um.err_self_role', 'You cannot change your own roles.'),
    needs_super: t('um.err_needs_super', 'Only a super admin can grant or remove admin and super admin.'),
    reason: t('um.err_reason_admin', 'Please give a reason for an admin role change.'),
    last_super: t('um.err_last_super', 'The last super admin cannot be removed.'),
    unknown_role: t('um.err_unknown_role', 'Unknown role.'),
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('um.change_roles', 'Change roles')}</DialogTitle><DialogDescription>{user.email}</DialogDescription></DialogHeader>
        <fieldset className="space-y-3">
          <legend className="sr-only">{t('um.roles', 'Roles')}</legend>
          {APP_ROLES.map((r) => {
            const locked = (r === 'admin' || r === 'super_admin') && !isSuper;
            return (
              <label key={r} className="flex items-center gap-3 text-sm">
                <Checkbox checked={roles.includes(r)} disabled={locked} onCheckedChange={(v) => setRoles(v ? [...roles, r] : roles.filter((x) => x !== r))} />
                {roleLabel(t, r)}{locked && <span className="text-xs text-muted-foreground">· {t('um.super_only', 'super admin only')}</span>}
              </label>
            );
          })}
        </fieldset>
        {adminLevel && (
          <div className="space-y-1.5">
            <Label htmlFor="um-role-reason">{t('um.reason_required', 'Reason (required)')}</Label>
            <Textarea id="um-role-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {check.ok && check.pendingSuperGrant && <p className="text-xs text-muted-foreground">{t('um.four_eyes_note', 'Granting super admin needs approval by a second super admin. A request will be created.')}</p>}
        {!check.ok && check.error !== 'no_change' && <p className="text-xs text-destructive" role="alert">{msg[check.error]}</p>}
        <p className="text-xs text-muted-foreground">{t('um.roles_hint', 'A person can hold several roles. Changes are recorded and super admins are alerted about admin role changes.')}</p>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button disabled={busy || !check.ok} onClick={() => onSave(roles, reason.trim())}>{t('common.save', 'Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MessageDialog({ user, count, busy, onClose, onSend }: {
  user?: UserRow; count?: number; busy?: boolean; onClose: () => void; onSend: (v: { title: string; body: string; link: string }) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const linkBad = !!link && !/^\/[A-Za-z0-9/_?=&.-]*$/.test(link);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('um.send_message', 'Send a notification')}</DialogTitle>
          <DialogDescription>{user ? user.email : t('um.to_n_people', 'To {{n}} people', { n: count ?? 0 })} · {t('um.message_hint', 'Shown in their notifications; e-mailed if their e-mail notifications are on.')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (title.trim() && body.trim() && !linkBad) onSend({ title: title.trim(), body: body.trim(), link: link.trim() }); }}>
          <div className="space-y-1.5"><Label htmlFor="um-msg-title">{t('um.title', 'Title')}</Label><Input id="um-msg-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="um-msg-body">{t('um.message', 'Message')}</Label><Textarea id="um-msg-body" rows={4} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="um-msg-link">{t('um.link_optional', 'Link on this site (optional)')}</Label>
            <Input id="um-msg-link" value={link} dir="ltr" placeholder="/consultant/profile" onChange={(e) => setLink(e.target.value)} aria-invalid={linkBad} />
            {linkBad && <p className="text-xs text-destructive">{t('um.link_invalid', 'Use a page on this site starting with /.')}</p>}
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button type="submit" disabled={busy || !title.trim() || !body.trim() || linkBad}>{t('um.send', 'Send')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface MergePreview { accounts: Array<{ id: string; email: string; name: string; roles: string[]; status: string; keep: boolean; tickets: number; payments: number; notifications: number }>; effect: string }

/** Merge a duplicate into the account to keep (super admin). The duplicate is suspended and linked; Unmerge reverses it. */
export function MergeDialog({ user, busy, onClose, onMerge }: { user: UserRow; busy?: boolean; onClose: () => void; onMerge: (keepId: string, reason: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<UserRow[]>([]);
  const [keep, setKeep] = useState<UserRow | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) { setMatches([]); return; }
    const h = setTimeout(async () => {
      try {
        const r = await callRpc<{ rows: UserRow[] }>('admin_users_search', { _p: { q: q.trim(), page_size: 10 } });
        setMatches(r.rows.filter((x) => x.id !== user.id));
      } catch (e) { setError((e as Error).message); }
    }, 250);
    return () => clearTimeout(h);
  }, [q, user.id]);
  useEffect(() => {
    if (!keep) { setPreview(null); return; }
    callRpc<MergePreview>('admin_merge_preview', { _keep: keep.id, _merge: user.id }).then(setPreview, (e) => setError((e as Error).message));
  }, [keep, user.id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('um.merge_title', 'Merge duplicate account')}</DialogTitle>
          <DialogDescription>{t('um.merge_desc', '{{email}} will be suspended and linked to the account you keep. You can undo this with Unmerge.', { email: user.email })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="um-merge-q">{t('um.merge_keep', 'Account to keep')}</Label>
            <Input id="um-merge-q" value={q} onChange={(e) => { setQ(e.target.value); setKeep(null); }} placeholder={t('um.search_email', 'Search by name or e-mail')} />
          </div>
          {!keep && matches.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-xl border border-border" role="listbox" aria-label={t('um.merge_keep', 'Account to keep')}>
              {matches.map((m) => (
                <li key={m.id}><button type="button" role="option" aria-selected={false} className="w-full px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => setKeep(m)}>
                  <span className="font-medium">{m.name || m.email}</span> <span className="text-muted-foreground">{m.email}</span></button></li>
              ))}
            </ul>
          )}
          {preview && (
            <div className="grid gap-2 sm:grid-cols-2">
              {preview.accounts.map((a) => (
                <div key={a.id} className="rounded-xl border border-border p-3 text-xs">
                  <Badge variant={a.keep ? 'default' : 'secondary'} className="mb-1">{a.keep ? t('um.keep', 'Keep') : t('um.merge_away', 'Merge away')}</Badge>
                  <p className="font-medium text-sm">{a.name || a.email}</p><p className="text-muted-foreground">{a.email}</p>
                  <p>{t('um.roles', 'Roles')}: {a.roles.map((r) => roleLabel(t, r)).join(', ') || '—'}</p>
                  <p>{t('um.merge_counts', '{{t}} tickets · {{p}} payments · {{n}} notifications', { t: a.tickets, p: a.payments, n: a.notifications })}</p>
                </div>
              ))}
              <p className="sm:col-span-2 text-xs text-muted-foreground">{t('um.merge_effect', 'Client/consultant roles of the merged account are added to the kept account. Tickets, payments and history stay where they are.')}</p>
            </div>
          )}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="um-merge-reason">{t('um.reason_required', 'Reason (required)')}</Label>
            <Textarea id="um-merge-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} />{t('um.merge_ack', 'I checked that both accounts belong to the same person.')}</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="destructive" disabled={busy || !keep || !preview || !ack || !reasonOk(reason)} onClick={() => keep && onMerge(keep.id, reason.trim())}>{t('um.merge', 'Merge')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
