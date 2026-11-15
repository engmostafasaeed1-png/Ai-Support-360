import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Mic, MicOff, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { validAnswer } from '@/lib/interviewReply';

type Props = { value: string; busy: boolean; listening: boolean; voiceSupported: boolean; paused?: boolean; remaining?: number; countdownSource?: 'speech' | 'typing' | null; onCancelCountdown?: () => void; onPause?: () => void; onChange: (text: string) => void; onSend: () => void; onVoice: () => void; language?: string; onLanguage?: (lang: string) => void };
const InterviewReplyBox = forwardRef<HTMLTextAreaElement, Props>(({ value, busy, listening, voiceSupported, paused = false, remaining = 0, countdownSource, onCancelCountdown, onPause, onChange, onSend, onVoice, language, onLanguage }, ref) => {
  const { t } = useTranslation();
  return <div className="space-y-2 bg-background text-foreground p-3">
    <textarea ref={ref} aria-label={t('interview.reply_label')} dir="auto" value={value} rows={3}
      onChange={e => onChange(e.target.value)} maxLength={16000} onClick={onCancelCountdown}
      onKeyDown={e => { if (e.nativeEvent.isComposing) { if (countdownSource === 'speech' && remaining > 0) onCancelCountdown?.(); return; } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy && validAnswer(value)) onSend(); } else if (countdownSource === 'speech' && remaining > 0) onCancelCountdown?.(); }}
      placeholder={t('interview.reply_placeholder')}
      className="w-full resize-y min-h-24 rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <div className="min-h-7" aria-live="polite">
      {remaining > 0 && !paused && (countdownSource !== 'typing' || remaining <= 2500) && <div className="space-y-1">
        <span className="text-xs text-muted-foreground">{t('interview.sending_in', { count: Math.ceil(remaining / 1000) })}</span>
        <progress aria-label={t('interview.sending_countdown')} max={4} value={remaining / 1000} className="block h-1 w-full accent-primary" />
      </div>}
      {paused && <span className="text-xs text-muted-foreground">{t('interview.edit_paused')}</span>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={onPause}><Pause className="h-4 w-4" />{t('interview.pause_edit')}</Button>
      {voiceSupported && <Button type="button" variant="outline" onClick={onVoice} busy={busy}>
        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{t(listening ? 'interview.stop_recording' : 'interview.add_voice')}
      </Button>}
      <Button type="button" onClick={onSend} busy={busy} reason={!validAnswer(value) && { key: 'type_message_first', message: t('interview.reply_short') }}>
        <Send className="h-4 w-4" />{t('interview.send_answer')}
      </Button>
      {onLanguage && <select aria-label={t('interview.microphone_language')} value={language} onChange={e => onLanguage(e.target.value)} className="rounded-md border border-border bg-background p-2 text-sm text-foreground"><option value="en-US">English</option><option value="ar-SA">العربية</option></select>}
    </div>
    <p className="text-xs text-muted-foreground">{t('interview.reply_hint')}</p>
  </div>;
});
InterviewReplyBox.displayName = 'InterviewReplyBox';
export default InterviewReplyBox;