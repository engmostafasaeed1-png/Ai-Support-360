import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, ExternalLink, Send, Volume2, VolumeX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SubmitProposalModal from '@/components/consultant/SubmitProposalModal';
import { useCriticalMyAlerts, useDismissCriticalAlert, useNow } from '@/hooks/useCriticalService';
import { startAlarm } from '@/lib/alarmSound';
import { alertKey, formatCountdown, formatDeadline, formatPercent, formatWindow, isOpenAlert, msLeft, openAlerts } from '@/lib/criticalService';

const ALERT_TITLE = 'CRITICAL request - AI Support 360';
const MUTE_KEY = 'critical-alarm-muted';

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // storage can be blocked: the choice then lasts until the page is closed
  }
}

/**
 * The alarm of a consultant: when a client opens a critical request for a SAP area of this consultant, a window with a countdown opens on
 * whatever page the consultant is on, with a repeating sound, a flashing tab title and (when allowed) a desktop notification.
 * "Reply now" opens the proposal form; the surcharge applies to a proposal that is sent before the countdown ends.
 */
export default function CriticalAlarm() {
  const alertsQ = useCriticalMyAlerts();
  const dismiss = useDismissCriticalAlert();
  const alerts = alertsQ.data ?? [];
  // the clock only runs while at least one alert can still be answered
  const now = useNow(alerts.some((a) => isOpenAlert(a)) ? 1000 : 0);
  // the alerts that were closed with "Remind me later": a reminder or a change of the client (a new last_alerted_at) opens the window again
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [muted, setMuted] = useState(readMuted);
  const [, setPermissionAsked] = useState(0);

  const open = openAlerts(alerts, now);
  const current = open.find((a) => !seen.has(alertKey(a))) ?? null;
  const key = current ? alertKey(current) : '';
  const currentRef = useRef(current);
  currentRef.current = current;

  // the repeating sound
  useEffect(() => {
    if (!key || muted) return;
    const alarm = startAlarm();
    return () => alarm.stop();
  }, [key, muted]);

  // a desktop notification when the tab is in the background
  useEffect(() => {
    const active = currentRef.current;
    if (!key || !active || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
    let note: Notification | null = null;
    try {
      note = new Notification(`CRITICAL request - reply within ${formatWindow(active.minutes)} (+${formatPercent(active.surcharge_percent)})`, {
        body: active.title,
        tag: key,
        requireInteraction: true,
      });
      note.onclick = () => {
        window.focus();
        note?.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
    return () => note?.close();
  }, [key]);

  // the tab title flashes while the alarm is open
  useEffect(() => {
    if (!key) return;
    let base = document.title;
    const id = window.setInterval(() => {
      if (document.title === ALERT_TITLE) {
        document.title = base;
      } else {
        base = document.title;
        document.title = ALERT_TITLE;
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
      if (document.title === ALERT_TITLE) document.title = base;
    };
  }, [key]);

  if (!current) return null;

  const left = msLeft(current.due_at, now);
  const percent = formatPercent(current.surcharge_percent);
  const others = open.length - 1;
  const later = () => setSeen((prev) => new Set(prev).add(key));
  const notForMe = () => {
    dismiss.mutate(current.ticket_id);
    later();
  };
  const toggleMute = () => {
    writeMuted(!muted);
    setMuted(!muted);
  };
  const canAskPermission = typeof Notification !== 'undefined' && Notification.permission === 'default';
  const askPermission = () => {
    void Notification.requestPermission().then(() => setPermissionAsked((n) => n + 1));
  };

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) later();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-2 border-red-500 sm:max-w-md" data-testid="critical-alarm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 animate-pulse items-center justify-center rounded-full bg-red-600 text-white">
              <AlarmClock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg text-red-700 dark:text-red-400">
                {current.extensions > 0 ? 'Updated critical request' : 'Critical request'}
              </DialogTitle>
              <DialogDescription>{`Reply with a bid and your hourly rate gets +${percent} on this ticket.`}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl bg-red-50 p-3 text-center dark:bg-red-950/30">
            <p className="font-mono text-4xl font-bold tabular-nums text-red-700 dark:text-red-400" data-testid="critical-alarm-countdown">
              {formatCountdown(left)}
            </p>
            <p className="text-xs text-muted-foreground">{`left to reply, until ${formatDeadline(current.due_at)}`}</p>
          </div>

          <div>
            <p className="font-semibold text-foreground">{current.title}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {current.areas.map((area) => (
                <Badge key={area} variant="secondary" className="text-[10px]">{area}</Badge>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {`You set your own rate. If the client accepts a bid that was sent in time, your approved hourly rate is your rate plus ${percent}.`}
          </p>
          {others > 0 && (
            <p className="text-xs font-medium text-red-700 dark:text-red-400">
              {others === 1 ? '1 more critical request is waiting' : `${others} more critical requests are waiting`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <SubmitProposalModal
            ticketId={current.ticket_id}
            ticketTitle={current.title}
            criticalPercent={current.surcharge_percent}
            criticalDueAt={current.due_at}
            trigger={
              <Button className="flex-1 gap-1.5 bg-red-600 text-white hover:bg-red-700">
                <Send className="h-4 w-4" /> Reply now
              </Button>
            }
          />
          <Button variant="outline" className="flex-1 gap-1.5" asChild onClick={later}>
            <Link to={`/consultant/tickets/${current.ticket_id}`}>
              <ExternalLink className="h-4 w-4" /> Open the ticket
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <Button variant="ghost" size="sm" onClick={notForMe} disabled={dismiss.isPending}>Not for me</Button>
          <Button variant="ghost" size="sm" onClick={later}>Remind me later</Button>
          <Button variant="ghost" size="sm" className="gap-1" onClick={toggleMute} aria-pressed={muted}>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {muted ? 'Sound off' : 'Sound on'}
          </Button>
        </div>
        {canAskPermission && (
          <button type="button" className="text-start text-xs text-primary underline" onClick={askPermission}>
            Allow desktop alerts, so that you hear about the next critical request even when this tab is in the background
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
