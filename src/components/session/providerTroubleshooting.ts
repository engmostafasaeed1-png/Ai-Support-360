import type { MeetingProvider } from './MeetingLinkButton';

export type TroubleshootReason = 'framed' | 'load_failed' | 'popup_blocked' | 'invalid_url';

export interface ProviderTroubleshooting {
  provider: MeetingProvider;
  label: string;
  /** Short headline summarizing what's wrong. */
  headline: string;
  /** One-sentence explanation of the underlying cause (browser/provider behavior). */
  cause: string;
  /** Ordered, actionable steps the user can take right now. */
  steps: string[];
  /** Optional canonical help URL on the provider's own site. */
  helpUrl?: string;
}

const PROVIDER_LABELS: Record<MeetingProvider, string> = {
  meet: 'Google Meet',
  jitsi: 'Jitsi Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  unknown: 'Meeting',
};

const HELP_URLS: Partial<Record<MeetingProvider, string>> = {
  meet: 'https://support.google.com/meet/answer/7290456',
  zoom: 'https://support.zoom.us/hc/en-us/articles/201362023-System-requirements-for-Windows-macOS-and-Linux',
  teams: 'https://support.microsoft.com/office/join-a-teams-meeting-078e9868-f1aa-4414-8bb9-ee88e9236ee4',
  jitsi: 'https://jitsi.github.io/handbook/docs/user-guide/user-guide-start-a-jitsi-meeting/',
};

/**
 * Return provider-specific guidance for the given failure reason.
 * Designed to be displayed inline (e.g. inside the fallback dialog or
 * the framed-app notice) — keep copy short and action-oriented.
 */
