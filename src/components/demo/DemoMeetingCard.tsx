import { useEffect, useRef, useState } from 'react';
import { CalendarCheck, CalendarPlus, ExternalLink, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { buildIcs, formatInZone, safeMeetingLink, validTz } from '../../../supabase/functions/_shared/demoSchedule';

interface Meeting { status: string; meeting_at: string | null; meeting_duration_min: number | null; meeting_link: string | null; meeting_version: number | null; timezone: string | null; cancel_reason: string | null }

/** Downloads a calendar file (browser only). */
export function downloadIcs(name: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The confirmed demo on the requester's page: time in their zone (and this device's), join link, add to calendar.
 * Reads get_demo_meeting_by_token (docs/sql/demo-schedule-alerts.sql); shows nothing until that update is applied.
 */
export function DemoMeetingCard({ token, requestId }: { token: string; requestId: string }) {
  const [m, setM] = useState<Meeting | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const wantsCalendar = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('calendar') === '1';

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_demo_meeting_by_token' as never, { _token: token } as never);
        const row = Array.isArray(data) ? data[0] : data;
        if (live && !error && row) setM(row as Meeting);
      } catch { /* not available yet */ }
    })();
    return () => { live = false; };
  }, [token]);
  useEffect(() => { if (m && wantsCalendar) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [m, wantsCalendar]);

  if (!m || !m.meeting_at || (m.status !== 'scheduled' && m.status !== 'cancelled')) return null;
  const start = new Date(m.meeting_at);
  const tz = validTz(m.timezone) ? m.timezone! : 'UTC';
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const link = safeMeetingLink(m.meeting_link);
  const cancelled = m.status === 'cancelled';
  const ics = () => buildIcs({
    uid: `demo-${requestId}`, start, durationMin: m.meeting_duration_min ?? 30, title: 'AI Support 360 demo',
    description: `Join from your request page: ${window.location.origin}/demo/confirmation/${token}`, url: `${window.location.origin}/demo/confirmation/${token}`,
    status: 'CONFIRMED', sequence: m.meeting_version ?? 0,
  });

  return (
    <div ref={ref} className="mx-7 md:mx-10 mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
        {cancelled ? <XCircle className="w-3.5 h-3.5" /> : <CalendarCheck className="w-3.5 h-3.5" />}
        {cancelled ? 'Demo cancelled' : 'Your demo is confirmed'}
      </p>
      <p className={`mt-2 text-lg font-bold text-foreground ${cancelled ? 'line-through opacity-60' : ''}`}>{formatInZone(start, tz)}</p>
      {here && here !== tz && <p className="text-xs text-muted-foreground">On this device: {formatInZone(start, here)}</p>}
      {!cancelled && <p className="text-xs text-muted-foreground mt-1">{m.meeting_duration_min ?? 30} minutes</p>}
      {cancelled && m.cancel_reason && <p className="text-sm text-muted-foreground mt-2">Reason: {m.cancel_reason}</p>}
      {!cancelled && (
        <div className="mt-4 flex flex-wrap gap-2">
          {link ? (
            <Button asChild className="rounded-xl gap-2">
              <a href={link} target="_blank" rel="noopener noreferrer">Join the meeting <ExternalLink className="w-4 h-4" /></a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground self-center">The meeting link will appear here before the demo.</p>
          )}
          <Button variant={wantsCalendar ? 'default' : 'outline'} className="rounded-xl gap-2" onClick={() => downloadIcs('ai-support-360-demo.ics', ics())}>
            <CalendarPlus className="w-4 h-4" /> Add to calendar
          </Button>
        </div>
      )}
    </div>
  );
}
