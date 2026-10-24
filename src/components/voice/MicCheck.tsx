// Microphone test before the AI interview: choose the microphone, see the level meter, say one sentence and read what
// was understood. Uses the same recogniser as the interview, so the result is what the interview will hear.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useVoiceRecognizer } from '@/hooks/useVoiceRecognizer';
import { saveMicDevice, savedMicDevice } from '@/lib/voice/micRecorder';
import type { VoiceContext } from '@/lib/voice/transcribeClient';
import VoiceLevelMeter from './VoiceLevelMeter';

interface Props {
  context: VoiceContext;
  interviewId?: string | null;
  lang: string;
  className?: string;
}

export default function MicCheck({ context, interviewId, lang, className }: Props) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(savedMicDevice() ?? '');
  const [heardLoud, setHeardLoud] = useState(false);
  const voice = useVoiceRecognizer({ context, interviewId, lang, idleMs: 1600, onIdle: () => { void voice.stop(); } });

  const loadDevices = async () => {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices?.();
      setDevices((list ?? []).filter((d) => d.kind === 'audioinput' && d.deviceId));
    } catch { setDevices([]); }
  };
  useEffect(() => { void loadDevices(); }, []);
  useEffect(() => { if (voice.status === 'listening') void loadDevices(); }, [voice.status]);
  useEffect(() => { if (voice.level > 0.45) setHeardLoud(true); }, [voice.level]);

  const toggle = () => {
    if (voice.listening) { void voice.stop(); return; }
    setHeardLoud(false);
    void voice.start();
  };

  const engineLabel = voice.engine === 'server'
    ? t('voice.engine_server', 'Enhanced recognition (understands SAP terms, English and Arabic)')
    : voice.engine === 'webspeech'
      ? t('voice.engine_browser', "Your browser's speech recognition")
      : null;

  return (
    <div className={cn('w-full rounded-xl border p-4 text-start space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Mic className="h-4 w-4" aria-hidden="true" />{t('voice.check_title', 'Test your microphone')}</h3>
        <VoiceLevelMeter level={voice.level} active={voice.status === 'listening'} />
      </div>
      {devices.length > 1 && (
        <label className="block text-xs">
          <span className="block mb-1 opacity-80">{t('voice.device', 'Microphone')}</span>
          <select
            value={deviceId}
            onChange={(e) => { setDeviceId(e.target.value); saveMicDevice(e.target.value || null); if (voice.listening) voice.cancel(); }}
            className="w-full rounded-lg border bg-background text-foreground px-2 py-1.5 text-xs"
          >
            <option value="">{t('voice.device_default', 'Default microphone')}</option>
            {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('voice.device', 'Microphone')} ${i + 1}`}</option>)}
          </select>
        </label>
      )}
      <p className="text-xs opacity-80">{t('voice.check_hint', 'Press "Try it", then say a sentence with SAP terms, for example: "I posted the invoice in MIRO and checked ACDOCA in S/4HANA."')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={voice.listening ? 'destructive' : 'secondary'} onClick={toggle} disabled={voice.status === 'starting'}>
          {voice.status === 'starting' ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : voice.listening ? <Square className="h-3.5 w-3.5 me-1" /> : <Mic className="h-3.5 w-3.5 me-1" />}
          {voice.listening ? t('voice.check_stop', 'Stop') : t('voice.check_try', 'Try it')}
        </Button>
        <span role="status" aria-live="polite" className="text-xs opacity-80">
          {voice.status === 'listening' && (heardLoud ? t('voice.check_hearing', 'We can hear you.') : t('voice.check_speak', 'Speak now…'))}
          {voice.pending > 0 && <> <Loader2 className="inline h-3 w-3 animate-spin" /> {t('voice.transcribing', 'Writing down what you said…')}</>}
        </span>
      </div>
      {voice.status === 'listening' && !heardLoud && voice.level > 0 && voice.level < 0.2 && (
        <p className="text-xs opacity-80">{t('voice.check_quiet', 'Your voice is quiet. Move closer to the microphone or choose another one.')}</p>
      )}
      {(voice.text || voice.interim) && (
        <div className="rounded-lg border px-3 py-2 text-sm" dir="auto">
          <span className="block text-[11px] opacity-70 mb-0.5">{t('voice.check_result', 'We understood:')}</span>
          {voice.text} {voice.interim && <span className="opacity-60 italic">{voice.interim}</span>}
        </div>
      )}
      {engineLabel && <p className="text-[11px] opacity-70">{engineLabel}</p>}
      {voice.notice && <p role="alert" className="text-xs text-warning">{t(voice.notice.key, voice.notice.text)}</p>}
    </div>
  );
}
