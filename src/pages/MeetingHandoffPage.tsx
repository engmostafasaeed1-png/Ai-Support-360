import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ExternalLink, Loader2, ShieldAlert, Frame, CheckCircle2 } from 'lucide-react';
import { isInIframe } from '@/components/session/FramedAppNotice';
import { detectProvider } from '@/components/session/MeetingLinkButton';
import { hostIsOneOf } from '@/lib/safeUrl';
import { logProviderEvent } from '@/lib/diagnostics';
import { sessionRoomUrl } from '@/lib/meetingRoom';

const PROVIDER_LABEL: Record<string, string> = {
  meet: 'Google Meet',
  jitsi: 'Jitsi Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  unknown: 'Meeting',
};

// Only these providers are opened automatically; any other host needs an explicit click (prevents use as an open redirect).
const TRUSTED_MEETING_DOMAINS = ['meet.google.com', 'meet.jit.si', 'zoom.us', 'teams.microsoft.com', 'teams.live.com'];

/**
 * Dedicated meeting handoff page. The "Join in new tab" button on the session
 * page links here with `target="_blank"`, which guarantees the browser opens
 * this URL in a top-level tab. From here we redirect the tab to the actual
 * meeting URL — never inside a frame.
 *
 * URL format: /join/:sessionId?to=<encoded meeting url>
 *
 * Why this exists: when our app runs inside an iframe (Lovable preview, an
 * embedded portal view, etc.), browsers may keep `_blank` popups in the same
 * frame tree, and providers like Google Meet refuse to load framed (returns
 * ERR_BLOCKED_BY_RESPONSE). This page is a frame-free trampoline.
 */
export default function MeetingHandoffPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [autoRedirected, setAutoRedirected] = useState(false);

  const target = useMemo(() => {
    const raw = params.get('to');
    if (raw) {
      try {
        const decoded = decodeURIComponent(raw);
        const u = new URL(decoded);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        return decoded;
      } catch {
        return null;
      }
    }
    // Fallback: deterministic Jitsi room when only sessionId is provided.
    if (sessionId) return sessionRoomUrl(sessionId);
    return null;
  }, [params, sessionId]);

  const provider = target ? detectProvider(target) : 'unknown';
  const trusted = !!target && hostIsOneOf(target, TRUSTED_MEETING_DOMAINS);
  const targetHost = (() => {
    try {
      return target ? new URL(target).hostname : '';
    } catch {
      return '';
    }
  })();
  const framed = isInIframe();

  // If we somehow ended up framed (e.g. user opened the link in the same tab
  // while still inside the parent frame), break out to the top-level window.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!framed) return;
    try {
      // Replace the top window so the user keeps a clean back-stack.
      const here = window.location.href;
      logProviderEvent('open_attempt', {
        stage: 'handoff_break_frame',
        sessionId,
        target,
        provider,
      });
      window.top!.location.href = here;
    } catch {
      // Cross-origin parent — we can't break out programmatically.
      setError('framed');
    }
  }, [framed, provider, sessionId, target]);

  // Auto-redirect once when target is valid and we're top-level.
  useEffect(() => {
    if (!target || framed || autoRedirected || !trusted) return;
    setAutoRedirected(true);
    logProviderEvent('opened', {
      stage: 'handoff_redirect',
      sessionId,
      target,
      provider,
    });
    // Tiny delay so the user sees the "Opening…" state and the page paints.
    const id = window.setTimeout(() => {
      window.location.replace(target);
    }, 350);
    return () => window.clearTimeout(id);
  }, [target, framed, autoRedirected, trusted, provider, sessionId]);

  if (!target) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full rounded-2xl border-border/50">
          <CardHeader>
            <h1 className="font-semibold leading-none tracking-tight flex items-center gap-2 text-destructive">
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
              Invalid meeting link
            </h1>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              We couldn't find a valid meeting URL for this session. Please return to the
              session page and ask the organizer to share an updated link.
            </p>
            <Button variant="outline" onClick={() => window.history.back()}>
              Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="max-w-md w-full rounded-2xl border-border/50">
        <CardHeader>
          <h1 className="font-semibold leading-none tracking-tight flex items-center gap-2">
            {framed ? (
              <>
                <Frame className="w-5 h-5 text-amber-600" aria-hidden="true" />
                Open in a top-level tab
              </>
            ) : trusted ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
                Opening {PROVIDER_LABEL[provider]}…
              </>
            ) : (
              <>
                <ShieldAlert className="w-5 h-5 text-amber-600" aria-hidden="true" />
                Check this link before opening
              </>
            )}
          </h1>
        </CardHeader>
        <CardContent className="space-y-4">
          {framed && error === 'framed' ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Embedded view detected</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  This handoff page is loaded inside an iframe and we can't break out
                  automatically (the parent page is on a different origin). Click the button
                  below to open the meeting in a real browser tab.
                </p>
              </AlertDescription>
            </Alert>
          ) : trusted ? (
            <p className="text-sm text-muted-foreground">
              Your meeting will open in this tab. If nothing happens within a few seconds, click
              the button below.
            </p>
          ) : (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Unrecognised meeting provider</AlertTitle>
              <AlertDescription>
                This link leads to <strong>{targetHost}</strong>, which is not a known meeting provider, so it will not open automatically. Continue only if you trust whoever sent it.
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground break-all">
            <span className="font-medium text-foreground">URL:</span> {target}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              className="gradient-primary border-0 gap-1.5"
              onClick={() => {
                logProviderEvent('opened', {
                  stage: 'handoff_manual',
                  sessionId,
                  target,
                  provider,
                });
                // Use _top to escape any wrapping frame on the manual click too.
                window.open(target, '_top');
              }}
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              Open {PROVIDER_LABEL[provider]} now
            </Button>
            <Button variant="outline" onClick={() => window.close()}>
              Close
            </Button>
          </div>

          {!framed && autoRedirected && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              Redirecting…
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
