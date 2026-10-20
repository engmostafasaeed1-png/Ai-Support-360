import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { HelpCircle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { infoActionMessage, useAskForInfo } from '@/hooks/useAssignmentInfo';
import {
  INFO_MAX_REQUESTS, INFO_MAX_TEXT, INFO_MAX_TOPICS, INFO_TOPICS, validateInfoRequest,
} from '../../../../supabase/functions/_shared/assignmentInfo';

interface Props {
  requestId: string | null;
  /** Information requests already sent on this request. */
  used: number;
  onClose: () => void;
  onSent?: () => void;
}

const TOPIC_FALLBACK: Record<string, string> = {
  scope: 'Scope', system: 'System version / landscape', error: 'Error message / screenshot', timeline_budget: 'Timeline / budget', access: 'Access method',
};

/** "Request more information": up to 3 quick-pick topics plus 500 characters; the clock pauses until the client answers. */
export default function RequestInfoDialog({ requestId, used, onClose, onSent }: Props) {
  const { t } = useTranslation();
  const ask = useAskForInfo();
  const [topics, setTopics] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => { if (requestId) { setTopics([]); setText(''); setTried(false); } }, [requestId]);

  const problems = validateInfoRequest(topics, text);
  const toggle = (k: string) => setTopics((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= INFO_MAX_TOPICS ? cur : [...cur, k]));

  const send = () => {
    setTried(true);
    if (!requestId || problems.length > 0) return;
    ask.mutate({ requestId, topics, question: text }, {
      onSuccess: () => {
        toast.success(t('assignment_info.sent', 'Question sent. Your reply clock is paused until the client answers.'));
        onSent?.();
        onClose();
      },
      onError: (e) => toast.error(infoActionMessage(e, t('assignment_info.send_failed', 'Your question could not be sent. Please try again.'))),
    });
  };

  const problemText = (p: string) => ({
    empty: t('assignment_info.problem_empty', 'Pick a topic or write what you need.'),
    too_long: t('assignment_info.problem_too_long', 'Please keep it to 500 characters.'),
    too_many_topics: t('assignment_info.problem_too_many', 'Pick up to 3 topics.'),
    contact: t('assignment_info.problem_contact', 'Please remove e-mail addresses, phone numbers, links or messenger names: contact details are shared inside the portal once you are assigned.'),
    unknown_topic: t('assignment_info.problem_too_many', 'Pick up to 3 topics.'),
  } as Record<string, string>)[p];
  // Contact details and length are shown while typing; "empty" only after a send attempt.
  const shown = problems.filter((p) => p !== 'empty' || tried);

  return (
    <Dialog open={!!requestId} onOpenChange={(o) => { if (!o && !ask.isPending) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('assignment_info.ask_title', 'Request more information')}
          </DialogTitle>
          <DialogDescription className="text-start">
            {t('assignment_info.ask_hint', 'Ask the client what you need to decide. Your reply clock pauses until they answer and then resumes with at least 2 hours left. Up to 3 questions per request, one at a time.')}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('assignment_info.topics_label', 'What do you need? (up to 3)')}</legend>
          <div className="flex flex-wrap gap-2">
            {INFO_TOPICS.map((k) => {
              const on = topics.includes(k);
              const disabled = !on && topics.length >= INFO_MAX_TOPICS;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(k)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'}`}
                >
                  {t(`assignment_info.topic_${k}`, TOPIC_FALLBACK[k])}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="info-text">{t('assignment_info.text_label', 'Details (optional)')}</Label>
          <Textarea
            id="info-text"
            value={text}
            maxLength={INFO_MAX_TEXT + 50}
            rows={4}
            dir="auto"
            placeholder={t('assignment_info.text_placeholder', 'For example: which company codes are affected?')}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="info-text-count info-problems"
            aria-invalid={shown.length > 0}
          />
          <p id="info-text-count" className="text-end text-[11px] text-muted-foreground">
            {t('assignment_info.chars_left', '{{count}} characters left', { count: Math.max(0, INFO_MAX_TEXT - text.trim().length) })}
          </p>
          <ul id="info-problems" role="alert" className="space-y-0.5 text-xs text-destructive">
            {shown.map((p) => <li key={p}>{problemText(p)}</li>)}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('assignment_info.used', '{{used}} of 3 questions used', { used: Math.min(used, INFO_MAX_REQUESTS) })}
        </p>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onClose} disabled={ask.isPending}>{t('assignment_info.cancel', 'Cancel')}</Button>
          <Button onClick={send} disabled={ask.isPending || (tried && problems.length > 0)} className="gradient-primary border-0 gap-1">
            {ask.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('assignment_info.send', 'Send question')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
