import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { Chip } from '../../../supabase/functions/_shared/ticketMatch';
import { chipText } from '@/lib/matchLabels';

/** "Why this match": up to 4 short reasons from the deterministic ranking, plus the match %. */
export default function MatchWhyChips({ why, score, coverage, showCoverage = false }: { why?: Chip[] | null; score?: number | null; coverage?: number | null; showCoverage?: boolean }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  if (!why?.length && score == null) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label={ar ? 'سبب هذا التطابق' : 'Why this match'}>
      {score != null && (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
          <Sparkles className="h-2.5 w-2.5" aria-hidden /> {ar ? `تطابق ${score}%` : `${score}% match`}
        </span>
      )}
      {(why ?? []).slice(0, 4).map((c) => (
        <span key={`${c.key}-${c.text}`} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-foreground">
          {chipText(c.key, c.text, ar)}
        </span>
      ))}
      {showCoverage && coverage != null && (
        <span className="text-[10px] text-muted-foreground" title={ar ? 'نسبة الدرجة المستندة إلى بيانات مثبتة' : 'Share of the score backed by verified evidence'}>
          {ar ? `ثقة التطابق ${coverage}%` : `Match confidence ${coverage}%`}
        </span>
      )}
    </div>
  );
}
