import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CalendarClock, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { callInterviewFunction, RSVP_LABEL, type RsvpAnswer } from '@/lib/interviewRsvp';

interface Props {
  sessionId: string;
  status: string;
  organizerName?: string;
  onAnswered: () => void;
}

type Mode = 'decline' | 'reschedule' | null;

/** Lets a signed-in participant answer the invitation inside the app: accept, decline or suggest other times. */
export default function InterviewRsvpCard({ sessionId, status, organizerName, onAnswered }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [slots, setSlots] = useState<string[]>(['', '', '']);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const send = async (answer: RsvpAnswer) => {
    let proposed: string[] | undefined;
    if (answer === 'reschedule_requested') {
      proposed = slots
        .filter(Boolean)
        .map((v) => new Date(v))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.toISOString());
      if (!proposed.length) { toast.error('Please suggest at least one time'); return; }
      if (proposed.some((iso) => new Date(iso).getTime() < Date.now())) { toast.error('The suggested times must be in the future'); return; }
    }
    setSaving(true);
    const { data, error } = await callInterviewFunction('interview-rsvp', {
      action: 'respond',
      session_id: sessionId,
      response: answer,
      note: note.trim() || undefined,
      proposed_slots: proposed,
    });
    setSaving(false);
    if (error || !data) { toast.error(error || 'Could not send your answer'); return; }
    toast.success(organizerName ? `Your answer was sent to ${organizerName}` : 'Your answer was sent');
    setMode(null);
    setNote('');
    setSlots(['', '', '']);
    onAnswered();
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Your answer
          <Badge variant={status === 'accepted' ? 'default' : 'secondary'} className="text-[10px]">{RSVP_LABEL[status] || RSVP_LABEL.pending}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {organizerName ? `${organizerName} will be told by notification and e-mail.` : 'The organizer will be told by notification and e-mail.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => send('accepted')} disabled={saving || status === 'accepted'}>
            {saving && mode === null ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1" /> : <Check className="w-3.5 h-3.5 me-1" />} Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode(mode === 'reschedule' ? null : 'reschedule')} disabled={saving}>
            <CalendarClock className="w-3.5 h-3.5 me-1" /> Suggest another time
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode(mode === 'decline' ? null : 'decline')} disabled={saving}>
            <X className="w-3.5 h-3.5 me-1" /> Decline
          </Button>
        </div>

        {mode === 'reschedule' && (
          <div className="space-y-2 rounded-lg border p-3">
            <Label className="text-xs">Suggest up to three times (your local time)</Label>
            {slots.map((value, i) => (
              <Input
                key={i}
                type="datetime-local"
                value={value}
                onChange={(e) => setSlots((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`Suggested time ${i + 1}`}
              />
            ))}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Note (optional)" className="min-h-[60px] text-xs" />
            <Button size="sm" onClick={() => send('reschedule_requested')} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1" /> : null} Send suggestions
            </Button>
          </div>
        )}

        {mode === 'decline' && (
          <div className="space-y-2 rounded-lg border p-3">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Reason (optional)" className="min-h-[60px] text-xs" />
            <Button size="sm" variant="destructive" onClick={() => send('declined')} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1" /> : null} Confirm decline
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
