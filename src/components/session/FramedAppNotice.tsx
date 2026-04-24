import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ExternalLink, Frame, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProviderTroubleshootingPanel from './ProviderTroubleshootingPanel';
import { detectProvider, type MeetingProvider } from './MeetingLinkButton';

/**
 * Returns true when the current document is rendered inside an iframe.
 * Safely handles cross-origin parents (which throw on `window.top` access).
 */
export function isInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.top !== window.self;
  } catch {
    // Cross-origin parent → access denied means we're definitely framed.
    return true;
  }
}

interface FramedAppNoticeProps {
  /** Storage key used to persist the dismissed state for the current session. */
  dismissKey?: string;
  /** Optional URL to open the app in a top-level tab. Defaults to current href. */
  topLevelUrl?: string;
  /**
   * Optional meeting URL — when provided, the notice shows provider-specific
   * troubleshooting steps for the framed scenario (e.g. Meet's X-Frame-Options).
   */
  meetingUrl?: string;
  /** Explicit provider override; auto-detected from `meetingUrl` when omitted. */
  provider?: MeetingProvider;
  /** When set, the "Open in a new tab" CTA routes through `/join/:sessionId`. */
  sessionId?: string;
}

/**
 * In-app warning shown when the application is loaded inside an iframe.
 * Explains that Google Meet (and other providers using `X-Frame-Options:
 * SAMEORIGIN` / `frame-ancestors 'self'`) cannot be opened from a framed
 * context and offers a one-click "Open in a new tab" action.
 */
export default function FramedAppNotice({
  dismissKey = 'framed-app-notice-dismissed',
  topLevelUrl,
  meetingUrl,
  provider,
  sessionId,
}: FramedAppNoticeProps) {
  const { t } = useTranslation();
  const [framed, setFramed] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const f = isInIframe();
    setFramed(f);
    if (f) {
      // Fire-and-forget import to avoid pulling diagnostics into the SSR critical path.
      import('@/lib/diagnostics').then(({ logProviderEvent }) => {
        logProviderEvent(
          'framed',
          {
            provider: provider ?? detectProvider(meetingUrl),
            url: meetingUrl,
            referrer: typeof document !== 'undefined' ? document.referrer : undefined,
          },
          'warn'
        );
      });
    }
  }, [meetingUrl, provider]);

  if (!framed || dismissed) return null;

  const target = topLevelUrl || (typeof window !== 'undefined' ? window.location.href : '#');

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(dismissKey, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <Alert className="relative border-amber-500/40 bg-amber-500/10">
      <Frame className="h-4 w-4 text-amber-600" aria-hidden="true" />
      <AlertTitle className="text-foreground">
        {t('framed_notice.title', { defaultValue: 'Open in a top-level tab to join Google Meet' })}
      </AlertTitle>
      <AlertDescription className="text-muted-foreground">
        <p className="text-sm">
          {t('framed_notice.desc', {
            defaultValue:
              'This view is running inside an embedded frame. Google Meet (and some other video providers) refuse to load from framed pages for security reasons. Open the app in a new browser tab to start or join a meeting.',
          })}
        </p>

        {(meetingUrl || provider) && (
          <div className="mt-3">
            <ProviderTroubleshootingPanel
              provider={provider ?? detectProvider(meetingUrl)}
              reason="framed"
              variant="card"
            />
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => window.open(target, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="w-4 h-4 mr-1.5" aria-hidden="true" />
            {t('framed_notice.open_new_tab', { defaultValue: 'Open in a new tab' })}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss}>
            {t('common.dismiss', { defaultValue: 'Dismiss' })}
          </Button>
        </div>
      </AlertDescription>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </Alert>
  );
}
