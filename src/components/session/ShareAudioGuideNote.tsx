import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Volume2,
  MonitorSpeaker,
  AppWindow,
  Chrome,
  ChevronDown,
  ChevronUp,
  X,
  Info,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

type Browser = 'chrome' | 'edge' | 'firefox';

function detectDefaultBrowser(): Browser {
  if (typeof navigator === 'undefined') return 'chrome';
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  return 'chrome';
}

interface ShareAudioGuideNoteProps {
  /** sessionStorage key to remember the user's "dismiss" choice. */
  dismissKey?: string;
  /** Default to expanded on first render. */
  defaultOpen?: boolean;
}

interface AudioOption {
  label: string;
  value: 'yes' | 'no' | 'partial';
  hint?: string;
}

interface BrowserGuide {
  name: string;
  picker: string;
  steps: string[];
  tab: AudioOption;
  window: AudioOption;
  screen: AudioOption;
  notes: string[];
}

/**
 * Focused, in-session note that explains how to share **tab audio**
 * versus **system audio** (entire screen / window audio) when using
 * the browser's native screen-sharing picker. Complements the broader
 * MeetingPermissionsNote by zeroing in on the audio toggle, which is
 * where users most often get stuck (e.g. sharing a YouTube clip but
 * presenters hearing nothing).
 */
