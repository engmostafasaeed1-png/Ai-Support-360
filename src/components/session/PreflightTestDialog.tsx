import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Circle,
  Square,
  Play,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { logProviderEvent } from '@/lib/diagnostics';

type Status = 'idle' | 'requesting' | 'ready' | 'error';

interface MediaError {
  code:
    | 'NotAllowedError'
    | 'NotFoundError'
    | 'NotReadableError'
    | 'OverconstrainedError'
    | 'SecurityError'
    | 'AbortError'
    | 'TypeError'
    | 'Unknown';
  message: string;
}

interface PreflightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when user clicks "Join now" after a successful preflight. */
  onProceed: () => void;
  joinLabel?: string;
}

function mapError(err: any): MediaError {
  const name = (err?.name as MediaError['code']) || 'Unknown';
  const message = err?.message || '';
  return { code: name in errorTextKeys ? name : 'Unknown', message } as MediaError;
}

const errorTextKeys: Record<MediaError['code'], { title: string; desc: string; cta?: string }> = {
  NotAllowedError: {
    title: 'Permission denied',
    desc: 'Your browser blocked camera or microphone access. Allow it in the address bar (lock icon) and try again.',
    cta: 'Try again',
  },
  SecurityError: {
    title: 'Permission denied',
    desc: 'Access was blocked for security reasons. Check the address bar and your OS privacy settings, then retry.',
    cta: 'Try again',
  },
  NotFoundError: {
    title: 'No camera or microphone found',
    desc: 'Connect a camera and microphone, then click retry. If you only have one device, you can still join with audio or video only.',
    cta: 'Retry detection',
  },
  NotReadableError: {
    title: 'Device is in use',
    desc: 'Another app (Zoom, Teams, OBS, etc.) is using your camera or microphone. Close it and try again.',
    cta: 'Try again',
  },
  OverconstrainedError: {
    title: 'Selected device unavailable',
    desc: 'The chosen camera or microphone could not start. Pick a different device below.',
    cta: 'Try again',
  },
  AbortError: {
    title: 'Test was interrupted',
    desc: 'The test ended unexpectedly. Try again.',
    cta: 'Try again',
  },
  TypeError: {
    title: 'Insecure connection',
    desc: 'Camera and microphone require HTTPS. Reopen this page over a secure connection.',
  },
  Unknown: {
    title: 'Could not start devices',
    desc: 'Something went wrong starting your camera or microphone. Try again or pick a different device.',
    cta: 'Try again',
  },
};

