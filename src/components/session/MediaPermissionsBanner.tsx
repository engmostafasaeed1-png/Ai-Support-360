import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ShieldAlert,
  CheckCircle2,
  HelpCircle,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

interface PermStatus {
  camera: PermState;
  microphone: PermState;
}

function detectBrowser(): 'chrome' | 'firefox' | 'safari' | 'edge' | 'other' {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'other';
}

async function queryPermission(name: 'camera' | 'microphone'): Promise<PermState> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) return 'unsupported';
  try {
    // Some browsers (Firefox) throw on camera/microphone names.
    const status = await (navigator.permissions as any).query({ name });
    return (status.state as PermState) ?? 'unknown';
  } catch {
    return 'unsupported';
  }
}

interface MediaPermissionsBannerProps {
  /** Hide the banner entirely (e.g., when session is completed). */
  enabled?: boolean;
  /** Optional storage key to persist the user's "dismiss" decision per session. */
  dismissKey?: string;
}

/**
 * Detects whether the browser is blocking camera/microphone access for the
 * current site and surfaces an in-app banner with browser-specific guidance.
 *
 * States surfaced:
 *  - granted: subtle success banner (auto-hides after 4s).
 *  - prompt:  informational banner with a "Test camera & mic" CTA that calls
 *             getUserMedia to trigger the native permission prompt.
 *  - denied:  destructive banner with a "How to fix" dialog containing
 *             browser-specific steps to re-enable permissions.
 *  - unsupported: hidden (server-side render or non-secure context).
 */
