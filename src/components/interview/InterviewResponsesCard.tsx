import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CalendarClock, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { callInterviewFunction, RSVP_LABEL } from '@/lib/interviewRsvp';
import { parseEmailList } from '@/lib/emailList';

export interface ResponsePerson {
  user_id: string;
  role: string;
  display_name: string | null;
  rsvp_status?: string | null;
  rsvp_note?: string | null;
  rsvp_at?: string | null;
  proposed_slots?: unknown;
}

interface Props {
  sessionId: string;
  organizerId: string | null;
  people: ResponsePerson[];
  done: boolean;
  onChanged: () => void;
}

interface Counts {
  sent: number;
  suppressed: number;
  failed: number;
}

interface SendResult {
  sent: number;
  suppressed: number;
  failed: number;
  skipped: number;
  extra?: Counts;
  cc?: Counts;
}

const slotsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((v) => (typeof v === 'string' ? v : (v as { start?: unknown })?.start))
        .filter((v): v is string => typeof v === 'string')
    : [];

/** Organizer view: who accepted, declined or asked for another time, with a one-click "use this time" and "resend". */
export default function InterviewResponsesCard({ sessionId, organizerId, people, done, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [extraTo, setExtraTo] = useState('');
  const [ccText, setCcText] = useState('');
  const invited = people.filter((p) => p.user_id !== organizerId);
  if (!invited.length) return null;

  const report = (r: SendResult | null) => {
    if (!r) return;
    const outsideSent = (r.extra?.sent ?? 0) + (r.cc?.sent ?? 0);
    const problems = r.suppressed + r.failed + r.skipped + (r.extra?.suppressed ?? 0) + (r.extra?.failed ?? 0) + (r.cc?.suppressed ?? 0) + (r.cc?.failed ?? 0);
    const sentTotal = r.sent + outsideSent;
    const detail = outsideSent ? ` (${r.extra?.sent ?? 0} other address, ${r.cc?.sent ?? 0} copy)` : '';
    if (sentTotal && !problems) toast.success(`Invitation e-mail sent: ${sentTotal} in total${detail}`);
    else if (sentTotal) toast.warning(`Sent ${sentTotal}${detail}, but ${problems} could not be e-mailed (blocked address, missing address or error)`);
    else toast.error('No invitation e-mail could be sent');
  };

  const run = async (key: string, body: Record<string, unknown>) => {
    const extra = parseEmailList(extraTo);
    const cc = parseEmailList(ccText);
    if (extra.error || cc.error) { toast.error(extra.error || cc.error || 'Check the e-mail addresses'); return; }
    setBusy(key);
    const { data, error } = await callInterviewFunction<SendResult>('send-interview-invitations', {
      session_id: sessionId,
      extra_to: extra.emails,
      cc: cc.emails,
      ...body,
    });
    setBusy(null);
    if (error) { toast.error(error); return; }
    report(data);
    onChanged();
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Mail className="w-4 h-4 text-primary" /> Invitations and answers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {invited.map((p) => {
          const status = p.rsvp_status || 'pending';
          const slots = slotsOf(p.proposed_slots);
          return (
            <div key={p.user_id} className="rounded-lg border p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{p.display_name || 'Participant'}</span>
                <Badge variant="outline" className="text-[10px]">{p.role}</Badge>
                <Badge variant={status === 'accepted' ? 'default' : status === 'declined' ? 'destructive' : 'secondary'} className="text-[10px]">
                  {RSVP_LABEL[status] || RSVP_LABEL.pending}
                </Badge>
                {p.rsvp_at && <span className="text-[10px] text-muted-foreground">{new Date(p.rsvp_at).toLocaleString()}</span>}
              </div>
              {p.rsvp_note && <p className="text-xs text-muted-foreground">Note: {p.rsvp_note}</p>}
              {status === 'reschedule_requested' && slots.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Suggested times (your local time):</p>
                  {slots.map((iso) => (
                    <div key={iso} className="flex items-center gap-2 text-xs">
                      <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>{new Date(iso).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</span>
                      {!done && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ms-auto h-7 text-xs"
                          disabled={busy !== null}
                          onClick={() => run(`slot-${iso}`, { action: 'reschedule', scheduled_at: iso })}
                        >
                          {busy === `slot-${iso}` ? <Loader2 className="w-3 h-3 animate-spin me-1" /> : null} Use this time
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!done && (
          <div className="space-y-2">
            <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setMoreOpen((v) => !v)}>
              {moreOpen ? 'Hide extra recipients' : 'Add another e-mail address or CC'}
            </button>
            {moreOpen && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-1">
                  <Label htmlFor="resend-extra-to" className="text-xs">Also send to another e-mail (for the candidate)</Label>
                  <Input id="resend-extra-to" value={extraTo} onChange={(e) => setExtraTo(e.target.value)} placeholder="name@example.com" inputMode="email" autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="resend-cc" className="text-xs">CC (a copy for information, without answer buttons)</Label>
                  <Input id="resend-cc" value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="hr@example.com, manager@example.com" inputMode="email" autoComplete="off" />
                </div>
                <p className="text-[10px] text-muted-foreground">Separate several addresses with commas (up to 5 in each box). These addresses are used when you send the e-mails again or use a suggested time, and they are not saved.</p>
              </div>
            )}
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('resend', { action: 'send' })}>
              {busy === 'resend' ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1" /> : <Mail className="w-3.5 h-3.5 me-1" />} Send invitation e-mails again
            </Button>
            <p className="text-[10px] text-muted-foreground">Everyone gets a fresh e-mail; the buttons in earlier e-mails stop working.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
