// Microphone button for text fields (ticket title/description, chat, proposals, live interview).
// Uses the shared recogniser: server transcription with SAP vocabulary when available, otherwise the browser's own.
// Pass `value` (the field's current text) to keep what was already typed: the spoken text is added after it, and
// `onTranscript` receives the whole new field text. Without `value`, it receives the text spoken since the press.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useVoiceRecognizer } from '@/hooks/useVoiceRecognizer';
import { joinText } from '@/lib/voice/transcriptAssembler';
import { logVoiceAnswer } from '@/lib/voice/voiceMetrics';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  /** Current field text; spoken words are added after it. */
  value?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
}

const LANGUAGES = [
  { code: 'auto', label: 'English + العربية', short: 'EN/ع' },
  { code: 'en-US', label: 'English', short: 'EN' },
  { code: 'ar-SA', label: 'العربية', short: 'ع' },
];
const LANG_KEY = 'voice.dictationLang';

export default function VoiceInput({ onTranscript, value, disabled, className, size = 'default' }: VoiceInputProps) {
  const { t } = useTranslation();
  const [lang, setLang] = useState(() => { try { return localStorage.getItem(LANG_KEY) || 'auto'; } catch { return 'auto'; } });
  const [showLangPicker, setShowLangPicker] = useState(false);
  const baseRef = useRef('');
  const voice = useVoiceRecognizer({
    context: 'dictation',
    lang,
    onText: (spoken) => onTranscript(value !== undefined ? joinText(baseRef.current, spoken) : spoken),
  });

  useEffect(() => {
    if (voice.notice) toast.error(t(voice.notice.key, voice.notice.text));
  }, [voice.notice, t]);

  if (!voice.supported) return null;

  const toggle = async () => {
    if (voice.listening) {
      const meta = voice.answerMeta();
      const spoken = await voice.stop();
      if (spoken) logVoiceAnswer({ context: 'dictation', meta, edited: false, chars: spoken.length });
      return;
    }
    baseRef.current = value ?? '';
    void voice.start();
  };

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const btnSize = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  const busy = voice.pending > 0 && !voice.listening;

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <Popover open={showLangPicker} onOpenChange={setShowLangPicker}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(btnSize, 'shrink-0 text-muted-foreground hover:text-foreground text-[10px] font-semibold')}
            disabled={disabled || voice.listening}
            title={t('voice.language', 'Voice language')}
            aria-label={`${t('voice.language', 'Voice language')}: ${current.label}`}
          >
            {current.short}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="end">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md hover:bg-muted transition-colors', lang === l.code && 'bg-accent/10 text-accent font-medium')}
              onClick={() => { setLang(l.code); try { localStorage.setItem(LANG_KEY, l.code); } catch { /* private mode */ } setShowLangPicker(false); }}
            >
              <span className="w-8 text-start font-semibold">{l.short}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(btnSize, 'relative shrink-0 transition-all', voice.listening ? 'text-destructive bg-destructive/10 hover:bg-destructive/20' : 'text-muted-foreground hover:text-foreground')}
        onClick={() => void toggle()}
        disabled={disabled || voice.status === 'starting' || busy}
        title={voice.listening ? t('voice.stop', 'Stop recording') : t('voice.start', 'Start voice input')}
        aria-label={voice.listening ? t('voice.stop', 'Stop recording') : t('voice.start', 'Start voice input')}
        aria-pressed={voice.listening}
      >
        {voice.status === 'starting' || busy ? <Loader2 className={cn(iconSize, 'animate-spin')} /> : voice.listening ? <MicOff className={iconSize} /> : <Mic className={iconSize} />}
        {voice.listening && (
          <span aria-hidden="true" className="absolute inset-0 rounded-md ring-2 ring-destructive/50 transition-opacity" style={{ opacity: 0.3 + voice.level * 0.7 }} />
        )}
      </Button>
    </div>
  );
}
