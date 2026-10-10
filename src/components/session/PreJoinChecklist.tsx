import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Frame,
  ShieldAlert,
  Globe,
  Info,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isInIframe } from './FramedAppNotice';
import {
  detectProvider,
  type MeetingProvider,
} from './MeetingLinkButton';
import { logProviderEvent } from '@/lib/diagnostics';

export type CheckStatus = 'pending' | 'pass' | 'warn' | 'fail';

export interface ChecklistItem {
  id: 'top_level' | 'popup' | 'url' | 'provider_framing' | 'secure';
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
  fixCta?: { label: string; onClick: () => void };
}

interface PreJoinChecklistProps {
  url: string;
  /** Friendly id used as the storage namespace and for diagnostic events. */
  sessionId?: string;
  /** Top-level URL to recommend opening if the app is framed. Defaults to current href. */
  topLevelUrl?: string;
  /** Hide once all checks pass and the user has acknowledged. */
  autoHideOnPass?: boolean;
}

const PROVIDER_FRAMED_BLOCKED: MeetingProvider[] = ['meet', 'teams']; // refuse to load inside iframes

const PROVIDER_LABEL: Record<MeetingProvider, string> = {
  meet: 'Google Meet',
  jitsi: 'Jitsi Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  unknown: 'Meeting',
};

/**
 * Pre-join checklist that verifies the session can open externally and
 * surfaces actionable guidance if blocked by provider framing rules.
 *
 * Checks:
 *  1. Secure context (HTTPS) - required for getUserMedia + most providers.
 *  2. Top-level context - warns if the app is in an iframe (Meet/Teams refuse to frame).
 *  3. Popup permission - probes window.open, only when the person clicks "Re-run checks" (see below).
 *  4. URL validity - verifies the meeting URL is well-formed and uses https.
 *  5. Provider framing rule - explicitly fails if framed AND provider is known to block frames.
 *
 * The popup probe needs a click: without one every browser blocks the popup, so an automatic probe would
 * report "blocked" for everybody. The probe must not use "noopener" either, because window.open then always
 * returns null, even when the popup opened. A real block is still caught when the person clicks Join
 * (MeetingLinkButton shows the alternatives).
 */
