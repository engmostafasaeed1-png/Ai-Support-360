// Interviewer learning: how each repeated interview question performs (average score, skip rate, "did not understand"
// rate, hand-corrected spoken answers, time to answer). Flagged questions get rule-based rewrite hints; administrators
// retire, edit (library questions) or add a good generated question to the library. Nothing changes automatically.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageCircleQuestion } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { safeRpc } from '@/lib/safeRpc';
import { flagSentence, rate, rewriteHints, type QuestionFlag } from '../../../../supabase/functions/_shared/questionQuality';

interface Row {
  question_key: string; question: string; sap_module: string | null; source_type: string | null; library_id: string | null;
  answers: number; skips: number; confusions: number; avg_score: number | null; voice_answers: number; edited: number; avg_answer_ms: number | null;
  flags: QuestionFlag[]; library_candidate: boolean; status: string; admin_note: string | null;
}

export default function QuestionQualityPanel({ reason }: { reason: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'flagged' | 'candidates' | 'retired' | 'all'>('flagged');
  const [draft, setDraft] = useState<{ key: string; text: string; action: 'edit' | 'add_to_library' } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useQuery({
    queryKey: ['voice-learning', 'questions', filter],
    queryFn: async () => {
      const { data, error } = await safeRpc<Row[]>('admin_interview_question_stats', { _filter: filter, _limit: 200 });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const act = async (key: string, action: 'retire' | 'restore' | 'edit' | 'add_to_library', text: string | null) => {
    if (reason.trim().length < 3) { toast.error(t('voice.learnadmin.reason_needed', 'Please write a short reason first (saved with the change).')); return; }
    setBusy(true);
    const { error } = await safeRpc('admin_interview_question_action', { _key: key, _action: action, _text: text, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDraft(null);
    toast.success(t('voice.learnadmin.saved', 'Saved'));
    void qc.invalidateQueries({ queryKey: ['voice-learning', 'questions'] });
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><MessageCircleQuestion className="h-4 w-4 text-primary" />{t('voice.qq.title', 'Interview questions: how they perform')}</CardTitle>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs" aria-label={t('voice.learnadmin.filter', 'Show')}>
          <option value="flagged">{t('voice.qq.f_flagged', 'Flagged')}</option>
          <option value="candidates">{t('voice.qq.f_candidates', 'Good questions for the library')}</option>
          <option value="retired">{t('voice.qq.f_retired', 'Retired')}</option>
          <option value="all">{t('voice.qq.f_all', 'All')}</option>
        </select>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('voice.qq.intro', 'Questions asked to at least 10 candidates are checked every night. A flag is a hint; nothing changes until you act.')}</p>
        {rows.isLoading ? <Skeleton className="h-24 w-full" /> : !(rows.data ?? []).length ? (
          <p className="text-sm text-muted-foreground">{t('voice.learnadmin.none', 'Nothing here.')}</p>
        ) : (rows.data ?? []).map((r) => {
          const hints = rewriteHints(r.question, r.flags);
          return (
            <div key={r.question_key} className="rounded-xl border border-border/60 p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground max-w-3xl" dir="auto">{r.question}</p>
                <div className="flex flex-wrap gap-1">
                  {r.sap_module && <Badge variant="outline">{r.sap_module}</Badge>}
                  <Badge variant="secondary">{r.library_id ? t('voice.qq.library', 'Library') : t('voice.qq.generated', 'Generated')}</Badge>
                  {r.status === 'retired' && <Badge variant="destructive">{t('voice.qq.retired', 'Retired')}</Badge>}
                </div>
              </div>
              {r.flags.map((f) => <p key={f} className="text-sm text-destructive">{t(`voice.qq.flag_${f}`, flagSentence(f, r), { n: f === 'misunderstood' ? rate(r.confusions, r.answers) : f === 'skipped' ? rate(r.skips, r.answers) : f === 'hard_to_transcribe' ? rate(r.edited, r.voice_answers) : Math.round(r.avg_score ?? 0) })}</p>)}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t('voice.qq.answers', '{{n}} candidates', { n: r.answers })}</span>
                <span>{t('voice.qq.score', 'Average score {{n}}', { n: r.avg_score ?? '—' })}</span>
                <span>{t('voice.qq.skip', 'Skipped {{n}} %', { n: rate(r.skips, r.answers) })}</span>
                <span>{t('voice.qq.confused', 'Did not understand {{n}} %', { n: rate(r.confusions, r.answers) })}</span>
                <span>{t('voice.qq.edited', 'Spoken answers corrected {{n}} %', { n: rate(r.edited, r.voice_answers) })}</span>
                <span>{t('voice.qq.time', 'Time to answer {{n}} s', { n: r.avg_answer_ms != null ? Math.round(r.avg_answer_ms / 1000) : '—' })}</span>
              </div>
              {!!hints.length && (
                <ul className="list-disc ps-5 text-xs text-foreground">
                  {hints.map((h) => <li key={h.key}>{t(`voice.qq.hint_${h.key}`, h.text)}</li>)}
                </ul>
              )}
              {draft?.key === r.question_key ? (
                <div className="space-y-2">
                  <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={3} maxLength={2000} dir="auto" aria-label={t('voice.qq.new_text', 'New wording')} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void act(r.question_key, draft.action, draft.text)}>{draft.action === 'edit' ? t('voice.qq.save', 'Save wording') : t('voice.qq.add', 'Add to library')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t('common.cancel', 'Cancel')}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {r.status === 'active'
                    ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(r.question_key, 'retire', null)}>{t('voice.qq.retire', 'Retire')}</Button>
                    : <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(r.question_key, 'restore', null)}>{t('voice.qq.restore', 'Use again')}</Button>}
                  {r.library_id
                    ? <Button size="sm" variant="ghost" onClick={() => setDraft({ key: r.question_key, text: r.question, action: 'edit' })}>{t('voice.qq.edit', 'Edit wording')}</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setDraft({ key: r.question_key, text: r.question, action: 'add_to_library' })}>{r.library_candidate ? t('voice.qq.approve_lib', 'Approve for the library') : t('voice.qq.rewrite_lib', 'Rewrite into the library')}</Button>}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
