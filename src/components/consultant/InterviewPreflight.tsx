import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Wifi, Globe, Mic, Camera, Volume2, Keyboard, Play, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { basicChecks, canStart, permissionToCheck, readEnv, testDevices, type CheckState, type PreflightResult } from '@/lib/interviewPreflight';

const ICON: Record<CheckState, typeof CheckCircle2> = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle, unknown: HelpCircle };
const TONE: Record<CheckState, string> = { ok: 'text-success', warn: 'text-warning', fail: 'text-destructive', unknown: 'text-muted-foreground' };

interface Props {
  onContinue: (opts: { textOnly: boolean }) => void;
  onCancel: () => void;
  resumed?: boolean;
}

/** Camera, microphone, browser and network check before the AI interview, with friendly fixes and a text-only option. */
export default function InterviewPreflight({ onContinue, onCancel, resumed }: Props) {
  const { t } = useTranslation();
  const [result, setResult] = useState<PreflightResult>(() => basicChecks(readEnv()));
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const base = basicChecks(readEnv());
    try {
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
      if (perms?.query) {
        const [cam, mic] = await Promise.all([
          perms.query({ name: 'camera' as PermissionName }).then(s => s.state, () => undefined),
          perms.query({ name: 'microphone' as PermissionName }).then(s => s.state, () => undefined),
        ]);
        if (base.camera === 'unknown') base.camera = permissionToCheck(cam);
        if (base.microphone === 'unknown') base.microphone = permissionToCheck(mic);
      }
    } catch { /* permission query unsupported: stays unknown */ }
    setResult(base);
  }, []);

  useEffect(() => {
    void refresh();
    const on = () => void refresh();
    window.addEventListener('online', on); window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, [refresh]);

  const test = async () => {
    setTesting(true);
    try { const d = await testDevices(); setResult(r => ({ ...r, camera: d.camera, microphone: d.microphone })); }
    finally { setTesting(false); }
  };

  const rows: { key: keyof PreflightResult; icon: typeof Wifi; label: string; help: Record<CheckState, string> }[] = [
    { key: 'network', icon: Wifi, label: t('interview.pre_network', 'Internet connection'), help: {
      ok: t('interview.pre_network_ok', 'Connected.'),
      warn: '', unknown: '',
      fail: t('interview.pre_network_fail', 'You are offline. Reconnect to the internet; this check updates by itself.'),
    } },
    { key: 'browser', icon: Globe, label: t('interview.pre_browser', 'Browser'), help: {
      ok: t('interview.pre_browser_ok', 'Your browser supports the interview.'),
      warn: t('interview.pre_browser_warn', 'This browser cannot use the camera here. Use the latest Chrome, Edge or Safari, or continue text-only.'),
      fail: '', unknown: '',
    } },
    { key: 'microphone', icon: Mic, label: t('interview.pre_mic', 'Microphone'), help: {
      ok: t('interview.pre_mic_ok', 'Microphone allowed.'),
      warn: t('interview.pre_mic_warn', 'No microphone found. You can type your answers.'),
      fail: t('interview.pre_mic_fail', 'Microphone blocked. Click the lock or camera icon in the address bar, allow the microphone, then press "Test camera and microphone" again.'),
      unknown: t('interview.pre_mic_unknown', 'Not tested yet. Press "Test camera and microphone" and allow access when your browser asks.'),
    } },
    { key: 'camera', icon: Camera, label: t('interview.pre_camera', 'Camera'), help: {
      ok: t('interview.pre_camera_ok', 'Camera allowed.'),
      warn: t('interview.pre_camera_warn', 'No camera found. The interview continues without video.'),
      fail: t('interview.pre_camera_fail', 'Camera blocked. Click the lock or camera icon in the address bar, allow the camera, then test again. The interview also works without video.'),
      unknown: t('interview.pre_camera_unknown', 'Not tested yet. Video is optional.'),
    } },
    { key: 'voice', icon: Volume2, label: t('interview.pre_voice', 'Voice answers'), help: {
      ok: t('interview.pre_voice_ok', 'Spoken answers and read-aloud questions are available.'),
      warn: t('interview.pre_voice_warn', 'This browser cannot turn speech into text. Use Chrome or Edge for voice, or type your answers.'),
      fail: '', unknown: '',
    } },
  ];

  const startable = canStart(result);
  const voiceReady = result.microphone === 'ok' && result.voice === 'ok';

  return (
    <Card className="mx-auto max-w-xl rounded-2xl">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('interview.pre_title', 'Before you start')}</h2>
          <p className="text-sm text-muted-foreground">
            {resumed
              ? t('interview.pre_resumed', 'You have an interview that is not finished yet. It continues where you left off.')
              : t('interview.pre_intro', 'A quick check of your connection and devices. Camera and voice are optional: you can also type every answer.')}
          </p>
        </div>
        <ul className="space-y-3" aria-live="polite">
          {rows.map(({ key, icon: Icon, label, help }) => {
            const state = result[key];
            const StateIcon = ICON[state];
            return (
              <li key={key} className="flex items-start gap-3">
                <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {label}
                    <StateIcon className={`h-4 w-4 ${TONE[state]}`} aria-label={t(`interview.pre_state_${state}`, state)} />
                  </p>
                  {help[state] && <p className="text-xs leading-relaxed text-muted-foreground">{help[state]}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={test} disabled={testing || !startable}>
          {testing ? <Loader2 className="me-1 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Mic className="me-1 h-4 w-4" />}
          {t('interview.pre_test', 'Test camera and microphone')}
        </Button>
        {!startable && <p role="alert" className="text-sm text-destructive">{t('interview.pre_offline_block', 'Reconnect to the internet to start.')}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>{t('common.back', 'Back')}</Button>
          <Button type="button" variant="outline" disabled={!startable} onClick={() => onContinue({ textOnly: true })}>
            <Keyboard className="me-1 h-4 w-4" /> {t('interview.pre_text_only', 'Continue text-only')}
          </Button>
          <Button type="button" className="gradient-primary text-primary-foreground" disabled={!startable} onClick={() => onContinue({ textOnly: false })}>
            <Play className="me-1 h-4 w-4" /> {voiceReady ? t('interview.pre_start_voice', 'Start with voice and video') : t('interview.pre_start', 'Start the interview')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
