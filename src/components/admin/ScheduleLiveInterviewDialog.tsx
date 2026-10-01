import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { callInterviewFunction } from '@/lib/interviewRsvp';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  consultantUserId: string;
  consultantName: string;
}

type Person = { user_id: string; display_name: string | null };
type InviteResult = { sent: number; suppressed: number; failed: number; skipped: number };

const DURATIONS = ['30', '45', '60', '90', '120'];

export default function ScheduleLiveInterviewDialog({ open, onOpenChange, consultantId, consultantUserId, consultantName }: Props) {
  const navigate = useNavigate();
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState('60');
  const [videoMode, setVideoMode] = useState<'free' | 'own'>('free');
  const [ownUrl, setOwnUrl] = useState('');
  const [emailInvites, setEmailInvites] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setDuration('60');
    setVideoMode('free');
    setOwnUrl('');
    setEmailInvites(true);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user?.id ?? null);
      // The candidate can never be one of their own interviewers (an admin who is also the consultant being interviewed).
      setPicked(user && user.id !== consultantUserId ? [user.id] : []);
      // Possible interviewers: admins and verified consultants (excluding the candidate)
      const [{ data: admins }, { data: consultants }] = await Promise.all([
        supabase.from('user_roles').select('user_id').in('role', ['admin', 'super_admin']),
        supabase.from('consultants').select('user_id').eq('verification_status', 'verified'),
      ]);
      const ids = Array.from(new Set([...(admins || []), ...(consultants || [])].map((r: any) => r.user_id))).filter((x) => x !== consultantUserId);
      if (!ids.length) { setPeople([]); setLoaded(true); return; }
      const { data: profs } = await supabase.from('profiles').select('user_id, display_name').in('user_id', ids);
      setPeople(ids.map((uid) => ({ user_id: uid, display_name: profs?.find((p) => p.user_id === uid)?.display_name ?? null })));
      setLoaded(true);
    })();
  }, [open, consultantUserId]);

  const save = async () => {
    const interviewers = Array.from(new Set(picked)).filter((uid) => uid !== consultantUserId);
    if (!interviewers.length) { toast.error('Pick at least one interviewer other than the candidate'); return; }
    let customUrl: string | undefined;
    if (videoMode === 'own') {
      try {
        const parsed = new URL(ownUrl.trim());
        if (parsed.protocol !== 'https:') throw new Error('not https');
        customUrl = parsed.toString();
      } catch {
        toast.error('Enter a valid meeting link that starts with https://');
        return;
      }
    }
    setSaving(true);
    let createdId: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: sess, error } = await supabase.from('interview_sessions').insert({
        consultant_id: consultantId,
        interview_type: 'online',
        status: 'pending',
        requested_by: user?.id,
        interview_style: 'live',
        scheduled_at: when ? new Date(when).toISOString() : null,
        duration_minutes: Number(duration) || 60,
        ...(customUrl ? { meeting_url: customUrl } : {}),
      } as any).select('id').single();
      if (error) throw error;
      createdId = sess.id;
      const rows = [
        { session_id: sess.id, user_id: consultantUserId, role: 'candidate', display_name: consultantName },
        ...interviewers.map((uid) => ({ session_id: sess.id, user_id: uid, role: 'interviewer', display_name: people.find((p) => p.user_id === uid)?.display_name || (uid === me ? 'Admin' : 'Interviewer') })),
      ];
      const { error: pErr } = await supabase.from('interview_participants' as any).insert(rows);
      if (pErr) throw pErr;
      createdId = null;
      // The in-app invitation notification is created by a database trigger on interview_participants.
      // The e-mail invitation (with Accept / Suggest another time / Decline) is sent by an edge function.
      let invited = '';
      if (emailInvites) {
        const { data: result, error: inviteError } = await callInterviewFunction<InviteResult>('send-interview-invitations', { session_id: sess.id });
        if (inviteError || !result) {
          toast.warning(`Scheduled, but the invitation e-mails could not be sent (${inviteError || 'unknown error'}). Use "Send invitation e-mails again" in the interview room.`);
        } else if (result.sent) {
          invited = ` Invitation e-mail sent to ${result.sent} ${result.sent === 1 ? 'person' : 'people'}.`;
        } else if (result.suppressed + result.failed + result.skipped > 0) {
          toast.warning('Scheduled, but no invitation e-mail could be delivered (blocked or missing address). They can still answer in the app.');
        }
      }
      toast.success(`Live interview scheduled.${invited}`);
      onOpenChange(false);
      navigate(`/interview/live/${sess.id}`);
    } catch (e: any) {
      // Do not leave an empty session behind when the participants could not be added.
      if (createdId) await supabase.from('interview_sessions').delete().eq('id', createdId);
      toast.error(e?.message || 'Could not schedule interview');
    } finally {
      setSaving(false);
    }
  };

  const meInList = !!me && me !== consultantUserId && !people.some((p) => p.user_id === me);
  const noInterviewerAvailable = loaded && !meInList && people.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule live interview</DialogTitle>
          <DialogDescription>Interview {consultantName} in a live chat with a video call. Pick more than one interviewer for a panel.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="live-when">Date & time (optional — leave empty to start now)</Label>
              <Input id="live-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="live-duration">Length</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="live-duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => <SelectItem key={d} value={d}>{d} minutes</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Video conference</Label>
            <RadioGroup value={videoMode} onValueChange={(v) => setVideoMode(v === 'own' ? 'own' : 'free')} className="gap-2">
              <label className="flex items-start gap-2 rounded-lg border p-2 text-sm cursor-pointer">
                <RadioGroupItem value="free" className="mt-0.5" />
                <span>
                  <span className="font-medium">Free video call (Jitsi Meet)</span>
                  <span className="block text-xs text-muted-foreground">Created automatically and put into the calendar invitation.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border p-2 text-sm cursor-pointer">
                <RadioGroupItem value="own" className="mt-0.5" />
                <span>
                  <span className="font-medium">My own meeting link</span>
                  <span className="block text-xs text-muted-foreground">Zoom, Google Meet, Microsoft Teams or any https link.</span>
                </span>
              </label>
            </RadioGroup>
            {videoMode === 'own' && (
              <Input value={ownUrl} onChange={(e) => setOwnUrl(e.target.value)} placeholder="https://…" inputMode="url" aria-label="Meeting link" />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Interviewers</Label>
            <div className="max-h-56 overflow-y-auto rounded-lg border divide-y">
              {meInList && (
                <label className="flex items-center gap-2 p-2 text-sm">
                  <Checkbox checked={picked.includes(me!)} onCheckedChange={(c) => setPicked((p) => (c ? [...p, me!] : p.filter((x) => x !== me)))} /> You
                </label>
              )}
              {people.map((p) => (
                <label key={p.user_id} className="flex items-center gap-2 p-2 text-sm">
                  <Checkbox checked={picked.includes(p.user_id)} onCheckedChange={(c) => setPicked((s) => (c ? [...s, p.user_id] : s.filter((x) => x !== p.user_id)))} />
                  {p.display_name || 'Unnamed user'}{p.user_id === me ? ' (you)' : ''}
                </label>
              ))}
              {noInterviewerAvailable && (
                <p className="p-3 text-sm text-muted-foreground">
                  No interviewer is available. A live interview needs at least one interviewer other than the candidate: another admin or a verified consultant.
                </p>
              )}
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={emailInvites} onCheckedChange={(c) => setEmailInvites(c === true)} className="mt-0.5" />
            <span>
              E-mail the invitation to the other participants
              <span className="block text-xs text-muted-foreground">
                With Accept, Suggest another time and Decline buttons and the calendar links. Their answers come back to you by notification and e-mail.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || noInterviewerAvailable}>{saving && <Loader2 className="w-4 h-4 animate-spin me-1" />} Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