export default function ShareAudioGuideNote({
  dismissKey,
  defaultOpen = false,
}: ShareAudioGuideNoteProps) {
  const { t } = useTranslation();
  const detected = useMemo(detectDefaultBrowser, []);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!dismissKey || typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(dismissKey) === '1';
  });
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Browser>(detected);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (dismissKey && typeof window !== 'undefined') {
      window.sessionStorage.setItem(dismissKey, '1');
    }
  };

  const guides: Record<Browser, BrowserGuide> = {
    chrome: {
      name: t('share_audio.chrome.name', { defaultValue: 'Google Chrome' }),
      picker: t('share_audio.chrome.picker', {
        defaultValue: '"Choose what to share" dialog',
      }),
      steps: [
        t('share_audio.chrome.s1', {
          defaultValue: 'Click "Share screen" inside the meeting.',
        }),
        t('share_audio.chrome.s2', {
          defaultValue:
            'Pick the "Chrome Tab" tab at the top — only this option supports tab audio.',
        }),
        t('share_audio.chrome.s3', {
          defaultValue: 'Select the tab that plays the sound (e.g. YouTube).',
        }),
        t('share_audio.chrome.s4', {
          defaultValue: 'Tick "Also share tab audio" in the bottom-left of the dialog.',
        }),
        t('share_audio.chrome.s5', {
          defaultValue: 'Click Share. Participants will hear the tab\'s audio.',
        }),
      ],
      tab: {
        label: t('share_audio.tab', { defaultValue: 'Tab audio' }),
        value: 'yes',
        hint: t('share_audio.chrome.tab_hint', {
          defaultValue: 'Toggle "Also share tab audio".',
        }),
      },
      window: {
        label: t('share_audio.window', { defaultValue: 'Window audio' }),
        value: 'no',
        hint: t('share_audio.chrome.window_hint', {
          defaultValue: 'Sharing a single window does not capture audio in Chrome.',
        }),
      },
      screen: {
        label: t('share_audio.screen', { defaultValue: 'Entire-screen audio' }),
        value: 'partial',
        hint: t('share_audio.chrome.screen_hint', {
          defaultValue:
            'Windows only: tick "Share system audio". Not available on macOS or Linux.',
        }),
      },
      notes: [
        t('share_audio.chrome.n1', {
          defaultValue:
            'macOS: tab audio works, but full-screen system audio is not supported by Chrome.',
        }),
        t('share_audio.chrome.n2', {
          defaultValue:
            'If the tick-box is missing, update Chrome — the option requires version 74 or newer.',
        }),
      ],
    },
    edge: {
      name: t('share_audio.edge.name', { defaultValue: 'Microsoft Edge' }),
      picker: t('share_audio.edge.picker', {
        defaultValue: '"Choose what to share" dialog (same engine as Chrome)',
      }),
      steps: [
        t('share_audio.edge.s1', {
          defaultValue: 'Click "Share screen" in the meeting.',
        }),
        t('share_audio.edge.s2', {
          defaultValue:
            'Choose the "Tab" view to share a single page with audio, or "Screen" to share everything.',
        }),
        t('share_audio.edge.s3', {
          defaultValue:
            'On the Tab view tick "Share tab audio". On the Screen view (Windows only) tick "Share system audio".',
        }),
        t('share_audio.edge.s4', {
          defaultValue: 'Click Share to start.',
        }),
      ],
      tab: {
        label: t('share_audio.tab', { defaultValue: 'Tab audio' }),
        value: 'yes',
        hint: t('share_audio.edge.tab_hint', {
          defaultValue: 'Use the "Tab" picker and toggle "Share tab audio".',
        }),
      },
      window: {
        label: t('share_audio.window', { defaultValue: 'Window audio' }),
        value: 'no',
        hint: t('share_audio.edge.window_hint', {
          defaultValue: 'Window-only sharing has no audio toggle.',
        }),
      },
      screen: {
        label: t('share_audio.screen', { defaultValue: 'Entire-screen audio' }),
        value: 'partial',
        hint: t('share_audio.edge.screen_hint', {
          defaultValue:
            'Windows only: tick "Share system audio" in the Screen picker. Not available on macOS.',
        }),
      },
      notes: [
        t('share_audio.edge.n1', {
          defaultValue:
            'Edge mirrors Chrome\'s capabilities, so tips for Chrome generally apply here too.',
        }),
      ],
    },
    firefox: {
      name: t('share_audio.firefox.name', { defaultValue: 'Mozilla Firefox' }),
      picker: t('share_audio.firefox.picker', {
        defaultValue: '"Allow … to see your screen" prompt',
      }),
      steps: [
        t('share_audio.firefox.s1', {
          defaultValue: 'Click "Share screen" inside the meeting.',
        }),
        t('share_audio.firefox.s2', {
          defaultValue:
            'Pick the screen, window, or application to share from the dropdown.',
        }),
        t('share_audio.firefox.s3', {
          defaultValue:
            'Click Allow. Firefox does not yet have a tick-box for tab or system audio.',
        }),
        t('share_audio.firefox.s4', {
          defaultValue:
            'To share sound (e.g. a video), play it through a separate device or use Chrome/Edge instead.',
        }),
      ],
      tab: {
        label: t('share_audio.tab', { defaultValue: 'Tab audio' }),
        value: 'no',
        hint: t('share_audio.firefox.tab_hint', {
          defaultValue: 'Firefox cannot capture tab audio during screen share today.',
        }),
      },
      window: {
        label: t('share_audio.window', { defaultValue: 'Window audio' }),
        value: 'no',
        hint: t('share_audio.firefox.window_hint', {
          defaultValue: 'No audio is captured when sharing a window.',
        }),
      },
      screen: {
        label: t('share_audio.screen', { defaultValue: 'Entire-screen audio' }),
        value: 'no',
        hint: t('share_audio.firefox.screen_hint', {
          defaultValue:
            'System audio capture is not yet available in Firefox\'s screen picker.',
        }),
      },
      notes: [
        t('share_audio.firefox.n1', {
          defaultValue:
            'Workaround: route sound through a virtual audio cable (e.g. BlackHole on macOS, VB-CABLE on Windows) and select it as your microphone.',
        }),
        t('share_audio.firefox.n2', {
          defaultValue:
            'For presentations that include audio, switch to Chrome or Edge for the most reliable experience.',
        }),
      ],
    },
  };

  const guide = guides[tab];

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
          <Volume2 className="w-4 h-4 text-primary" aria-hidden="true" />
          {t('share_audio.title', {
            defaultValue: 'Sharing tab audio vs. system audio',
          })}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('share_audio.intro', {
            defaultValue:
              'When you share your screen, others won\'t hear sound unless you also share audio. The right toggle depends on whether you share a tab, a window, or your full screen — and which browser you\'re using.',
          })}
        </p>

        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <ConceptPill
            icon={AppWindow}
            title={t('share_audio.concept.tab', { defaultValue: 'Tab audio' })}
            desc={t('share_audio.concept.tab_desc', {
              defaultValue: 'Sound from one browser tab only.',
            })}
          />
          <ConceptPill
            icon={MonitorSpeaker}
            title={t('share_audio.concept.system', {
              defaultValue: 'System / screen audio',
            })}
            desc={t('share_audio.concept.system_desc', {
              defaultValue: 'All sound from the computer.',
            })}
          />
          <ConceptPill
            icon={Info}
            title={t('share_audio.concept.window', {
              defaultValue: 'Window audio',
            })}
            desc={t('share_audio.concept.window_desc', {
              defaultValue: 'Most browsers don\'t capture single-window audio.',
            })}
          />
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
              {t('share_audio.hide', { defaultValue: 'Hide browser steps' })}
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
              {t('share_audio.show', { defaultValue: 'Show browser-specific steps' })}
            </>
          )}
        </Button>

        {open && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Browser)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="chrome">
                {t('share_audio.tab.chrome', { defaultValue: 'Chrome' })}
              </TabsTrigger>
              <TabsTrigger value="edge">
                {t('share_audio.tab.edge', { defaultValue: 'Edge' })}
              </TabsTrigger>
              <TabsTrigger value="firefox">
                {t('share_audio.tab.firefox', { defaultValue: 'Firefox' })}
              </TabsTrigger>
            </TabsList>

            {(['chrome', 'edge', 'firefox'] as Browser[]).map((b) => {
              const g = guides[b];
              return (
                <TabsContent key={b} value={b} className="space-y-3 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chrome className="w-4 h-4 text-primary" aria-hidden="true" />
                    <span className="text-sm font-medium text-foreground">{g.name}</span>
                    {b === detected && (
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {t('share_audio.detected', { defaultValue: 'Your browser' })}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <SupportRow option={g.tab} icon={AppWindow} />
                    <SupportRow option={g.window} icon={Info} />
                    <SupportRow option={g.screen} icon={MonitorSpeaker} />
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('share_audio.steps_label', {
                        defaultValue: 'Steps in the {{picker}}',
                        picker: g.picker,
                      })}
                    </p>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-foreground">
                      {g.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>

                  {g.notes.length > 0 && (
                    <ul className="space-y-1 rounded-md border border-border/60 bg-background/40 p-2 text-xs text-muted-foreground">
                      {g.notes.map((n, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <Info className="mt-0.5 w-3 h-3 shrink-0 text-primary/80" aria-hidden="true" />
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function ConceptPill({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-foreground">
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-0.5 text-muted-foreground">{desc}</p>
    </div>
  );
}

function SupportRow({
  option,
  icon: Icon,
}: {
  option: AudioOption;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const Status =
    option.value === 'yes' ? CheckCircle2 : option.value === 'no' ? XCircle : Info;
  const statusClass =
    option.value === 'yes'
      ? 'text-emerald-600'
      : option.value === 'no'
        ? 'text-destructive'
        : 'text-amber-600';
  return (
    <div className="rounded-md border border-border/60 bg-background p-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        {option.label}
        <Status className={`ml-auto w-3.5 h-3.5 ${statusClass}`} aria-hidden="true" />
      </div>
      {option.hint && <p className="mt-1 text-muted-foreground">{option.hint}</p>}
    </div>
  );
}