export default function PreflightTestDialog({
  open,
  onOpenChange,
  onProceed,
  joinLabel,
}: PreflightDialogProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playbackRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<MediaError | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | undefined>();
  const [micId, setMicId] = useState<string | undefined>();
  const [level, setLevel] = useState(0);
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordConfirmed, setRecordConfirmed] = useState(false);
  const RECORD_DURATION = 4; // seconds

  const stopStream = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setLevel(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === 'videoinput'));
      setMics(devices.filter((d) => d.kind === 'audioinput'));
    } catch {
      /* ignore */
    }
  }, []);

  const startTest = useCallback(async () => {
    setError(null);
    setStatus('requesting');
    stopStream();

    if (typeof window === 'undefined' || !window.isSecureContext) {
      setError({ code: 'TypeError', message: 'Insecure context' });
      setStatus('error');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError({ code: 'TypeError', message: 'getUserMedia unsupported' });
      setStatus('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: micId ? { deviceId: { exact: micId } } : true,
      });
      streamRef.current = stream;

      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      setHasVideo(videoTracks.length > 0);
      setHasAudio(audioTracks.length > 0);

      if (videoRef.current && videoTracks.length > 0) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      // Audio level meter via WebAudio.
      if (audioTracks.length > 0) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        analyserRef.current = analyser;
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(buf);
          // RMS-ish around 128 baseline
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          setLevel(Math.min(1, rms * 2.5));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }

      // Once permission is granted, device labels become available.
      await refreshDevices();
      if (!cameraId && videoTracks[0]?.getSettings().deviceId) {
        setCameraId(videoTracks[0].getSettings().deviceId);
      }
      if (!micId && audioTracks[0]?.getSettings().deviceId) {
        setMicId(audioTracks[0].getSettings().deviceId);
      }

      setStatus('ready');
      logProviderEvent('preflight_open', {
        hasVideo: videoTracks.length > 0,
        hasAudio: audioTracks.length > 0,
        cameraCount: cameras.length,
        micCount: mics.length,
      });
    } catch (err: any) {
      const mapped = mapError(err);
      setError(mapped);
      setStatus('error');
      logProviderEvent(
        'preflight_error',
        { code: mapped.code, message: mapped.message, name: err?.name },
        'error'
      );
      // Even on partial failure (e.g. only mic blocked), refresh device list.
      refreshDevices();
    }
  }, [cameraId, micId, refreshDevices, stopStream, cameras.length, mics.length]);

  // Auto-start when opened.
  useEffect(() => {
    if (open) {
      startTest();
    } else {
      stopStream();
      setStatus('idle');
      setError(null);
    }
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Restart when device selection changes (only after first ready).
  const restart = useCallback(() => {
    startTest();
  }, [startTest]);

  const handleProceed = () => {
    logProviderEvent('preflight_proceed', { hasVideo, hasAudio });
    stopStream();
    onOpenChange(false);
    onProceed();
  };

  const renderError = () => {
    if (!error) return null;
    const txt = errorTextKeys[error.code];
    const isDenied = error.code === 'NotAllowedError' || error.code === 'SecurityError';
    return (
      <Alert variant={isDenied ? 'destructive' : 'default'}>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>
          {t(`preflight.err.${error.code}.title`, { defaultValue: txt.title })}
        </AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{t(`preflight.err.${error.code}.desc`, { defaultValue: txt.desc })}</p>
          {error.message && (
            <p className="text-xs opacity-80">
              {t('preflight.err.detail', { defaultValue: 'Details' })}: {error.message}
            </p>
          )}
          {txt.cta && (
            <Button size="sm" variant="secondary" onClick={restart} className="mt-1">
              <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
              {t(`preflight.err.${error.code}.cta`, { defaultValue: txt.cta })}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  };

  const proceedDisabled = status !== 'ready' || (!hasVideo && !hasAudio);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('preflight.title', { defaultValue: 'Test camera & microphone' })}
          </DialogTitle>
          <DialogDescription>
            {t('preflight.desc', {
              defaultValue:
                'Quick check before you join. Confirm your camera shows a preview and the mic level reacts when you speak.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Video preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
            {status === 'requesting' && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
                <span className="sr-only">
                  {t('preflight.loading', { defaultValue: 'Starting devices…' })}
                </span>
              </div>
            )}
            {!hasVideo && status === 'ready' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                <VideoOff className="w-6 h-6" aria-hidden="true" />
                <span className="text-xs">
                  {t('preflight.no_camera', { defaultValue: 'No camera signal' })}
                </span>
              </div>
            )}
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              aria-label={t('preflight.preview', { defaultValue: 'Camera preview' })}
            />
            {status === 'ready' && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-2 py-1 text-xs font-medium text-emerald-600 backdrop-blur">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                {t('preflight.live', { defaultValue: 'Live' })}
              </span>
            )}
          </div>

          {/* Mic level meter */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                {hasAudio ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                {t('preflight.mic_level', { defaultValue: 'Microphone level' })}
              </span>
              <span>
                {hasAudio
                  ? t('preflight.speak_to_test', { defaultValue: 'Speak to test' })
                  : t('preflight.no_mic', { defaultValue: 'No microphone' })}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
              aria-label={t('preflight.mic_level', { defaultValue: 'Microphone level' })}
            >
              <div
                className="h-full bg-emerald-500 transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>

          {/* Device pickers */}
          <div className="grid gap-2 sm:grid-cols-2">
            <DeviceSelect
              label={t('preflight.camera', { defaultValue: 'Camera' })}
              icon={<Video className="w-3.5 h-3.5" />}
              devices={cameras}
              value={cameraId}
              onChange={(v) => {
                setCameraId(v);
                setTimeout(restart, 0);
              }}
              empty={t('preflight.no_camera', { defaultValue: 'No camera signal' })}
            />
            <DeviceSelect
              label={t('preflight.microphone', { defaultValue: 'Microphone' })}
              icon={<Mic className="w-3.5 h-3.5" />}
              devices={mics}
              value={micId}
              onChange={(v) => {
                setMicId(v);
                setTimeout(restart, 0);
              }}
              empty={t('preflight.no_mic', { defaultValue: 'No microphone' })}
            />
          </div>

          {renderError()}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="ghost" onClick={restart} disabled={status === 'requesting'}>
            <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
            {t('preflight.retest', { defaultValue: 'Re-test' })}
          </Button>
          <Button onClick={handleProceed} disabled={proceedDisabled}>
            {joinLabel ?? t('preflight.join_now', { defaultValue: 'Join now' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeviceSelect({
  label,
  icon,
  devices,
  value,
  onChange,
  empty,
}: {
  label: string;
  icon: React.ReactNode;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  onChange: (v: string) => void;
  empty: string;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      {devices.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {empty}
        </div>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder={label} />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d, i) => (
              <SelectItem key={d.deviceId || i} value={d.deviceId || `device-${i}`}>
                {d.label || `${label} ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** Helper exported for callers that prefer imperative usage. */
export function showPreflightToastIfBlocked(err: unknown) {
  const e = err as any;
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
    toast.error('Camera/microphone blocked. Open browser site settings to allow access.');
    return true;
  }
  return false;
}
