import { useTranslation } from 'react-i18next';
import { MessageSquareWarning, MessageCircleReply } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyFeedback } from '@/hooks/useFeedback';
import { openFeedback } from '@/lib/feedback';
import { FEEDBACK_STATUS_LABEL, FEEDBACK_STATUS_TONE, FEEDBACK_TYPE_LABEL } from '@/components/feedback/feedbackLabels';

/** The signed-in person's own reports, their status and the team's replies (internal notes are never included). */
export default function MyFeedbackPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useMyFeedback();
  const fmt = (d: string) => new Date(d).toLocaleString(i18n.language === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <main id="main-content" className="container mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{String(t('feedback.my', { defaultValue: 'My feedback' }))}</h1>
          <p className="text-sm text-muted-foreground">{String(t('feedback.my_sub', { defaultValue: 'Reports you sent, their status and our replies.' }))}</p>
        </div>
        <Button onClick={openFeedback}><MessageSquareWarning aria-hidden="true" className="me-1.5 h-4 w-4" />{String(t('feedback.title', { defaultValue: 'Send feedback' }))}</Button>
      </div>

      {isLoading ? (
        <div className="space-y-3" role="status"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><span className="sr-only">Loading…</span></div>
      ) : !data?.installed ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-sm text-muted-foreground">
          {String(t('feedback.not_ready', { defaultValue: 'Feedback is not available yet.' }))}
        </CardContent></Card>
      ) : data.items.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-sm text-muted-foreground">
          {String(t('feedback.my_empty', { defaultValue: 'You have not sent any feedback yet.' }))}
        </CardContent></Card>
      ) : (
        <ul className="space-y-3">
          {data.items.map((r) => (
            <li key={r.id}>
              <Card className="rounded-2xl">
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="break-words font-semibold" dir="auto">{r.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        {String(t(`feedback.type.${r.type}`, { defaultValue: FEEDBACK_TYPE_LABEL[r.type] }))} · {fmt(r.created_at)}
                      </p>
                    </div>
                    <Badge variant="outline" className={FEEDBACK_STATUS_TONE[r.status]}>
                      {String(t(`feedback.status.${r.status}`, { defaultValue: FEEDBACK_STATUS_LABEL[r.status] }))}
                    </Badge>
                  </div>
                  {r.updates.filter((u) => u.kind === 'reply').map((u, i) => (
                    <div key={i} className="flex gap-2 rounded-xl bg-muted/50 p-3 text-sm">
                      <MessageCircleReply aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap break-words" dir="auto">{u.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{String(t('feedback.team_reply', { defaultValue: 'AI Support 360 team' }))} · {fmt(u.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
