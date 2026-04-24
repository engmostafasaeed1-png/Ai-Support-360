import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExternalLink, Play, Video, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import PreflightTestDialog from './PreflightTestDialog';
import { logProviderEvent } from '@/lib/diagnostics';
import ProviderTroubleshootingPanel from './ProviderTroubleshootingPanel';
import type { TroubleshootReason } from './providerTroubleshooting';

export type MeetingProvider = 'meet' | 'jitsi' | 'zoom' | 'teams' | 'unknown';

export function detectProvider(url: string | null | undefined): MeetingProvider {
  if (!url) return 'unknown';
  try {
    const { hostname } = new URL(url);
    if (/(^|\.)meet\.google\.com$/i.test(hostname)) return 'meet';
    if (/(^|\.)meet\.jit\.si$/i.test(hostname) || /jitsi/i.test(hostname)) return 'jitsi';
    if (/(^|\.)zoom\.us$/i.test(hostname)) return 'zoom';
    if (/(^|\.)teams\.(microsoft|live)\.com$/i.test(hostname)) return 'teams';
    return 'unknown';
  } catch {
    if (/meet\.google\.com/i.test(url)) return 'meet';
    if (/jit\.si|jitsi/i.test(url)) return 'jitsi';
    if (/zoom\.us/i.test(url)) return 'zoom';
    if (/teams\.(microsoft|live)\.com/i.test(url)) return 'teams';
    return 'unknown';
  }
}

export function isGoogleMeetUrl(url: string | null | undefined): boolean {
  return detectProvider(url) === 'meet';
}

const PROVIDER_LABELS: Record<MeetingProvider, string> = {
  meet: 'Google Meet',
  jitsi: 'Jitsi Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  unknown: 'Meeting',
};

interface MeetingLinkButtonProps {
  url: string;
  /** Used when `url` is empty AND as the always-available free fallback (Jitsi recommended). */
  fallbackUrl?: string;
  /** Optional additional alternative provider links surfaced in the fallback dialog. */
  alternatives?: { provider: MeetingProvider; url: string }[];
  /** A stable id used to derive a deterministic Jitsi room as last-resort fallback. */
  fallbackRoomId?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  joinLabel?: string;
  /** Show the camera/mic preflight test before opening the meeting URL. Default true. */
  requirePreflight?: boolean;
  /**
   * When set, the join button routes through `/join/:sessionId?to=...` — a
   * dedicated handoff route that guarantees the meeting opens in a top-level
   * browser tab (escapes any wrapping iframe). Recommended for any context
   * where the app may be embedded.
   */
  sessionId?: string;
}

/**
 * Renders the join control for a meeting URL with an automatic fallback flow.
 *
 * Fallback triggers (any one is enough):
 *  - The chosen URL is missing or invalid.
 *  - The popup is blocked by the browser.
 *  - The newly opened tab is closed within ~3s without the user interacting,
 *    which strongly suggests the provider failed to load (auth wall, region
 *    block, X-Frame issues, network error, etc.).
 *
 * On trigger, we surface a dialog offering alternative providers
 * (Jitsi as the always-available free option, plus any caller-provided links).
 */
