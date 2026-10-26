// Admin: review consultants' success stories (verify with evidence, hide or reject with a reason, restore). Audited in the database.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { safeRpc } from '@/lib/safeRpc';
import { achievementErrorKey, type AchievementStatus } from '@/lib/achievements';
import AchievementStatusBadge from '@/components/consultant/AchievementStatusBadge';

type Row = { id: string; consultant_name: string; title: string; outcome: string; industry: string | null; sap_area: string | null; year: number | null;
  reference_url: string | null; evidence_path: string | null; is_public: boolean; status: AchievementStatus; review_reason: string | null };

export default function AdminAchievementsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('self_declared');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-achievements', status],
    queryFn: async () => {
      const { data, error } = await safeRpc('admin_achievements', { _status: status === 'all' ? null : status });
      return { applied: !error, rows: (Array.isArray(data) ? data : []) as Row[] };
    },
  });
  const act = async (r: Row, action: 'verify' | 'hide' | 'reject' | 'restore') => {
    setBusy(r.id + action);
    const { error } = await safeRpc('admin_achievement_review', { _id: r.id, _action: action, _reason: reasons[r.id] ?? null });
    setBusy(null);
    if (error) return toast.error(t(achievementErrorKey(error.message), t('achievements.err_generic', 'Could not save. Check the text and try again.')));
    toast.success(t('roles.admin_saved', 'Saved'));
    qc.invalidateQueries({ queryKey: ['admin-achievements'] });
  };
  const openEvidence = async (path: string) => {
    const { data, error } = await supabase.storage.from('achievement-evidence').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return toast.error(t('achievements.err_generic', 'Could not save. Check the text and try again.'));
    window.open(data.signedUrl, '_blank', 'noopener');
  };
  const reasonShort = (id: string) => (reasons[id] ?? '').trim().length < 5;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('achievements.admin_title', 'Success stories')}</h1>
          <p className="text-sm text-muted-foreground">{t('achievements.admin_hint', 'Verify a story only after checking its evidence or reference. Hiding or rejecting needs a reason the consultant will see.')}</p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48" aria-label={t('roles.admin_category', 'Category')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {['self_declared', 'verified', 'hidden', 'rejected', 'all'].map((s) => <SelectItem key={s} value={s}>{t(`achievements.f_status_${s}`, s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </header>
      {q.data && !q.data.applied && <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">{t('achievements.admin_not_applied', 'Success stories are not in the database yet. They start after the prepared database update is applied.')}</p>}
      {q.data?.applied && q.data.rows.length === 0 && <p className="text-sm text-muted-foreground">{t('achievements.admin_empty', 'Nothing to review.')}</p>}
      {(q.data?.rows ?? []).map((r) => (
        <Card key={r.id} className="rounded-2xl border-border/50">
          <CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-foreground">{r.title}</p>
                <p className="text-xs text-muted-foreground">{[r.consultant_name, r.sap_area, r.industry, r.year].filter(Boolean).join(' · ')}{r.is_public ? '' : ` · ${t('achievements.private', 'private')}`}</p>
              </div>
              <AchievementStatusBadge status={r.status} />
            </div>
            <p className="text-sm text-foreground">{r.outcome}</p>
            <div className="flex flex-wrap gap-3 text-xs">
              {r.reference_url && <a className="text-primary underline" href={r.reference_url} target="_blank" rel="noopener noreferrer nofollow">{r.reference_url}</a>}
              {r.evidence_path && <button type="button" className="text-primary underline" onClick={() => openEvidence(r.evidence_path!)}>{t('achievements.open_evidence', 'Open evidence (1 minute link)')}</button>}
            </div>
            {r.review_reason && <p className="text-xs text-muted-foreground">{t('achievements.admin_reason', 'Admin note: {{r}}', { r: r.review_reason })}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-8 max-w-sm text-xs" maxLength={500} placeholder={t('achievements.reason_ph', 'Reason (needed to hide or reject)')} value={reasons[r.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })} />
              <Button size="sm" onClick={() => act(r, 'verify')} busy={busy === r.id + 'verify'}
                reason={(r.status === 'verified' && 'already_done') || (!r.evidence_path && !r.reference_url && { key: 'fix_errors_first', message: t('achievements.err_no_evidence', 'Add evidence or a reference link before it can be verified.') })}>{t('achievements.verify', 'Verify')}</Button>
              <Button size="sm" variant="outline" onClick={() => act(r, 'hide')} busy={busy === r.id + 'hide'} reason={(r.status === 'hidden' && 'already_done') || (reasonShort(r.id) && 'fill_required_fields')}>{t('achievements.hide', 'Hide')}</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => act(r, 'reject')} busy={busy === r.id + 'reject'} reason={(r.status === 'rejected' && 'already_done') || (reasonShort(r.id) && 'fill_required_fields')}>{t('achievements.reject', 'Reject')}</Button>
              <Button size="sm" variant="ghost" onClick={() => act(r, 'restore')} busy={busy === r.id + 'restore'} reason={r.status === 'self_declared' && 'already_done'}>{t('achievements.restore', 'Restore')}</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
