import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Brain, Loader2, Play } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useInterviewEligibility } from '@/hooks/useInterviewEligibility';
import { useInterviewWeight } from '@/lib/interviewWeight';
import { BLOCK_TEXT } from '@/lib/interviewStart';

/** Profile-page entry to the AI interview: a working start button, or the exact reason it cannot start and the fix. */
export default function InterviewStartCard() {
  const { t } = useTranslation();
  const { block, data } = useInterviewEligibility();
  const weight = useInterviewWeight();
  if (data?.interviewDone) return null;
  const reason = block ? BLOCK_TEXT[block] : null;
  return (
    <Card className="mb-4 rounded-2xl border-primary/20 bg-primary/5" data-testid="interview-start-card">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Brain aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">{t('interview.card_not_taken', 'AI interview - not taken')}</p>
            <p className="text-xs text-muted-foreground">
              {t('interview.card_weight', 'About 10-15 minutes. It counts for {{weight}}% of your profile completion and earns your badge.', { weight })}
            </p>
            {reason && (
              <p role="status" className="mt-1 flex items-center gap-1.5 text-xs text-foreground">
                {block === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                {t(reason.key, reason.message)}
              </p>
            )}
          </div>
        </div>
        {reason?.action ? (
          <Button asChild size="sm" variant="outline"><Link to={reason.action.to}>{t(reason.action.key, reason.action.label)}</Link></Button>
        ) : !reason ? (
          <Button asChild size="sm" className="gradient-primary text-primary-foreground">
            <Link to="/consultant/interviews?start=1"><Play className="me-1 h-4 w-4" />{t('interview.take_now', 'Take the AI interview')}</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
