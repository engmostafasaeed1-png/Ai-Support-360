// "Words we learned from you": the consultant's own repeated corrections that are used only as extra hints for their
// own interviews, with delete buttons; optional accent group (helps choose the best speech model); recording consent.
// Hidden until the learning database update is applied.
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AudioLines, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useMyVoiceLearning } from '@/hooks/useMyVoiceLearning';
import { ACCENT_GROUPS } from '../../../supabase/functions/_shared/voiceRouting';
import VoiceTrainingConsent from './VoiceTrainingConsent';

export const ACCENT_LABELS: Record<string, string> = {
  egyptian: 'Egyptian Arabic', gulf: 'Gulf Arabic', levantine: 'Levantine Arabic', maghrebi: 'Maghrebi Arabic', iraqi: 'Iraqi Arabic',
  indian: 'Indian English', pakistani: 'Pakistani English', british: 'British English', american: 'American English',
  european: 'European English', african: 'African English', other: 'Other',
};

export default function MyVoiceLearningCard() {
  const { t } = useTranslation();
  const { data, isLoading, deleteTerm, setAccent } = useMyVoiceLearning();
  if (isLoading || !data) return null;

  const remove = async (key: string | null) => {
    const ok = await deleteTerm(key);
    if (ok) toast.success(key ? t('voice.learn.deleted_one', 'Word deleted') : t('voice.learn.deleted_all', 'All learned words deleted'));
    else toast.error(t('voice.learn.delete_error', 'Could not delete. Please try again.'));
  };

  return (
    <Card className="border-border/40 md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><AudioLines className="w-4 h-4" />{t('voice.learn.title', 'Voice answers: words we learned from you')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('voice.learn.intro', 'When you correct the same word in your spoken answers more than once, we remember it and use it only for your own future answers. No recordings are kept for this. You can delete any word.')}
        </p>
        {!data.learning && <p className="text-xs text-muted-foreground">{t('voice.learn.paused', 'Learning is paused by the administrators at the moment.')}</p>}

        {data.terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('voice.learn.empty', 'Nothing learned yet.')}</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
            {data.terms.map((w) => (
              <li key={`${w.term_key}-${w.heard}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-muted-foreground line-through decoration-muted-foreground/50">{w.heard}</span>
                  <span className="mx-2 text-muted-foreground" aria-hidden="true">→</span>
                  <span className="font-medium text-foreground" dir="auto">{w.term}</span>
                  <span className="ms-2 text-xs text-muted-foreground">{t('voice.learn.times', '{{n}} times', { n: w.count })}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => void remove(w.term_key)} aria-label={t('voice.learn.delete_word', 'Delete {{word}}', { word: w.term })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {data.terms.length > 1 && (
          <Button variant="outline" size="sm" onClick={() => void remove(null)}>{t('voice.learn.delete_all', 'Delete all learned words')}</Button>
        )}

        <div className="space-y-1">
          <Label htmlFor="voice-accent" className="text-sm">{t('voice.learn.accent', 'How do you usually speak? (optional)')}</Label>
          <select id="voice-accent" value={data.accent ?? ''} onChange={(e) => void setAccent(e.target.value || null)}
            className="w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="">{t('voice.learn.accent_none', 'Prefer not to say')}</option>
            {ACCENT_GROUPS.map((g) => <option key={g} value={g}>{t(`voice.learn.accent_${g}`, ACCENT_LABELS[g])}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">{t('voice.learn.accent_hint', 'Only used to pick the speech model that understands this way of speaking best. Never shown to clients.')}</p>
        </div>

        <VoiceTrainingConsent className="text-foreground" />
      </CardContent>
    </Card>
  );
}