export default function MeetingLinkButton({
  url,
  fallbackUrl,
  alternatives = [],
  fallbackRoomId,
  size = 'lg',
  className = 'gradient-primary border-0 gap-1.5',
  joinLabel,
  requirePreflight = true,
  sessionId,
}: MeetingLinkButtonProps) {
  const { t } = useTranslation();
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [failedProvider, setFailedProvider] = useState<MeetingProvider>('unknown');
  const [failedReason, setFailedReason] = useState<TroubleshootReason>('load_failed');
  const [preflightOpen, setPreflightOpen] = useState(false);
  const pendingOpenRef = useRef<{ url: string; provider: MeetingProvider } | null>(null);
  const watcherRef = useRef<number | null>(null);

  const buildHandoffUrl = useCallback(
    (u: string) => {
      if (!sessionId) return u;
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return `${origin}/join/${encodeURIComponent(sessionId)}?to=${encodeURIComponent(u)}`;
    },
    [sessionId]
  );

  const target = url || fallbackUrl || '';
  const provider = detectProvider(target);
  const isMeet = provider === 'meet';

  // Derive the always-available Jitsi fallback.
  const jitsiFallback = useMemo(() => {
    const roomSeed = fallbackRoomId || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10));
    return `https://meet.jit.si/qurtuba-session-${roomSeed}`;
  }, [fallbackRoomId]);

  // Build the alternatives list (dedup by url, exclude the failed one).
  const buildAlternatives = useCallback(
    (excludeUrl: string) => {
      const list: { provider: MeetingProvider; url: string; label: string }[] = [];
      const seen = new Set<string>();
      const push = (p: MeetingProvider, u?: string) => {
        if (!u || seen.has(u) || u === excludeUrl) return;
        seen.add(u);
        list.push({ provider: p, url: u, label: PROVIDER_LABELS[p] });
      };
      alternatives.forEach((a) => push(a.provider, a.url));
      // Always include the jitsi fallback as the safety net.
      push('jitsi', jitsiFallback);
      // If the original `fallbackUrl` is different and not the failed url, include it.
      if (fallbackUrl && fallbackUrl !== excludeUrl) {
        push(detectProvider(fallbackUrl), fallbackUrl);
      }
      return list;
    },
    [alternatives, fallbackUrl, jitsiFallback]
  );

  const isValidUrl = (u: string) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  };

  const triggerFallback = useCallback(
    (failed: MeetingProvider, message: string, reason: string, extra?: Record<string, unknown>) => {
      setFailedProvider(failed);
      setFallbackOpen(true);
      toast.error(message);
      logProviderEvent('fallback_shown', { provider: failed, reason, ...extra }, 'warn');
    },
    []
  );

  const openUrl = useCallback(
    (u: string, providerHint: MeetingProvider) => {
      logProviderEvent('open_attempt', { provider: providerHint, url: u });
      if (!isValidUrl(u)) {
        logProviderEvent('invalid_url', { provider: providerHint, url: u }, 'error');
        triggerFallback(
          providerHint,
          t('session_detail.invalid_meeting_link', {
            defaultValue: 'Meeting link is invalid. Choose an alternative below.',
          }),
          'invalid_url',
          { url: u }
        );
        return;
      }
      const handoffUrl = buildHandoffUrl(u);
      const opened = window.open(handoffUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        logProviderEvent('popup_blocked', { provider: providerHint, url: u }, 'error');
        triggerFallback(
          providerHint,
          t('session_detail.popup_blocked_fallback', {
            defaultValue: 'Popup was blocked. Try an alternative video option.',
          }),
          'popup_blocked',
          { url: u }
        );
        return;
      }
      logProviderEvent('opened', { provider: providerHint, url: u });
      // Watch the popup briefly. If it closes within 3s, treat as a load failure.
      // We can't access cross-origin properties, but `closed` is allowed.
      const start = Date.now();
      if (watcherRef.current) window.clearInterval(watcherRef.current);
      watcherRef.current = window.setInterval(() => {
        try {
          if (opened.closed) {
            window.clearInterval(watcherRef.current!);
            watcherRef.current = null;
            const elapsed = Date.now() - start;
            if (elapsed < 3000) {
              logProviderEvent(
                'fast_close',
                { provider: providerHint, url: u, elapsedMs: elapsed },
                'error'
              );
              triggerFallback(
                providerHint,
                t('session_detail.provider_failed_fallback', {
                  defaultValue:
                    '{{provider}} did not open correctly. Try an alternative video option.',
                  provider: PROVIDER_LABELS[providerHint],
                }),
                'fast_close',
                { url: u, elapsedMs: elapsed }
              );
            }
          } else if (Date.now() - start > 5000) {
            // After 5s assume it loaded fine; stop watching to free resources.
            window.clearInterval(watcherRef.current!);
            watcherRef.current = null;
          }
        } catch {
          window.clearInterval(watcherRef.current!);
          watcherRef.current = null;
        }
      }, 500);
    },
    [t, triggerFallback, buildHandoffUrl]
  );

  const startOpen = (u: string, p: MeetingProvider) => {
    if (requirePreflight) {
      pendingOpenRef.current = { url: u, provider: p };
      setPreflightOpen(true);
    } else {
      openUrl(u, p);
    }
  };

  const handleOpen = () => {
    if (!target) {
      triggerFallback(
        'unknown',
        t('session_detail.no_meeting_link_fallback', {
          defaultValue: 'No meeting link available. Choose an alternative below.',
        }),
        'no_link'
      );
      return;
    }
    startOpen(target, provider);
  };

  const handlePreflightProceed = () => {
    const pending = pendingOpenRef.current;
    pendingOpenRef.current = null;
    if (pending) openUrl(pending.url, pending.provider);
  };

  const fallbackList = buildAlternatives(target);

  return (
    <>
      {isMeet ? (
        <Button
          size={size}
          className={className}
          onClick={handleOpen}
          aria-label={t('session_detail.open_meet_new_tab', {
            defaultValue: 'Open Google Meet in a new tab',
          })}
          title={t('session_detail.open_meet_new_tab_title', {
            defaultValue: 'Google Meet opens in a new tab (cannot be embedded)',
          })}
        >
          <Video className="w-4 h-4" />
          {t('session_detail.open_meet_new_tab_short', { defaultValue: 'Open Google Meet' })}
          <ExternalLink className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />
        </Button>
      ) : (
        <Button size={size} className={className} onClick={handleOpen}>
          <Play className="w-4 h-4" />
          {joinLabel ?? t('session_detail.join_session')}
        </Button>
      )}

      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" aria-hidden="true" />
              {t('session_detail.fallback_title', {
                defaultValue: 'Try an alternative video option',
              })}
            </DialogTitle>
            <DialogDescription>
              {t('session_detail.fallback_desc', {
                defaultValue:
                  '{{provider}} could not be opened. Choose another provider to join the session.',
                provider: PROVIDER_LABELS[failedProvider],
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-2">
            {fallbackList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('session_detail.fallback_none', {
                  defaultValue: 'No alternative video options are configured.',
                })}
              </p>
            ) : (
              fallbackList.map((alt) => (
                <Button
                  key={alt.url}
                  variant="outline"
                  className="justify-between gap-2"
                  onClick={() => {
                    logProviderEvent('fallback_selected', {
                      from: failedProvider,
                      to: alt.provider,
                      url: alt.url,
                    });
                    setFallbackOpen(false);
                    startOpen(alt.url, alt.provider);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Video className="w-4 h-4" aria-hidden="true" />
                    {alt.label}
                  </span>
                  <ExternalLink className="w-4 h-4 opacity-70" aria-hidden="true" />
                </Button>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setFallbackOpen(false)}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PreflightTestDialog
        open={preflightOpen}
        onOpenChange={(o) => {
          setPreflightOpen(o);
          if (!o) pendingOpenRef.current = null;
        }}
        onProceed={handlePreflightProceed}
        joinLabel={joinLabel ?? t('session_detail.join_session')}
      />
    </>
  );
}