export function getProviderTroubleshooting(
  provider: MeetingProvider,
  reason: TroubleshootReason
): ProviderTroubleshooting {
  const label = PROVIDER_LABELS[provider];
  const helpUrl = HELP_URLS[provider];

  // Provider-specific copy keyed by reason. Falls back to generic when missing.
  const map: Record<MeetingProvider, Partial<Record<TroubleshootReason, Omit<ProviderTroubleshooting, 'provider' | 'label' | 'helpUrl'>>>> = {
    meet: {
      framed: {
        headline: 'Google Meet refuses to load inside another page.',
        cause:
          'Google Meet sets X-Frame-Options: SAMEORIGIN and frame-ancestors \'self\', so browsers block it from rendering inside any embedded frame (you will see ERR_BLOCKED_BY_RESPONSE).',
        steps: [
          'Open this app in a real browser tab (not an embedded view), then click Join again.',
          'When the Google Meet tab opens, sign in with the Google account that received the invite.',
          'If you are on a managed device, your admin may need to allow meet.google.com in Chrome\'s site settings.',
        ],
      },
      load_failed: {
        headline: 'Google Meet could not be opened.',
        cause:
          'The meeting URL was rejected, the Google account has no access, or a corporate proxy/firewall is blocking meet.google.com.',
        steps: [
          'Verify you are signed into the Google account that received the invite (check the avatar at meet.google.com).',
          'Try opening the link in an incognito window to rule out an unrelated logged-in account.',
          'Disable VPN, ad-blockers, and strict tracking-protection extensions for meet.google.com.',
          'On corporate networks, ask IT to allow meet.google.com, *.gstatic.com and *.googleusercontent.com.',
          'As a fallback, ask the organizer to share an alternative provider link (Jitsi/Zoom).',
        ],
      },
      popup_blocked: {
        headline: 'The Google Meet tab was blocked by your popup blocker.',
        cause: 'Browsers require an explicit allow-list for popups on this site.',
        steps: [
          'Click the popup-blocked icon in the address bar.',
          'Choose "Always allow popups and redirects from this site".',
          'Click Join again.',
        ],
      },
      invalid_url: {
        headline: 'The Google Meet link is not valid.',
        cause: 'The URL is missing or does not point to meet.google.com/<code>.',
        steps: [
          'Ask the organizer to resend the meeting link from Google Calendar.',
          'A valid Meet link looks like https://meet.google.com/abc-defg-hij.',
        ],
      },
    },
    teams: {
      framed: {
        headline: 'Microsoft Teams refuses to load inside another page.',
        cause:
          'Teams blocks framing via X-Frame-Options. Embedded views show "Refused to display in a frame" and ERR_BLOCKED_BY_RESPONSE.',
        steps: [
          'Open this app in a real browser tab, then click Join again.',
          'If prompted, choose "Continue on this browser" or open in the Teams desktop app.',
          'Sign in with the work/school account that received the invite.',
        ],
      },
      load_failed: {
        headline: 'Microsoft Teams could not be opened.',
        cause:
          'The link expired, the account has no access, or your tenant blocks anonymous join.',
        steps: [
          'Click "Continue on this browser" instead of "Open Teams app" if the desktop client is unresponsive.',
          'Sign in with the email address the invite was sent to.',
          'If your organization disables anonymous join, ask the organizer to add you explicitly.',
          'Clear cookies for *.teams.microsoft.com and try again.',
        ],
      },
      popup_blocked: {
        headline: 'The Teams tab was blocked by your popup blocker.',
        cause: 'Browsers require explicit popup permission for this site.',
        steps: [
          'Allow popups for this site in the address bar.',
          'Click Join again.',
        ],
      },
      invalid_url: {
        headline: 'The Microsoft Teams link is not valid.',
        cause: 'The URL is missing or does not point to teams.microsoft.com.',
        steps: ['Ask the organizer to resend the meeting link from Outlook or Teams.'],
      },
    },
    zoom: {
      framed: {
        headline: 'Zoom may not launch correctly from an embedded view.',
        cause:
          'Zoom\'s join page redirects to the desktop client via a custom protocol; some browsers refuse to launch external protocols from inside an iframe.',
        steps: [
          'Open this app in a real browser tab, then click Join again.',
          'If the Zoom client does not open, click "Launch Meeting" or "Join from your browser".',
          'Allow the Zoom protocol prompt ("Open zoommtg://…") if your browser asks.',
        ],
      },
      load_failed: {
        headline: 'Zoom could not be opened.',
        cause:
          'The Zoom desktop client is not installed, blocked, or the meeting requires registration.',
        steps: [
          'Install the Zoom client from zoom.us/download or click "Join from your browser".',
          'If a passcode is required, copy it from the invite.',
          'On corporate networks, ask IT to allow *.zoom.us and *.zoomgov.com.',
          'Try the join link in incognito to rule out a stale Zoom session.',
        ],
      },
      popup_blocked: {
        headline: 'The Zoom tab was blocked by your popup blocker.',
        cause: 'Browsers require explicit popup permission for this site.',
        steps: ['Allow popups for this site in the address bar, then click Join again.'],
      },
      invalid_url: {
        headline: 'The Zoom link is not valid.',
        cause: 'The URL is missing or does not point to zoom.us/j/<id>.',
        steps: ['Ask the organizer to resend the Zoom meeting link.'],
      },
    },
    jitsi: {
      framed: {
        headline: 'Jitsi can run embedded, but camera/mic permissions are limited.',
        cause:
          'Jitsi itself allows framing, however the parent page must grant camera/microphone via Permissions-Policy. Embedded views often miss that.',
        steps: [
          'Open this app in a real browser tab — then Jitsi gets full camera/microphone access.',
          'If you must stay in the embedded view, click the lock icon in the address bar and allow Camera and Microphone for this site.',
        ],
      },
      load_failed: {
        headline: 'Jitsi could not be opened.',
        cause:
          'The public meet.jit.si server is rate-limited or unreachable, or your network blocks WebRTC.',
        steps: [
          'Refresh the page and try again — the public server occasionally throttles new rooms.',
          'Disable VPNs and aggressive privacy extensions, then retry.',
          'If WebRTC is blocked on your network (common on corporate VPNs), join from a different network or hotspot.',
        ],
      },
      popup_blocked: {
        headline: 'The Jitsi tab was blocked by your popup blocker.',
        cause: 'Browsers require explicit popup permission for this site.',
        steps: ['Allow popups for this site, then click Join again.'],
      },
      invalid_url: {
        headline: 'The Jitsi link is not valid.',
        cause: 'The URL is missing or does not start with https://meet.jit.si/.',
        steps: ['Ask the organizer to resend the meeting link.'],
      },
    },
    unknown: {
      framed: {
        headline: 'This meeting may not load inside an embedded view.',
        cause:
          'Many video providers send X-Frame-Options or frame-ancestors headers that block framed loading.',
        steps: [
          'Open this app in a real browser tab, then click Join again.',
        ],
      },
      load_failed: {
        headline: 'The meeting could not be opened.',
        cause: 'The link may be expired, the provider may be down, or your network may be blocking it.',
        steps: [
          'Verify the link is correct and not expired.',
          'Try a different network (e.g. mobile hotspot) to rule out firewall blocking.',
          'Ask the organizer for an alternative provider link.',
        ],
      },
      popup_blocked: {
        headline: 'The meeting tab was blocked by your popup blocker.',
        cause: 'Browsers require explicit popup permission for this site.',
        steps: ['Allow popups for this site in the address bar, then retry.'],
      },
      invalid_url: {
        headline: 'The meeting link is not valid.',
        cause: 'The URL is missing or malformed.',
        steps: ['Ask the organizer to resend the meeting link.'],
      },
    },
  };

  const generic: Omit<ProviderTroubleshooting, 'provider' | 'label' | 'helpUrl'> = {
    headline: 'The meeting could not be opened.',
    cause: 'An unknown error occurred while opening the meeting.',
    steps: ['Try again in a few seconds, or ask the organizer for a fresh link.'],
  };

  const entry = map[provider]?.[reason] ?? generic;
  return { provider, label, helpUrl, ...entry };
}
