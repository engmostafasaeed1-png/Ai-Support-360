import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CalendarClock, Check, Loader2, ShieldAlert, X } from 'lucide-react';
import LiveInterviewMeetingBar from '@/components/interview/LiveInterviewMeetingBar';
import { callInterviewFunction, RSVP_LABEL, type RsvpAnswer, type RsvpDetails } from '@/lib/interviewRsvp';

type Mode = 'accept' | 'decline' | 'reschedule';

const MODE_TO_ANSWER: Record<Mode, RsvpAnswer> = {
  accept: 'accepted',
  decline: 'declined',
  reschedule: 'reschedule_requested',
};

const THANKS: Record<RsvpAnswer, string> = {
  accepted: 'Thank you. You accepted the interview.',
  declined: 'Thank you. You declined the interview.',
  reschedule_requested: 'Thank you. Your suggested times were sent.',
};

/**
 * Public page opened from the buttons in the invitation e-mail. The secret in the link identifies the invited person.
 * The e-mail buttons only preselect an option: nothing is sent until the person confirms here, so link scanners
 * that open every link in an e-mail cannot answer on someone's behalf.
 */
export default function InterviewRespondPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const preselect = params.get('a');
  const [details, setDetails] = useState<RsvpDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode | null>(
    preselect === 'accept' || preselect === 'decline' || preselect === 'reschedule' ? preselect : null,
  );
  const [slots, setSlots] = useState<string[]>(['', '', '']);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<RsvpAnswer | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await callInterviewFunction<RsvpDetails>('interview-rsvp', { token, action: 'get' });
      if (!alive) return;
      if (error || !data) setLoadError(error || 'This link is not valid');
      else setDetails(data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const submit = async () => {
    if (!mode) return;
    let proposed: string[] | undefined;
    if (mode === 'reschedule') {
      proposed = slots
        .filter(Boolean)
        .map((v) => new Date(v))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.toISOString());
      if (!proposed.length) { setFormError('Please suggest at least one time.'); return; }
      if (proposed.some((iso) => new Date(iso).getTime() < Date.now())) { setFormError('The suggested times must be in the future.'); return; }
    }
    setSaving(true);
    setFormError(null);
    const { data, error } = await callInterviewFunction<RsvpDetails>('interview-rsvp', {
      token,
      action: 'respond',
      response: MODE_TO_ANSWER[mode],
      note: note.trim() || undefined,
      proposed_slots: proposed,
    });
    setSaving(false);
    if (error || !data) { setFormError(error || 'Could not send your answer. Please try again.'); return; }
    setDetails(data);
    setSent(MODE_TO_ANSWER[mode]);
  };

  const when = details?.scheduledAt ? new Date(details.scheduledAt) : null;
  const sessionId = details?.roomPath.split('/').pop() || '';

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4 md:p-8">
      <Helmet>
        <title>Live interview invitation</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Helmet>
      <div className="w-full max-w-xl space-y-4">
        {loading && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" aria-label="Loading" /></div>
        )}

        {!loading && loadError && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>We could not open this invitation</AlertTitle>
            <AlertDescription>
              {loadError}. Ask the organizer to send the invitation again, or sign in to answer from the interview room.
            </AlertDescription>
          </Alert>
        )}

        {!loading && details && (
          <>
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Live interview invitation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  {details.organizerName} invited you
                  {details.role === 'interviewer'
                    ? details.candidateName ? ` as an interviewer for ${details.candidateName}.` : ' as an interviewer.'
                    : details.role === 'candidate' ? ' as the candidate.' : '.'}
                </p>
                <div className="rounded-lg bg-muted/40 p-3 space-y-1">
                  <p className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-primary" />
                    {when
                      ? <span>{when.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} <span className="text-muted-foreground">(your device time)</span></span>
                      : <span>No fixed time yet. The room is open, join when you are ready.</span>}
                  </p>
                  {when && <p className="text-xs text-muted-foreground ps-6">{when.toUTCString()} · {details.durationMinutes} minutes</p>}
                  {details.others.length > 0 && (
                    <p className="text-xs text-muted-foreground ps-6">
                      With: {details.others.map((o) => `${o.name} (${o.role})`).join(', ')}
                    </p>
                  )}
                </div>
                <p className="flex items-center gap-2">
                  Your answer so far: <Badge variant="secondary">{RSVP_LABEL[details.myStatus] || RSVP_LABEL.pending}</Badge>
                </p>
              </CardContent>
            </Card>

            {details.finished ? (
              <Alert>
                <AlertTitle>This interview is already finished</AlertTitle>
                <AlertDescription>There is nothing left to answer.</AlertDescription>
              </Alert>
            ) : sent ? (
              <Alert>
                <Check className="h-4 w-4" />
                <AlertTitle>{THANKS[sent]}</AlertTitle>
                <AlertDescription>
                  {details.organizerName} was told by notification and e-mail.
                  {sent === 'accepted' ? ' Add the interview to your calendar below.' : ''}
                  {' '}You can change your answer by opening the link in your e-mail again.
                </AlertDescription>
              </Alert>
            ) : (
              <Card className="rounded-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Can you join?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={mode === 'accept' ? 'default' : 'outline'} onClick={() => setMode('accept')}>
                      <Check className="w-3.5 h-3.5 me-1" /> Accept
                    </Button>
                    <Button size="sm" variant={mode === 'reschedule' ? 'default' : 'outline'} onClick={() => setMode('reschedule')}>
                      <CalendarClock className="w-3.5 h-3.5 me-1" /> Suggest another time
                    </Button>
                    <Button size="sm" variant={mode === 'decline' ? 'destructive' : 'outline'} onClick={() => setMode('decline')}>
                      <X className="w-3.5 h-3.5 me-1" /> Decline
                    </Button>
                  </div>

                  {mode === 'reschedule' && (
                    <div className="space-y-2 rounded-lg border p-3">
                      <Label className="text-xs">Suggest up to three times (your device time)</Label>
                      {slots.map((value, i) => (
                        <Input
                          key={i}
                          type="datetime-local"
                          value={value}
                          onChange={(e) => setSlots((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                          aria-label={`Suggested time ${i + 1}`}
                        />
                      ))}
                    </div>
                  )}

                  {mode && (
                    <div className="space-y-2">
                      <Label htmlFor="rsvp-note" className="text-xs">
                        {mode === 'decline' ? 'Reason (optional)' : 'Note (optional)'}
                      </Label>
                      <Textarea id="rsvp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-[70px] text-sm" />
                      {formError && <p className="text-xs text-destructive" role="alert">{formError}</p>}
                      <Button onClick={submit} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : null}
                        {mode === 'accept' ? 'Confirm: I will join' : mode === 'decline' ? 'Confirm: I cannot join' : 'Send my suggestions'}
                      </Button>
                    </div>
                  )}
                  {!mode && <p className="text-xs text-muted-foreground">Choose an option to continue. Nothing is sent until you confirm.</p>}
                </CardContent>
              </Card>
            )}

            {!details.finished && sessionId && (
              <LiveInterviewMeetingBar
                sessionId={sessionId}
                storedMeetingUrl={details.meetingUrl}
                scheduledAt={details.scheduledAt}
                durationMinutes={details.durationMinutes}
                title={`Live interview: ${details.candidateName || 'Candidate'}`}
                attendees={details.others.map((o) => o.name)}
              />
            )}

            <p className="text-center text-xs text-muted-foreground">
              Have an account? <Link to={details.roomPath} className="underline">Open the interview room</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
