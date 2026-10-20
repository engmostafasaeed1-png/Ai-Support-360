import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ClarifyKey } from '../../../supabase/functions/_shared/ticketMatch';
import { QUESTION_LABELS } from '@/lib/matchLabels';

type Answers = Partial<Record<ClarifyKey, string>>;

/** Shown when the request is too vague to match well: 2-3 short questions; the answers improve the request and matching runs again. */
export default function MatchClarifyingQuestions({ questions, onSubmit }: { questions: ClarifyKey[]; onSubmit: (answers: Answers) => void }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const id = useId();
  const [answers, setAnswers] = useState<Answers>({});
  if (!questions.length) return null;
  const filled = questions.some((q) => answers[q]?.trim());
  return (
    <form
      className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-3"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        const clean: Answers = {};
        for (const q of questions) { const v = answers[q]?.trim().slice(0, 160); if (v) clean[q] = v; }
        onSubmit(clean);
      }}
    >
      <p id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <HelpCircle className="h-4 w-4 text-accent" aria-hidden />
        {ar ? 'ساعدنا في إيجاد المستشار المناسب' : 'Help us find the right consultant'}
      </p>
      <p className="text-xs text-muted-foreground">
        {ar ? 'طلبك مختصر. أجب عن سؤال أو أكثر لتحسين النتائج.' : 'Your request is short. Answer one or more questions to improve the results.'}
      </p>
      {questions.map((q) => (
        <div key={q} className="space-y-1">
          <Label htmlFor={`${id}-${q}`} className="text-xs">{QUESTION_LABELS[q].q[ar ? 1 : 0]}</Label>
          <Input
            id={`${id}-${q}`}
            value={answers[q] ?? ''}
            maxLength={160}
            placeholder={QUESTION_LABELS[q].hint[ar ? 1 : 0]}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
            className="h-9 text-sm"
          />
        </div>
      ))}
      <Button type="submit" size="sm" disabled={!filled}>{ar ? 'تحديث الترشيحات' : 'Update matches'}</Button>
    </form>
  );
}
