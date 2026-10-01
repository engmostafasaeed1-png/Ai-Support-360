import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  consultantUserId: string;
  consultantName: string;
}

type Person = { user_id: string; display_name: string | null };

export default function ScheduleLiveInterviewDialog({ open, onOpenChange, consultantId, consultantUserId, consultantName }: Props) {
  const navigate = useNavigate();
  const [when, setWhen] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user?.id ?? null);
      if (user) setPicked([user.id]);
      // Possible interviewers: admins and verified consultants (excluding the candidate)
      const [{ data: admins }, { data: consultants }] = await Promise.all([
        supabase.from('user_roles').select('user_id').in('role', ['admin', 'super_admin']),
        supabase.from('consultants').select('user_id').eq('verification_status', 'verified'),
      ]);
      const ids = Array.from(new Set([...(admins || []), ...(consultants || [])].map((r: any) => r.user_id))).filter((x) => x !== consultantUserId);
      if (!ids.length) { setPeople([]); return; }
      const { data: profs } = await supabase.from('profiles').select('user_id, display_name').in('user_id', ids);
      setPeople(ids.map((uid) => ({ user_id: uid, display_name: profs?.find((p) => p.user_id === uid)?.display_name ?? null })));
    })();
  }, [open, consultantUserId]);

  const save = async () => {
    if (!picked.length) { toast.error('Pick at least one interviewer'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: sess, error } = await supabase.from('interview_sessions').insert({
        consultant_id: consultantId,
        interview_type: 'online',
        status: 'pending',
        requested_by: user?.id,
        interview_style: 'live',
        scheduled_at: when ? new Date(when).toISOString() : null,
      } as any).select('id').single();
      if (error) throw error;
      const rows = [
        { session_id: sess.id, user_id: consultantUserId, role: 'candidate', display_name: consultantName },
        ...picked.map((uid) => ({ session_id: sess.id, user_id: uid, role: 'interviewer', display_name: people.find((p) => p.user_id === uid)?.display_name || (uid === me ? 'Admin' : 'Interviewer') })),
      ];
      const { error: pErr } = await supabase.from('interview_participants' as any).insert(rows);
      if (pErr) throw pErr;
      await supabase.rpc('safe_insert_notification', {
        _user_id: consultantUserId,
        _title: 'Live interview scheduled',
        _body: when ? `Your live interview is on ${new Date(when).toLocaleString()}.` : 'A live interview is ready for you to join.',
        _type: 'interview',
        _link: `/interview/live/${sess.id}`,
      });
      toast.success('Live interview scheduled');
      onOpenChange(false);
      navigate(`/interview/live/${sess.id}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not schedule interview');
    } finally {
      setSaving(false);
    }
  };

  const meInList = me && !people.some((p) => p.user_id === me);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule live interview</DialogTitle>
          <DialogDescription>Interview {consultantName} in a live chat. Pick more than one interviewer for a panel.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="live-when">Date & time (optional — leave empty to start now)</Label>
            <Input id="live-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
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
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin me-1" />} Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
