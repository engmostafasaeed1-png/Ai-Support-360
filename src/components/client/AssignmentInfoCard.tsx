import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, MessageCircleQuestion, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ACCEPT_ATTR, ATTACHMENT_HINT } from '@/lib/attachments';
import { infoActionMessage, useAnswerInfo, type InfoRequestRow } from '@/hooks/useAssignmentInfo';
import { durationLabel } from '../../../supabase/functions/_shared/assignmentPolicy';
import { ANSWER_MAX_TEXT, clientInfoView, contactDetailsInText, fileTypeLabel } from '../../../supabase/functions/_shared/assignmentInfo';

const TOPIC_FALLBACK: Record<string, string> = {
  scope: 'Scope', system: 'System version / landscape', error: 'Error message / screenshot', timeline_budget: 'Timeline / budget', access: 'Access method',
};

interface Props {
  row: InfoRequestRow;
  ticketId: string;
  consultantName: string;
  /** Only the ticket owner (or their company) answers; others read. */
  canAnswer: boolean;
  now: number;
}

/** "<consultant> asks: ..." on the client's ticket, with the reply box (text + optional file through the normal safe upload). */
export default function AssignmentInfoCard({ row, ticketId, consultantName, canAnswer, now }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const answer = useAnswerInfo(ticketId);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const view = clientInfoView(row, now);
  if (view.kind === 'closed') return null;

  const hasContact = contactDetailsInText(text);
  const tooLong = text.trim().length > ANSWER_MAX_TEXT;
  const canSend = text.trim().length > 0 && !hasContact && !tooLong && !answer.isPending;

  const send = () => {
    if (!canSend) return;
    answer.mutate({ infoId: row.id, answer: text, file }, {
      onSuccess: () => {
        toast.success(t('assignment_info.answered', 'Answer sent. {{name}} has been told.', { name: consultantName }));
        setText(''); setFile(null);
      },
      onError: (e) => toast.error(infoActionMessage(e, t('assignment_info.answer_failed', 'Your answer could not be sent. Please try again.'))),
    });
  };

  const topics = row.topics ?? [];
  const boxId = `info-answer-${row.id}`;

  return (
    <div
      className={`rounded-xl border p-3 text-xs ${view.kind === 'overdue' ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-muted/30'}`}
      id={`info-${row.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden="true" />
        <p className="font-semibold text-foreground">{t('assignment_info.asks', '{{name}} asks:', { name: consultantName })}</p>
        {view.kind === 'overdue' && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {t('assignment_info.waiting_for_answer', 'Waiting for your answer')}
          </span>
        )}
      </div>
      {topics.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {topics.map((k) => (
            <span key={k} className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{t(`assignment_info.topic_${k}`, TOPIC_FALLBACK[k] ?? k)}</span>
          ))}
        </p>
      )}
      {row.question && <p className="mt-1.5 whitespace-pre-wrap text-foreground" dir="auto">{row.question}</p>}

      {view.kind === 'answered' && (
        <div className="mt-2 border-s-2 border-primary/50 ps-2">
          <p className="font-medium text-foreground">{t('assignment_info.your_answer', 'Your answer')}</p>
          <p className="whitespace-pre-wrap text-foreground" dir="auto">{row.answer}</p>
          {row.attachment_name && (
            <p className="mt-1 flex items-center gap-1 text-muted-foreground">
              <Paperclip className="h-3 w-3" aria-hidden="true" /> {row.attachment_name} ({fileTypeLabel(row.attachment_name, row.attachment_type)})
            </p>
          )}
        </div>
      )}

      {(view.kind === 'awaiting' || view.kind === 'overdue') && (
        <>
          <p className="mt-2 text-muted-foreground">
            {t('assignment_info.paused_client', "{{name}}'s reply time is paused until you answer.", { name: consultantName })}
            {view.kind === 'awaiting' && view.dueAt != null && (
              <> {t('assignment_info.answer_within', 'Please answer within {{time}}.', { time: durationLabel(Math.max(1, Math.ceil((view.dueAt - now) / 60_000)), lang, false) })}</>
            )}
          </p>
          {canAnswer && (
            <div className="mt-2 space-y-2">
              <Label htmlFor={boxId} className="text-xs">{t('assignment_info.answer_label', 'Your answer')}</Label>
              <Textarea
                id={boxId}
                rows={3}
                dir="auto"
                value={text}
                maxLength={ANSWER_MAX_TEXT + 50}
                placeholder={t('assignment_info.answer_placeholder', 'Write your answer (no e-mail addresses, phone numbers or links)')}
                onChange={(e) => setText(e.target.value)}
                aria-invalid={hasContact || tooLong}
                aria-describedby={`${boxId}-hint`}
                className="text-sm"
              />
              <p id={`${boxId}-hint`} role={hasContact || tooLong ? 'alert' : undefined} className={`text-[11px] ${hasContact || tooLong ? 'text-destructive' : 'text-muted-foreground'}`}>
                {hasContact
                  ? t('assignment_info.answer_contact', 'Please remove e-mail addresses, phone numbers, links or messenger names: contact details are shared inside the portal once a consultant is assigned.')
                  : `${Math.max(0, ANSWER_MAX_TEXT - text.trim().length)} / ${ANSWER_MAX_TEXT}`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  accept={ACCEPT_ATTR}
                  aria-label={t('assignment_info.attach', 'Attach a file (optional)')}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-background px-2 py-1">
                    <Paperclip className="h-3 w-3" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                    <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} aria-label={t('assignment_info.remove_file', 'Remove file')} className="rounded-full p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => fileRef.current?.click()} title={ATTACHMENT_HINT}>
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> {t('assignment_info.attach', 'Attach a file (optional)')}
                  </Button>
                )}
                <Button size="sm" className="ms-auto h-8 gap-1 text-xs" onClick={send} disabled={!canSend}>
                  {answer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                  {t('assignment_info.send_answer', 'Send answer')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