export default function PreJoinChecklist({
  url,
  sessionId,
  topLevelUrl,
  autoHideOnPass = true,
}: PreJoinChecklistProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [running, setRunning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  // Result of the last manual popup probe, kept when the checks run again by themselves.
  const popupItemRef = useRef<ChecklistItem | null>(null);

  const provider = useMemo(() => detectProvider(url), [url]);

  const openTopLevel = useCallback(() => {
    const target = topLevelUrl || (typeof window !== 'undefined' ? window.location.href : '#');
    window.open(target, '_blank', 'noopener,noreferrer');
  }, [topLevelUrl]);

  const runChecks = useCallback(async (probePopup = false) => {
    setRunning(true);
    logProviderEvent('preflight_open', { stage: 'checklist_start', sessionId, provider });
    const next: ChecklistItem[] = [];

    // 1. Secure context.
    const secure = typeof window !== 'undefined' && window.isSecureContext !== false;
    next.push({
      id: 'secure',
      label: t('checklist.secure', { defaultValue: 'Secure connection (HTTPS)' }),
      status: secure ? 'pass' : 'fail',
      detail: secure
        ? undefined
        : t('checklist.secure_detail', {
            defaultValue: 'This page is not served over HTTPS, which is required by most video providers.',
          }),
      fix: secure
        ? undefined
        : t('checklist.secure_fix', {
            defaultValue: 'Reopen this page over a secure (https://) connection.',
          }),
    });

    // 2. URL validity.
    let urlOk = false;
    let urlReason = '';
    try {
      const parsed = new URL(url);
      urlOk = parsed.protocol === 'https:';
      if (!urlOk) urlReason = `protocol=${parsed.protocol}`;
    } catch {
      urlReason = 'parse_error';
    }
    next.push({
      id: 'url',
      label: t('checklist.url', { defaultValue: 'Meeting link is valid' }),
      status: urlOk ? 'pass' : 'fail',
      detail: urlOk
        ? undefined
        : t('checklist.url_detail', {
            defaultValue: 'The meeting link is missing or not a valid HTTPS URL ({{reason}}).',
            reason: urlReason || 'unknown',
          }),
      fix: urlOk
        ? undefined
        : t('checklist.url_fix', {
            defaultValue: 'Ask the organizer to share an updated meeting link.',
          }),
    });

    // 3. Top-level context.
    const framed = isInIframe();
    next.push({
      id: 'top_level',
      label: t('checklist.top_level', { defaultValue: 'Running in a top-level browser tab' }),
      status: framed ? 'warn' : 'pass',
      detail: framed
        ? t('checklist.top_level_detail', {
            defaultValue: 'The app is currently embedded inside another page (iframe).',
          })
        : undefined,
      fix: framed
        ? t('checklist.top_level_fix', {
            defaultValue: 'Open the app in a new browser tab so the meeting can launch correctly.',
          })
        : undefined,
      fixCta: framed
        ? {
            label: t('checklist.top_level_cta', { defaultValue: 'Open in a new tab' }),
            onClick: openTopLevel,
          }
        : undefined,
    });

    // 4. Provider framing rule.
    const providerBlocksFraming = PROVIDER_FRAMED_BLOCKED.includes(provider);
    const framingFails = framed && providerBlocksFraming;
    if (providerBlocksFraming) {
      next.push({
        id: 'provider_framing',
        label: t('checklist.provider_framing', {
          defaultValue: '{{provider}} can open from this page',
          provider: PROVIDER_LABEL[provider],
        }),
        status: framingFails ? 'fail' : 'pass',
        detail: framingFails
          ? t('checklist.provider_framing_detail', {
              defaultValue:
                '{{provider}} refuses to load when the calling page is embedded in a frame (X-Frame-Options / frame-ancestors). The browser will show ERR_BLOCKED_BY_RESPONSE.',
              provider: PROVIDER_LABEL[provider],
            })
          : undefined,
        fix: framingFails
          ? t('checklist.provider_framing_fix', {
              defaultValue:
                'Open the app in a new browser tab, then click Join again. The meeting will launch in its own tab.',
            })
          : undefined,
        fixCta: framingFails
          ? {
              label: t('checklist.top_level_cta', { defaultValue: 'Open in a new tab' }),
              onClick: openTopLevel,
            }
          : undefined,
      });
    }

    // 5. Popup permission probe - open a tiny blank window, see if it opened, close it. Only after a click (see the note above).
    if (probePopup) {
      let popupAllowed = true;
      try {
        const probe = window.open('', '_blank', 'width=200,height=200');
        if (!probe) popupAllowed = false;
        else {
          try {
            probe.close();
          } catch {
            /* ignore */
          }
        }
      } catch {
        popupAllowed = false;
      }
      popupItemRef.current = {
        id: 'popup',
        label: t('checklist.popup', { defaultValue: 'Popups are allowed for this site' }),
        status: popupAllowed ? 'pass' : 'fail',
        detail: popupAllowed
          ? undefined
          : t('checklist.popup_detail', {
              defaultValue:
                'Your browser blocked a popup. The meeting tab cannot open without popup permission for this site.',
            }),
        fix: popupAllowed
          ? undefined
          : t('checklist.popup_fix', {
              defaultValue:
                'Click the popup-blocked icon in the address bar and choose "Always allow popups for this site", then re-run the checks.',
            }),
      };
    }
    if (popupItemRef.current) next.push(popupItemRef.current);

    setItems(next);
    setRunning(false);

    const failed = next.filter((i) => i.status === 'fail').map((i) => i.id);
    const warned = next.filter((i) => i.status === 'warn').map((i) => i.id);
    if (failed.length || warned.length) {
      // A failed check depends on the visitor's browser or on the meeting link: it is a warning for analytics, never an error report.
      logProviderEvent('fallback_shown', { stage: 'checklist_result', sessionId, provider, failed, warned }, 'warn');
    } else {
      logProviderEvent('preflight_proceed', { stage: 'checklist_pass', sessionId, provider });
    }
  }, [openTopLevel, provider, sessionId, t, url]);

  // Re-run on visibility (user came back from changing browser settings).
  useEffect(() => {
    runChecks();
    const onVis = () => {
      if (document.visibilityState === 'visible') runChecks();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [runChecks]);

  const hasFail = items.some((i) => i.status === 'fail');
  const hasWarn = items.some((i) => i.status === 'warn');
  const allPass = items.length > 0 && !hasFail && !hasWarn;

  if (autoHideOnPass && allPass && acknowledged) return null;

  return (
    <Alert
      variant={hasFail ? 'destructive' : 'default'}
      className={
        hasFail
          ? undefined
          : hasWarn
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-emerald-500/30 bg-emerald-500/10'
      }
    >
      <div className="flex items-start gap-2">
        {hasFail ? (
          <ShieldAlert className="h-4 w-4 mt-0.5" aria-hidden="true" />
        ) : hasWarn ? (
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600" aria-hidden="true" />
        )}
        <div className="flex-1 space-y-2">
          <AlertTitle>
            {hasFail
              ? t('checklist.title_fail', { defaultValue: 'Pre-join checks failed' })
              : hasWarn
                ? t('checklist.title_warn', {
                    defaultValue: 'Pre-join checks completed with warnings',
                  })
                : t('checklist.title_pass', { defaultValue: 'Ready to join' })}
          </AlertTitle>
          <AlertDescription>
            <ul className="space-y-2">
              {items.map((item) => (
                <ChecklistRow key={item.id} item={item} />
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => runChecks(true)} disabled={running}>
                {running ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
                )}
                {t('checklist.rerun', { defaultValue: 'Re-run checks' })}
              </Button>
              {allPass && !acknowledged && (
                <Button size="sm" onClick={() => setAcknowledged(true)}>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                  {t('checklist.dismiss', { defaultValue: 'Looks good' })}
                </Button>
              )}
            </div>
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const { t } = useTranslation();
  const Icon =
    item.status === 'pass'
      ? CheckCircle2
      : item.status === 'warn'
        ? AlertTriangle
        : item.status === 'fail'
          ? XCircle
          : Loader2;
  const iconClass =
    item.status === 'pass'
      ? 'text-emerald-600'
      : item.status === 'warn'
        ? 'text-amber-600'
        : item.status === 'fail'
          ? 'text-destructive'
          : 'text-muted-foreground animate-spin';

  const RowIcon =
    item.id === 'top_level'
      ? Frame
      : item.id === 'popup'
        ? Info
        : item.id === 'url'
          ? Globe
          : item.id === 'provider_framing'
            ? Frame
            : Globe;

  return (
    <li className="flex items-start gap-2">
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="flex-1 text-sm">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <RowIcon className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          {item.label}
        </div>
        {item.detail && <p className="text-muted-foreground mt-0.5">{item.detail}</p>}
        {item.fix && (
          <p className="text-foreground/90 mt-1">
            <span className="font-medium">
              {t('checklist.fix_label', { defaultValue: 'Fix' })}:
            </span>{' '}
            {item.fix}
          </p>
        )}
        {item.fixCta && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={item.fixCta.onClick}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {item.fixCta.label}
          </Button>
        )}
      </div>
    </li>
  );
}
