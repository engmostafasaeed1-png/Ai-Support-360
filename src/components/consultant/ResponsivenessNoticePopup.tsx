import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Loader2, Timer } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSessionReady } from '@/hooks/useSessionReady';
import {
  ackResponsivenessNotice, POPUP_NOTICE_KINDS, RESPONSIVENESS_NOTICES_KEY, useResponsivenessNotices, type ResponsivenessNotice,
} from '@/hooks/useResponsiveness';
import { noticeCopy } from '../../../supabase/functions/_shared/responsivenessCopy';

// Notices handled in this browser: shown this session (sessionStorage, per tab) and acknowledged (localStorage, shared
// with other tabs through the storage event). The database stays the source of truth; these only stop re-opening.
const SHOWN_KEY = 'aisupport360.resp-notices.shown';
const ACKED_KEY = 'aisupport360.resp-notices.acked';
const readIds = (store: Storage | undefined, key: string): string[] => {
  try { const v = JSON.parse(store?.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};
const addIds = (store: Storage | undefined, key: string, ids: string[]) => {
  try { store?.setItem(key, JSON.stringify([...new Set([...readIds(store, key), ...ids])].slice(-200))); } catch { /* storage blocked */ }
};
const session = typeof window === 'undefined' ? undefined : window.sessionStorage;
const local = typeof window === 'undefined' ? undefined : window.localStorage;
const logDev = (what: string, e: unknown) => { if (import.meta.env.DEV) console.error(`[responsiveness] ${what}`, e); };

/**
 * Feature M popup for notices that change the consultant's statistics (counted no-response, friendly notices, indicator
 * shown, dispute result). "Not counted" notices are informational: the bell already has the line, so they are
 * acknowledged quietly without a popup. One popup at a time with "1 of N"; it closes only after the acknowledgement is
 * saved (otherwise it stays with a retry), and a notice never opens twice in a session or after it was acknowledged.
 */
export default function ResponsivenessNoticePopup() {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const { signedIn } = useSessionReady();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useResponsivenessNotices(signedIn);
  const [acked, setAcked] = useState<string[]>(() => readIds(local, ACKED_KEY));
  const [current, setCurrent] = useState<ResponsivenessNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const quietDone = useRef(new Set<string>());
  // The notices waiting when the first popup opened, for "1 of 3", "2 of 3"...
  const [batch, setBatch] = useState<string[]>([]);

  // Another tab acknowledged a notice.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === ACKED_KEY) setAcked(readIds(local, ACKED_KEY)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const markAcked = useCallback((ids: string[]) => {
    addIds(local, ACKED_KEY, ids);
    setAcked((a) => [...new Set([...a, ...ids])]);
    qc.setQueryData<ResponsivenessNotice[]>(RESPONSIVENESS_NOTICES_KEY, (old) => (old ?? []).filter((n) => !ids.includes(n.id)));
  }, [qc]);

  const open = useMemo(() => (data ?? []).filter((n) => !acked.includes(n.id)), [data, acked]);
  const popups = useMemo(() => open.filter((n) => POPUP_NOTICE_KINDS(n.kind)), [open]);

  // Informational notices: acknowledge quietly once (no popup).
  useEffect(() => {
    for (const n of open) {
      if (POPUP_NOTICE_KINDS(n.kind) || quietDone.current.has(n.id)) continue;
      quietDone.current.add(n.id);
      ackResponsivenessNotice(n.id).then(() => markAcked([n.id])).catch((e) => logDev('quiet acknowledgement failed', e));
    }
  }, [open, markAcked]);

  // Next popup: not acknowledged and not shown yet in this session.
  useEffect(() => {
    if (current) {
      if (acked.includes(current.id)) { setCurrent(null); setFailed(false); }
      return;
    }
    const shown = readIds(session, SHOWN_KEY);
    const waiting = popups.filter((n) => !shown.includes(n.id));
    const next = waiting[0];
    if (!next) return;
    addIds(session, SHOWN_KEY, [next.id]);
    setBatch((b) => (b.includes(next.id) ? b : waiting.map((n) => n.id)));
    setCurrent(next);
    setFailed(false);
  }, [popups, current, acked]);

  if (!current) return null;
  const total = Math.max(1, batch.length);
  const position = Math.max(1, batch.indexOf(current.id) + 1);
  const copy = noticeCopy({ lang, kind: current.kind, count30: current.count_30d, warningsTotal: current.warnings_total });
  const good = current.kind === 'dispute_upheld';

  const finish = async (ids: string[], to?: string) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      for (const id of ids) await ackResponsivenessNotice(id);
      markAcked(ids);
      setCurrent(null);
      if (to) navigate(to);
    } catch (e) {
      logDev('acknowledgement failed', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  // "Dismiss all": this notice and every later one of the batch that is still open.
  const all = [current.id, ...batch.slice(position).filter((id) => popups.some((n) => n.id === id))];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) void finish([current.id]); }}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()} data-testid="responsiveness-popup">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {good
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              : <AlertTriangle className="h-5 w-5 shrink-0 text-warning motion-safe:animate-pulse" aria-hidden="true" />}
            <DialogTitle>{copy.title}</DialogTitle>
          </div>
          {total > 1 && <p className="text-xs text-muted-foreground">{t('responsiveness.popup_counter', '{{n}} of {{total}}', { n: position, total })}</p>}
          <DialogDescription aria-live="polite">{copy.body}</DialogDescription>
        </DialogHeader>
        <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('responsiveness.popup_improve', 'Accept or decline every request within the time limit (a decline counts as a response), keep your availability up to date and mark vacations in advance.')}
        </p>
        {failed && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs">
            <span>{t('responsiveness.popup_failed', 'This could not be saved. Please try again.')}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void finish([current.id])}>{t('responsiveness.popup_retry', 'Try again')}</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setCurrent(null); setFailed(false); }}>{t('responsiveness.popup_later', 'Close for now')}</Button>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          {copy.showDispute && (
            <Button variant="outline" disabled={busy} onClick={() => void finish([current.id], `/consultant/responsiveness?event=${current.event_id}&dispute=1`)}>
              {t('responsiveness.popup_dispute', 'Dispute')}
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void finish([current.id], `/consultant/responsiveness?event=${current.event_id}`)}>
            {t('responsiveness.popup_open', 'My responsiveness')}
          </Button>
          {total > 1 && (
            <Button variant="outline" disabled={busy} onClick={() => void finish(all)}>{t('responsiveness.popup_ok_all', 'Understood, dismiss all')}</Button>
          )}
          <Button disabled={busy} onClick={() => void finish([current.id])} autoFocus>
            {busy && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden="true" />}{t('responsiveness.popup_ok', 'Understood')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
