import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { validAnswer } from '@/lib/interviewReply';

type Props = { value: string; busy: boolean; listening: boolean; voiceSupported: boolean; onChange: (text: string) => void; onSend: () => void; onVoice: () => void };
const InterviewReplyBox = forwardRef<HTMLTextAreaElement, Props>(({ value, busy, listening, voiceSupported, onChange, onSend, onVoice }, ref) => {
  const { t } = useTranslation();
  return <div className="space-y-2 bg-background text-foreground p-3">
    <textarea ref={ref} aria-label={t('interview.reply_label')} dir="auto" value={value} rows={3}
      onChange={e => onChange(e.target.value)} maxLength={16000}
      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && validAnswer(value)) onSend(); } }}
      placeholder={t('interview.reply_placeholder')}
      className="w-full resize-y min-h-24 rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <div className="flex flex-wrap items-center gap-2">
      {voiceSupported && <Button type="button" variant="outline" onClick={onVoice} busy={busy}>
        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{t(listening ? 'interview.stop_recording' : 'interview.add_voice')}
      </Button>}
      <Button type="button" onClick={onSend} busy={busy} reason={!validAnswer(value) && { key: 'type_message_first', message: t('interview.reply_short') }}>
        <Send className="h-4 w-4" />{t('interview.send_answer')}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">{t('interview.reply_hint')}</p>
  </div>;
});
InterviewReplyBox.displayName = 'InterviewReplyBox';
export default InterviewReplyBox;