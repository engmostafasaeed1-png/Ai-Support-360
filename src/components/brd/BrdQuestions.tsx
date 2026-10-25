import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BrdQuestion } from '../../../supabase/functions/_shared/brdModel';

interface Props {
  questions: BrdQuestion[];
  onChange: (q: BrdQuestion[]) => void;
  onUseAnswers?: () => void;
  busy?: boolean;
  readOnly?: boolean;
  dir: 'ltr' | 'rtl';
}

/** "Questions to complete the requirements" (max 8): one tap on a suggested answer, or free text. */
export default function BrdQuestions({ questions, onChange, onUseAnswers, busy, readOnly, dir }: Props) {
  const { t } = useTranslation();
  if (questions.length === 0) return null;
  const answered = questions.filter((q) => q.answer.trim()).length;
  const set = (i: number, answer: string) => onChange(questions.map((q, j) => (j === i ? { ...q, answer } : q)));
  return (
    <section aria-labelledby="brd-questions" className="rounded-2xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div>
        <h3 id="brd-questions" className="font-semibold text-sm">{t('brd.questions.heading')}</h3>
        <p className="text-xs text-muted-foreground">{t('brd.questions.hint', { answered, total: questions.length })}</p>
      </div>
      <ol className="space-y-3">
        {questions.map((q, i) => (
          <li key={q.id} className="space-y-1.5">
            <p className="text-sm font-medium" dir={dir}>{i + 1}. {q.question}</p>
            {q.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('brd.questions.options')}>
                {q.options.map((o) => (
                  <Button key={o} type="button" size="sm" variant={q.answer === o ? 'default' : 'outline'} className="h-7 text-xs rounded-full"
                    aria-pressed={q.answer === o} reason={readOnly && 'not_editable_now'} onClick={() => set(i, q.answer === o ? '' : o)}>{o}</Button>
                ))}
              </div>
            )}
            <Input dir={dir} value={q.answer} maxLength={1000} readOnly={readOnly} className="h-8 text-sm"
              aria-label={t('brd.questions.answerFor', { n: i + 1 })} placeholder={t('brd.questions.free')} onChange={(e) => set(i, e.target.value)} />
          </li>
        ))}
      </ol>
      {onUseAnswers && !readOnly && (
        <Button type="button" size="sm" className="gap-1.5" busy={busy} reason={answered === 0 && 'answer_required'} onClick={onUseAnswers}>
          <Sparkles className="h-3.5 w-3.5" /> {t('brd.questions.update')}
        </Button>
      )}
    </section>
  );
}
