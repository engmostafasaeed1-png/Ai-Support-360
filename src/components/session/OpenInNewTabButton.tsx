import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { logProviderEvent } from '@/lib/diagnostics';
import {
  detectProvider,
  type MeetingProvider,
} from './MeetingLinkButton';

interface OpenInNewTabButtonProps {
  /** Resolved meeting URL to open. */
  url: string;
  /** Session id used to build the `/join/:sessionId` handoff route. */
  sessionId?: string;
  /** Why we're surfacing this CTA — used for analytics. */
  reason: 'framed' | 'load_failed' | 'popup_blocked' | 'invalid_url' | 'manual';
  /** Optional explicit provider for consistent troubleshooting copy. */
  provider?: MeetingProvider;
  size?: 'default' | 'sm' | 'lg';
  variant?: 'default' | 'outline' | 'secondary';
  className?: string;
}

const PROVIDER_LABEL: Record<MeetingProvider, string> = {
  meet: 'Google Meet',
  jitsi: 'Jitsi Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  unknown: 'meeting',
};

/**
 * One-click button that deep-links to `/join/:sessionId?to=<url>` and opens
 * it in a new tab via the frame-free handoff page. Logs both the open
 * attempt and whether the popup was blocked, tagged with the calling
 * `reason` so we can attribute outcomes to the panel that triggered them.
 */
export default function OpenInNewTabButton({
  url,
  sessionId,
  reason,
  provider: providerProp,
  size = 'sm',
  variant = 'outline',
  className,
}: OpenInNewTabButtonProps) {
  const { t } = useTranslation();
  const provider: MeetingProvider =
    providerProp && providerProp !== 'unknown' ? providerProp : detectProvider(url);

  const handleClick = () => {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;
    const handoffUrl = sessionId
      ? `${origin}/join/${encodeURIComponent(sessionId)}?to=${encodeURIComponent(url)}`
      : url;

    logProviderEvent(
      'open_attempt',
      {
        provider,
        url,
        sessionId,
        reason,
        via: 'open_in_new_tab_button',
      },
      'info'
    );

    const win = window.open(handoffUrl, '_blank', 'noopener,noreferrer');
    if (!win) {
      logProviderEvent(
        'popup_blocked',
        {
          provider,
          url,
          sessionId,
          reason,
          via: 'open_in_new_tab_button',
        },
        'warn'
      );
      // Last-resort fallback: navigate the top window so the user still gets out.
      try {
        window.top!.location.href = handoffUrl;
      } catch {
        window.location.href = handoffUrl;
      }
      return;
    }

    logProviderEvent(
      'opened',
      {
        provider,
        url,
        sessionId,
        reason,
        via: 'open_in_new_tab_button',
      },
      'info'
    );
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={handleClick}
    >
      <ExternalLink className="w-4 h-4 mr-1.5" aria-hidden="true" />
      {t('open_new_tab.cta', {
        defaultValue: `Open ${PROVIDER_LABEL[provider]} in a new tab`,
        provider: PROVIDER_LABEL[provider],
      })}
    </Button>
  );
}
