import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Mic,
  Video,
  MonitorUp,
  Info,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';

type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
type OS = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'other';

function detectBrowser(): Browser {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'other';
}

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  const platform = (navigator as any).platform ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/i.test(platform) || /Mac OS X/.test(ua)) return 'macos';
  if (/Win/i.test(platform) || /Windows/.test(ua)) return 'windows';
  if (/Linux/i.test(platform) || /Linux/.test(ua)) return 'linux';
  return 'other';
}

interface MeetingPermissionsNoteProps {
  /** Optional sessionStorage key to remember the user's "dismiss" choice. */
  dismissKey?: string;
  /** Default to expanded on first render. */
  defaultOpen?: boolean;
}

/**
 * A static, in-session note that explains how to grant camera, microphone
 * and screen-sharing permissions BEFORE joining a video meeting. Complements
 * the dynamic MediaPermissionsBanner (which reacts to actual permission
 * states) by giving the user step-by-step browser- and OS-specific guidance
 * up front.
 */
export default function MeetingPermissionsNote({
  dismissKey,
  defaultOpen = false,
}: MeetingPermissionsNoteProps) {
  const { t } = useTranslation();
  const browser = useMemo(detectBrowser, []);
  const os = useMemo(detectOS, []);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!dismissKey || typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(dismissKey) === '1';
  });
  const [open, setOpen] = useState(defaultOpen);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (dismissKey && typeof window !== 'undefined') {
      window.sessionStorage.setItem(dismissKey, '1');
    }
  };

  const browserSteps: Record<Browser, { mic: string[]; screen: string[] }> = {
    chrome: {
      mic: [
        t('perm_note.chrome.mic.1', { defaultValue: 'Click the lock icon to the left of the address bar.' }),
        t('perm_note.chrome.mic.2', { defaultValue: 'Choose "Site settings".' }),
        t('perm_note.chrome.mic.3', { defaultValue: 'Set Camera and Microphone to "Allow".' }),
        t('perm_note.chrome.mic.4', { defaultValue: 'Reload the page so the new permissions take effect.' }),
      ],
      screen: [
        t('perm_note.chrome.screen.1', { defaultValue: 'When you click "Share screen" the browser will ask what to share.' }),
        t('perm_note.chrome.screen.2', { defaultValue: 'Choose "Entire screen", "Window" or "Chrome tab", then click Share.' }),
        t('perm_note.chrome.screen.3', { defaultValue: 'To also share audio (e.g. a video clip), tick "Share tab audio" before sharing.' }),
      ],
    },
    edge: {
      mic: [
        t('perm_note.edge.mic.1', { defaultValue: 'Click the lock icon in the address bar.' }),
        t('perm_note.edge.mic.2', { defaultValue: 'Open "Permissions for this site".' }),
        t('perm_note.edge.mic.3', { defaultValue: 'Set Camera and Microphone to "Allow".' }),
        t('perm_note.edge.mic.4', { defaultValue: 'Reload the page.' }),
      ],
      screen: [
        t('perm_note.edge.screen.1', { defaultValue: 'When prompted, choose Entire screen, Window or Tab.' }),
        t('perm_note.edge.screen.2', { defaultValue: 'Tick "Share system audio" if you need to share sound.' }),
        t('perm_note.edge.screen.3', { defaultValue: 'Click Share to start.' }),
      ],
    },
    firefox: {
      mic: [
        t('perm_note.firefox.mic.1', { defaultValue: 'Click the shield/lock icon next to the address bar.' }),
        t('perm_note.firefox.mic.2', { defaultValue: 'Remove any "Blocked" status for Camera and Microphone.' }),
        t('perm_note.firefox.mic.3', { defaultValue: 'Reload the page and click "Allow" when Firefox prompts you.' }),
      ],
      screen: [
        t('perm_note.firefox.screen.1', { defaultValue: 'When you start sharing, choose a window or your full screen from the dropdown.' }),
        t('perm_note.firefox.screen.2', { defaultValue: 'Click "Allow" to confirm.' }),
        t('perm_note.firefox.screen.3', { defaultValue: 'Tip: tick "Remember this decision" to skip the prompt next time.' }),
      ],
    },
    safari: {
      mic: [
        t('perm_note.safari.mic.1', { defaultValue: 'Open Safari → Settings → Websites.' }),
        t('perm_note.safari.mic.2', { defaultValue: 'Select Camera, then Microphone, and set this site to "Allow".' }),
        t('perm_note.safari.mic.3', { defaultValue: 'Reload the page.' }),
      ],
      screen: [
        t('perm_note.safari.screen.1', { defaultValue: 'Safari supports screen sharing on macOS 13 or later.' }),
        t('perm_note.safari.screen.2', { defaultValue: 'When prompted, pick the screen or window to share and click Allow.' }),
        t('perm_note.safari.screen.3', { defaultValue: 'On older versions, use Chrome, Edge or Firefox to share your screen.' }),
      ],
    },
    other: {
      mic: [
        t('perm_note.other.mic.1', {
          defaultValue:
            'Open your browser site settings and allow Camera and Microphone for this site, then reload the page.',
        }),
      ],
      screen: [
        t('perm_note.other.screen.1', {
          defaultValue: 'When you click "Share screen", confirm the prompt and pick what you want to share.',
        }),
      ],
    },
  };

  const osSteps: Record<OS, string[]> = {
    macos: [
      t('perm_note.os.macos.1', { defaultValue: 'Open System Settings → Privacy & Security.' }),
      t('perm_note.os.macos.2', { defaultValue: 'Enable your browser under Camera, Microphone, and Screen Recording.' }),
      t('perm_note.os.macos.3', { defaultValue: 'Quit and reopen the browser if you just toggled Screen Recording.' }),
    ],
    windows: [
      t('perm_note.os.windows.1', { defaultValue: 'Open Settings → Privacy & security → Camera (and Microphone).' }),
      t('perm_note.os.windows.2', { defaultValue: 'Turn on "Camera access" and "Let apps access your camera".' }),
      t('perm_note.os.windows.3', { defaultValue: 'Make sure your browser is allowed in the list below.' }),
    ],
    linux: [
      t('perm_note.os.linux.1', { defaultValue: 'Ensure no other app is using the camera or microphone.' }),
      t('perm_note.os.linux.2', { defaultValue: 'On Wayland, screen sharing requires xdg-desktop-portal — install it if missing.' }),
    ],
    ios: [
      t('perm_note.os.ios.1', { defaultValue: 'Open Settings → Safari → Camera and Microphone, set both to "Allow".' }),
      t('perm_note.os.ios.2', { defaultValue: 'Screen sharing from iOS Safari is limited; join from a desktop browser if you need to present.' }),
    ],
    android: [
      t('perm_note.os.android.1', { defaultValue: 'Open Settings → Apps → your browser → Permissions.' }),
      t('perm_note.os.android.2', { defaultValue: 'Allow Camera and Microphone, then reload the meeting page.' }),
    ],
    other: [
      t('perm_note.os.other.1', {
        defaultValue: 'Check your operating system privacy settings and allow your browser to use the camera, microphone and screen recording.',
      }),
    ],
  };

  const browserKey = browserSteps[browser] ? browser : 'other';
  const osKey = osSteps[os] ? os : 'other';

  return (
    <Card className="relative border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>

      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" aria-hidden="true" />
          {t('perm_note.title', { defaultValue: 'Before you join: enable mic, camera & screen sharing' })}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('perm_note.intro', {
            defaultValue:
              'For the meeting to work smoothly, your browser needs permission to use the microphone and camera, and your operating system must allow screen recording for screen sharing. Follow the steps below for your setup.',
          })}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <PermPill icon={Mic} label={t('perm_note.pill.mic', { defaultValue: 'Microphone' })} />
          <PermPill icon={Video} label={t('perm_note.pill.cam', { defaultValue: 'Camera' })} />
          <PermPill icon={MonitorUp} label={t('perm_note.pill.screen', { defaultValue: 'Screen sharing' })} />
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen((v) => !v)}
          className="gap-1.5"
        >
          {open ? (
            <>
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
              {t('perm_note.hide', { defaultValue: 'Hide instructions' })}
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
              {t('perm_note.show', { defaultValue: 'Show step-by-step instructions' })}
            </>
          )}
        </Button>

        {open && (
          <Accordion type="multiple" defaultValue={['mic']} className="w-full">
            <AccordionItem value="mic">
              <AccordionTrigger className="text-sm">
                {t('perm_note.section.mic', {
                  defaultValue: 'Allow camera & microphone in your browser',
                })}
              </AccordionTrigger>
              <AccordionContent>
                <ol className="list-decimal pl-5 space-y-1.5 text-sm text-foreground">
                  {browserSteps[browserKey].mic.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="screen">
              <AccordionTrigger className="text-sm">
                {t('perm_note.section.screen', {
                  defaultValue: 'Enable screen sharing',
                })}
              </AccordionTrigger>
              <AccordionContent>
                <ol className="list-decimal pl-5 space-y-1.5 text-sm text-foreground">
                  {browserSteps[browserKey].screen.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('perm_note.screen.tip', {
                    defaultValue:
                      'You will only be asked for screen-sharing permission the first time you click Share in the meeting.',
                  })}
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="os">
              <AccordionTrigger className="text-sm">
                {t('perm_note.section.os', {
                  defaultValue: 'System privacy settings',
                })}
              </AccordionTrigger>
              <AccordionContent>
                <ol className="list-decimal pl-5 space-y-1.5 text-sm text-foreground">
                  {osSteps[osKey].map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="tips">
              <AccordionTrigger className="text-sm">
                {t('perm_note.section.tips', {
                  defaultValue: 'Quick tips for a smooth meeting',
                })}
              </AccordionTrigger>
              <AccordionContent>
                <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground">
                  <li>
                    {t('perm_note.tip.close_apps', {
                      defaultValue:
                        'Close other apps that use the camera or microphone (Zoom, Teams, FaceTime) so the browser can take control.',
                    })}
                  </li>
                  <li>
                    {t('perm_note.tip.headphones', {
                      defaultValue: 'Use wired headphones or earbuds to avoid echo.',
                    })}
                  </li>
                  <li>
                    {t('perm_note.tip.test', {
                      defaultValue:
                        'Use the "Test camera & mic" button above to confirm your devices work before joining.',
                    })}
                  </li>
                  <li>
                    {t('perm_note.tip.share_tab', {
                      defaultValue:
                        'When sharing a video or audio clip, share a browser tab and tick "Share tab audio" so others can hear it.',
                    })}
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function PermPill({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-foreground">
      <Icon className="w-3.5 h-3.5 text-primary" aria-hidden />
      <span className="font-medium">{label}</span>
    </span>
  );
}
