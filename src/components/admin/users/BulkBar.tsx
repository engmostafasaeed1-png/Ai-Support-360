import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Bell, CheckCircle2, Download, Megaphone, Tag, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBulkAccess } from '@/hooks/useBulkMessaging';
import { SELECTED_KEY } from '@/lib/bulkMessaging';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BULK_LIMIT, reasonOk } from '@/lib/userAdmin';
import { callEdge, callRpc, useInvalidateUsers } from '@/hooks/useUserAdmin';
import { ReasonDialog } from './UserDialogs';

type Kind = 'tag_add' | 'tag_remove' | 'remind' | 'bulk_suspend' | 'bulk_reactivate';
interface Preview { eligible: string[]; skipped: Array<{ id: string; reason: string }> }

export default function BulkBar({ ids, total, installed, perms, onClear, onSelectMatching, onExport }: {
  ids: string[]; total: number; installed: boolean; perms: string[]; onClear: () => void; onSelectMatching: () => void; onExport: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateUsers();
  const [kind, setKind] = useState<Kind | null>(null);
  const [tags, setTags] = useState('');
  const [remind, setRemind] = useState<'profile' | 'policy' | 'interview'>('profile');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const can = (p: string) => perms.includes(p);
  const navigate = useNavigate();
  const messaging = useBulkAccess();
  // Feature R: hand the selection to Messages / Campaigns (this tab only); the database re-checks every person.
  const messageSelected = () => { sessionStorage.setItem(SELECTED_KEY, JSON.stringify(ids)); navigate('/admin/messages?tab=compose'); };
  const over = ids.length > BULK_LIMIT;

  const payload = () => kind === 'remind' ? { kind: remind } : { tags: tags.split(',').map((s) => s.trim()).filter(Boolean) };
  const edgeKind = (k: Kind | null) => k === 'bulk_suspend' || k === 'bulk_reactivate';
  const isEdge = edgeKind(kind);

  const dryRun = async (k: Kind | null = kind) => {
    if (!k) return;
    setBusy(true);
    try {
      const r = edgeKind(k)
        ? await callEdge<Preview>('admin-manage-user', { action: k, user_ids: ids, dry_run: true })
        : await callRpc<Preview>('admin_users_bulk', { _action: k, _ids: ids, _payload: payload(), _dry_run: true });
      setPreview(r);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const runIt = async (reason?: string) => {
    if (!kind) return;
    setBusy(true);
    try {
      const r = isEdge
        ? await callEdge<{ done: number; run_id?: string; undo_until?: string }>('admin-manage-user', { action: kind, user_ids: ids, dry_run: false, reason })
        : await callRpc<{ done: number; run_id?: string; undo_until?: string }>('admin_users_bulk', { _action: kind, _ids: ids, _payload: { ...payload(), reason }, _dry_run: false });
      invalidate();
      const runId = r.run_id;
      toast.success(t('um.bulk_done', '{{n}} updated', { n: r.done }), runId && r.undo_until ? {
        duration: 15_000,
        action: { label: t('um.undo', 'Undo'), onClick: async () => {
          try {
            if (isEdge) await callEdge('admin-manage-user', { action: 'bulk_undo', run_id: runId });
            else await callRpc('admin_bulk_undo', { _run_id: runId });
            invalidate(); toast.success(t('um.undone', 'Undone'));
          } catch (e) { toast.error((e as Error).message); }
        } },
      } : undefined);
      setKind(null); setPreview(null); onClear();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const open = (k: Kind) => { setKind(k); setPreview(null); if (edgeKind(k)) dryRun(k); };
  const title = kind ? ({
    tag_add: t('um.bulk_tag_add', 'Add tags'), tag_remove: t('um.bulk_tag_remove', 'Remove tags'), remind: t('um.bulk_remind', 'Send reminder'),
    bulk_suspend: t('um.bulk_suspend', 'Suspend selected'), bulk_reactivate: t('um.bulk_reactivate', 'Reactivate selected'),
  } as Record<Kind, string>)[kind] : '';

  return (
    <div className="sticky bottom-3 z-20 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card p-3 shadow-lg" role="region" aria-label={t('um.bulk_actions', 'Bulk actions')}>
      <span className="text-sm font-medium" aria-live="polite">{t('um.n_selected', '{{n}} selected', { n: ids.length })}</span>
      {ids.length < Math.min(total, BULK_LIMIT) && <Button size="sm" variant="link" className="h-7 px-1" onClick={onSelectMatching}>{t('um.select_matching', 'Select all {{n}} matching', { n: Math.min(total, BULK_LIMIT) })}</Button>}
      {over && <span className="text-xs text-destructive">{t('um.bulk_limit', 'At most {{n}} per run', { n: BULK_LIMIT })}</span>}
      <div className="ms-auto flex flex-wrap gap-1.5">
        {installed && can('users.edit') && <Button size="sm" variant="outline" disabled={over} onClick={() => open('tag_add')}><Tag className="me-1 h-4 w-4" />{t('um.tag', 'Tag')}</Button>}
        {installed && can('users.edit') && <Button size="sm" variant="outline" disabled={over} onClick={() => open('tag_remove')}>{t('um.untag', 'Untag')}</Button>}
        {installed && can('users.message') && <Button size="sm" variant="outline" disabled={over} onClick={() => open('remind')}><Bell className="me-1 h-4 w-4" />{t('um.remind', 'Remind')}</Button>}
        {installed && can('users.suspend') && <Button size="sm" variant="outline" disabled={over} onClick={() => open('bulk_suspend')}><Ban className="me-1 h-4 w-4" />{t('um.suspend', 'Suspend')}</Button>}
        {installed && can('users.suspend') && <Button size="sm" variant="outline" disabled={over} onClick={() => open('bulk_reactivate')}><CheckCircle2 className="me-1 h-4 w-4" />{t('um.reactivate', 'Reactivate')}</Button>}
        {messaging.state === 'ready' && <Button size="sm" variant="outline" onClick={messageSelected}><Megaphone className="me-1 h-4 w-4" />{t('bmsg.message_users', 'Message users')}</Button>}
        {can('users.export') && <Button size="sm" variant="outline" onClick={onExport}><Download className="me-1 h-4 w-4" />{t('um.export', 'Export')}</Button>}
        <Button size="sm" variant="ghost" onClick={onClear} aria-label={t('um.clear_selection', 'Clear selection')}><X className="h-4 w-4" /></Button>
      </div>

      <Dialog open={!!kind && !isEdge && !preview} onOpenChange={(o) => !o && setKind(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t('um.bulk_preview_first', 'You will see who is included before anything changes.')}</DialogDescription></DialogHeader>
          {(kind === 'tag_add' || kind === 'tag_remove') && (
            <div className="space-y-1.5"><Label htmlFor="um-bulk-tags">{t('um.tags_comma', 'Tags (comma separated)')}</Label><Input id="um-bulk-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, key account" /></div>
          )}
          {kind === 'remind' && (
            <div className="space-y-1.5">
              <Label>{t('um.reminder_type', 'Reminder')}</Label>
              <Select value={remind} onValueChange={(v) => setRemind(v as typeof remind)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="profile">{t('um.remind_profile', 'Complete profile')}</SelectItem>
                  <SelectItem value="policy">{t('um.remind_policy', 'Confirm service policy')}</SelectItem>
                  <SelectItem value="interview">{t('um.remind_interview', 'Take the AI interview')}</SelectItem>
                </SelectContent></Select>
              <p className="text-xs text-muted-foreground">{t('um.remind_hint', 'Consultants only. Anyone already done or reminded in the last 24 hours is skipped.')}</p>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setKind(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button disabled={busy || ((kind === 'tag_add' || kind === 'tag_remove') && !tags.trim())} onClick={() => dryRun()}>{t('um.preview', 'Preview')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkConfirm open={!!preview} preview={preview} title={title} needsReason={kind === 'bulk_suspend'} busy={busy}
        onClose={() => { setPreview(null); setKind(null); }} onConfirm={(reason) => runIt(reason)} />
    </div>
  );
}

function BulkConfirm({ open, preview, title, needsReason, busy, onClose, onConfirm }: {
  open: boolean; preview: Preview | null; title: string; needsReason: boolean; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const reasons: Record<string, string> = {
    self: t('um.skip_self', 'your own account'), admin_needs_super: t('um.skip_admin', 'admins (super admin only)'), super_admin: t('um.skip_super', 'super admins'),
    deleted_or_merged: t('um.skip_deleted', 'deleted or merged'), not_found: t('um.skip_not_found', 'not found'), not_consultant: t('um.skip_not_consultant', 'not consultants'),
    suspended: t('um.skip_suspended', 'suspended'), already_done: t('um.skip_done', 'already done'), reminded_recently: t('um.skip_recent', 'reminded in the last 24 h'),
    policy_not_installed: t('um.skip_policy', 'service policy not set up yet'), failed: t('um.skip_failed', 'failed'),
  };
  const counts = (preview?.skipped ?? []).reduce<Record<string, number>>((a, s) => ({ ...a, [s.reason]: (a[s.reason] ?? 0) + 1 }), {});
  return (
    <ReasonDialog open={open} busy={busy} needsReason={needsReason} destructive={needsReason} onClose={onClose} title={title}
      canConfirm={(preview?.eligible.length ?? 0) > 0}
      description={t('um.bulk_will_change', '{{n}} people will be changed.', { n: preview?.eligible.length ?? 0 })}
      confirmLabel={t('um.confirm_n', 'Confirm for {{n}}', { n: preview?.eligible.length ?? 0 })} onConfirm={(r) => (!needsReason || reasonOk(r)) && onConfirm(r)}>
      {Object.keys(counts).length > 0 && (
        <ul className="rounded-xl bg-muted p-3 text-xs">
          {Object.entries(counts).map(([k, n]) => <li key={k}>{t('um.skipped_n', 'Skipped {{n}}: {{why}}', { n, why: reasons[k] ?? k })}</li>)}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('um.undo_window', 'You can undo tags and suspensions for 10 minutes.')}</p>
    </ReasonDialog>
  );
}