export default function MediaPermissionsBanner({
  enabled = true,
  dismissKey,
}: MediaPermissionsBannerProps) {
  const { t } = useTranslation();
  const [perm, setPerm] = useState<PermStatus>({ camera: 'unknown', microphone: 'unknown' });
  const [helpOpen, setHelpOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!dismissKey || typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(dismissKey) === '1';
  });
  const [secureContext, setSecureContext] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setSecureContext(window.isSecureContext !== false);
    const [camera, microphone] = await Promise.all([
      queryPermission('camera'),
      queryPermission('microphone'),
    ]);
    setPerm({ camera, microphone });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();

    // Listen for permission changes when supported.
    const cleanups: Array<() => void> = [];
    (async () => {
      if (!('permissions' in navigator)) return;
      for (const name of ['camera', 'microphone'] as const) {
        try {
          const status = await (navigator.permissions as any).query({ name });
          const handler = () => refresh();
          status.addEventListener?.('change', handler);
          cleanups.push(() => status.removeEventListener?.('change', handler));
        } catch {
          /* unsupported */
        }
      }
    })();

    // Re-check when tab becomes visible (user may have changed permissions in browser settings).
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVis));

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [enabled, refresh]);

  const requestAccess = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(
        t('media_perms.unsupported', {
          defaultValue: 'This browser does not support camera and microphone access.',
        })
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      // Immediately stop tracks; we only needed to trigger the prompt and verify access.
      stream.getTracks().forEach((tr) => tr.stop());
      toast.success(
        t('media_perms.granted_toast', {
          defaultValue: 'Camera and microphone access enabled.',
        })
      );
      refresh();
    } catch (err: any) {
      const name = err?.name as string | undefined;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPerm((p) => ({
          camera: p.camera === 'granted' ? 'granted' : 'denied',
          microphone: p.microphone === 'granted' ? 'granted' : 'denied',
        }));
        setHelpOpen(true);
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        toast.error(
          t('media_perms.no_device', {
            defaultValue: 'No camera or microphone was found on this device.',
          })
        );
      } else {
        toast.error(
          t('media_perms.error', {
            defaultValue: 'Could not access camera or microphone. {{msg}}',
            msg: err?.message ?? '',
          })
        );
      }
    }
  }, [refresh, t]);

  if (!enabled || dismissed) return null;
  if (perm.camera === 'unsupported' && perm.microphone === 'unsupported' && secureContext) {
    // Browser doesn't support Permissions API for these names — still offer a CTA
    // so the user can trigger a getUserMedia probe manually.
  }

  const handleDismiss = () => {
    setDismissed(true);
    if (dismissKey && typeof window !== 'undefined') {
      window.sessionStorage.setItem(dismissKey, '1');
    }
  };

  // Insecure context (http://) — getUserMedia is unavailable.
  if (!secureContext) {
    return (
      <Alert variant="destructive" className="relative">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>
          {t('media_perms.insecure_title', { defaultValue: 'Insecure connection' })}
        </AlertTitle>
        <AlertDescription>
          {t('media_perms.insecure_desc', {
            defaultValue:
              'Camera and microphone require HTTPS. Reopen this page over a secure connection to join the video session.',
          })}
        </AlertDescription>
        <DismissButton onClick={handleDismiss} label={t('common.dismiss', { defaultValue: 'Dismiss' })} />
      </Alert>
    );
  }

  const denied = perm.camera === 'denied' || perm.microphone === 'denied';
  const allGranted = perm.camera === 'granted' && perm.microphone === 'granted';

  if (denied) {
    return (
      <>
        <Alert variant="destructive" className="relative">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 mt-0.5" aria-hidden="true" />
            <div className="flex-1 space-y-2">
              <AlertTitle>
                {t('media_perms.blocked_title', {
                  defaultValue: 'Camera or microphone is blocked',
                })}
              </AlertTitle>
              <AlertDescription>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <PermPill state={perm.camera} kind="camera" t={t} />
                  <PermPill state={perm.microphone} kind="microphone" t={t} />
                </div>
                <p className="mt-2">
                  {t('media_perms.blocked_desc', {
                    defaultValue:
                      'Your browser is blocking access required to join the video session. Allow camera and microphone permissions to continue.',
                  })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setHelpOpen(true)}>
                    <HelpCircle className="w-4 h-4 mr-1.5" aria-hidden="true" />
                    {t('media_perms.how_to_fix', { defaultValue: 'How to fix' })}
                  </Button>
                  <Button size="sm" variant="outline" onClick={requestAccess}>
                    {t('media_perms.try_again', { defaultValue: 'Try again' })}
                  </Button>
                </div>
              </AlertDescription>
            </div>
          </div>
          <DismissButton
            onClick={handleDismiss}
            label={t('common.dismiss', { defaultValue: 'Dismiss' })}
          />
        </Alert>
        <PermissionsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      </>
    );
  }

  if (allGranted) {
    return (
      <Alert className="relative border-emerald-500/30 bg-emerald-500/10 text-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
        <AlertTitle className="text-foreground">
          {t('media_perms.ready_title', { defaultValue: 'Camera and microphone are ready' })}
        </AlertTitle>
        <AlertDescription className="text-muted-foreground">
          {t('media_perms.ready_desc', {
            defaultValue: 'You can join the video session at any time.',
          })}
        </AlertDescription>
        <DismissButton onClick={handleDismiss} label={t('common.dismiss', { defaultValue: 'Dismiss' })} />
      </Alert>
    );
  }

  // 'prompt' / 'unknown' / 'unsupported' but secure context.
  return (
    <>
      <Alert className="relative">
        <Video className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>
          {t('media_perms.prompt_title', { defaultValue: 'Allow camera & microphone to join' })}
        </AlertTitle>
        <AlertDescription>
          <p className="text-sm">
            {t('media_perms.prompt_desc', {
              defaultValue:
                'The video session needs access to your camera and microphone. You will see a browser prompt — click "Allow" to continue.',
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={requestAccess}>
              <Mic className="w-4 h-4 mr-1.5" aria-hidden="true" />
              {t('media_perms.test_devices', { defaultValue: 'Test camera & mic' })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)}>
              <HelpCircle className="w-4 h-4 mr-1.5" aria-hidden="true" />
              {t('media_perms.help', { defaultValue: 'Need help?' })}
            </Button>
          </div>
        </AlertDescription>
        <DismissButton onClick={handleDismiss} label={t('common.dismiss', { defaultValue: 'Dismiss' })} />
      </Alert>
      <PermissionsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

function DismissButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <X className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

function PermPill({
  state,
  kind,
  t,
}: {
  state: PermState;
  kind: 'camera' | 'microphone';
  t: (k: string, o?: any) => string;
}) {
  const label =
    kind === 'camera'
      ? t('media_perms.camera', { defaultValue: 'Camera' })
      : t('media_perms.microphone', { defaultValue: 'Microphone' });
  const Icon =
    state === 'granted'
      ? kind === 'camera'
        ? Video
        : Mic
      : kind === 'camera'
        ? VideoOff
        : MicOff;
  const stateLabel =
    state === 'granted'
      ? t('media_perms.allowed', { defaultValue: 'Allowed' })
      : state === 'denied'
        ? t('media_perms.blocked', { defaultValue: 'Blocked' })
        : t('media_perms.unknown', { defaultValue: 'Not set' });
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="font-medium">{label}:</span>
      <span>{stateLabel}</span>
    </span>
  );
}

function PermissionsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const browser = typeof navigator !== 'undefined' ? detectBrowser() : 'other';

  const steps: Record<ReturnType<typeof detectBrowser>, string[]> = {
    chrome: [
      t('media_perms.steps.chrome.1', {
        defaultValue: 'Click the lock icon in the address bar.',
      }),
      t('media_perms.steps.chrome.2', {
        defaultValue: 'Open "Site settings".',
      }),
      t('media_perms.steps.chrome.3', {
        defaultValue: 'Set Camera and Microphone to "Allow".',
      }),
      t('media_perms.steps.chrome.4', { defaultValue: 'Reload the page.' }),
    ],
    edge: [
      t('media_perms.steps.edge.1', {
        defaultValue: 'Click the lock icon in the address bar.',
      }),
      t('media_perms.steps.edge.2', {
        defaultValue: 'Open "Permissions for this site".',
      }),
      t('media_perms.steps.edge.3', {
        defaultValue: 'Set Camera and Microphone to "Allow".',
      }),
      t('media_perms.steps.edge.4', { defaultValue: 'Reload the page.' }),
    ],
    firefox: [
      t('media_perms.steps.firefox.1', {
        defaultValue: 'Click the shield/lock icon next to the address bar.',
      }),
      t('media_perms.steps.firefox.2', {
        defaultValue: 'Remove the "Blocked" status for Camera and Microphone.',
      }),
      t('media_perms.steps.firefox.3', { defaultValue: 'Reload the page and click Allow.' }),
    ],
    safari: [
      t('media_perms.steps.safari.1', {
        defaultValue: 'Open Safari → Settings → Websites.',
      }),
      t('media_perms.steps.safari.2', {
        defaultValue: 'Select Camera and Microphone, then set this site to "Allow".',
      }),
      t('media_perms.steps.safari.3', { defaultValue: 'Reload the page.' }),
    ],
    other: [
      t('media_perms.steps.other.1', {
        defaultValue:
          'Open your browser site settings and allow Camera and Microphone for this site, then reload the page.',
      }),
    ],
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('media_perms.help_title', { defaultValue: 'Allow camera & microphone' })}
          </DialogTitle>
          <DialogDescription>
            {t('media_perms.help_desc', {
              defaultValue:
                'Follow the steps below to grant access. You may also need to allow access in your operating system privacy settings.',
            })}
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-foreground">
          {steps[browser].map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
          <Button onClick={() => window.location.reload()}>
            {t('media_perms.reload', { defaultValue: 'Reload page' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
