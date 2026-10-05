import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle, Check, Trash2, Plus, Clock } from 'lucide-react';
import { toast } from 'sonner';

export const ITEM_KINDS = [
  { kind: 'certificates', label: 'Certificates' },
  { kind: 'links', label: 'LinkedIn / Credly profiles' },
  { kind: 'cv', label: 'CV & work experience' },
] as const;

export const DEFAULT_PERIOD_DAYS = 14;

export interface VerificationItem {
  id: string;
  consultant_id: string;
  kind: string;
  label: string;
  status: 'open' | 'submitted' | 'verified';
  consultant_note: string | null;
  due_at: string;
  completed_at: string | null;
}

export function isOverdue(item: Pick<VerificationItem, 'status' | 'due_at'>, now = Date.now()) {
  return item.status !== 'verified' && new Date(item.due_at).getTime() < now;
}

export function daysLeft(dueAt: string, now = Date.now()) {
  return Math.ceil((new Date(dueAt).getTime() - now) / 86_400_000);
}

const db = supabase as any;

export function useVerificationItems(consultantId?: string) {
  return useQuery({
    queryKey: ['verification-items', consultantId ?? 'all'],
    queryFn: async (): Promise<VerificationItem[]> => {
      let q = db.from('consultant_verification_items').select('*').order('due_at');
      if (consultantId) q = q.eq('consultant_id', consultantId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: consultantId !== '',
  });
}

/** Admin: approve now, list what still has to be checked within the period. */
export function ApproveWithItemsDialog({
  target, onClose, onDone,
}: { target: { id: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const [kinds, setKinds] = useState<string[]>(['certificates']);
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [days, setDays] = useState(DEFAULT_PERIOD_DAYS);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const addCustom = () => {
    const v = draft.trim().slice(0, 300);
    if (v && !custom.includes(v)) setCustom([...custom, v]);
    setDraft('');
  };

  const submit = async () => {
    if (!target) return;
    const rows = [
      ...ITEM_KINDS.filter(k => kinds.includes(k.kind)).map(k => ({ kind: k.kind, label: k.label })),
      ...custom.map(label => ({ kind: 'custom', label })),
    ];
    if (rows.length === 0) { toast.error('Choose at least one item, or use the normal Approve button.'); return; }
    setSaving(true);
    try {
      const due = new Date(Date.now() + days * 86_400_000).toISOString();
      const { error: insErr } = await db.from('consultant_verification_items')
        .insert(rows.map(r => ({ ...r, consultant_id: target.id, due_at: due })));
      if (insErr) throw insErr;
      const { error } = await supabase.from('consultants').update({ verification_status: 'verified' as any }).eq('id', target.id);
      if (error) throw error;
      const reason = `Approved with ${rows.length} item(s) to verify within ${days} days: ${rows.map(r => r.label).join('; ')}${note.trim() ? ` — ${note.trim()}` : ''}`;
      const { data: latest } = await supabase.from('consultant_verification_audit').select('id')
        .eq('consultant_id', target.id).eq('new_status', 'verified' as any)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (latest?.id) await supabase.from('consultant_verification_audit').update({ reason: reason.slice(0, 1000) }).eq('id', latest.id);
      supabase.functions.invoke('verification-items-notify', { body: { action: 'assigned', consultant_id: target.id } })
        .catch(() => toast.warning('Approved, but the email to the consultant could not be sent.'));
      toast.success(`${target.name} is approved and now shows in the consultant list.`);
      onDone();
      onClose();
      setCustom([]); setNote(''); setKinds(['certificates']); setDays(DEFAULT_PERIOD_DAYS);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve with items to verify</DialogTitle>
          <DialogDescription>
            {target?.name} appears to clients right away. The items below must be completed within the period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {ITEM_KINDS.map(k => (
              <label key={k.kind} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={kinds.includes(k.kind)}
                  onCheckedChange={(c) => setKinds(c ? [...kinds, k.kind] : kinds.filter(x => x !== k.kind))}
                />
                {k.label}
              </label>
            ))}
          </div>
          <div>
            <Label className="text-sm">Other lines to verify</Label>
            <div className="flex gap-2 mt-1">
              <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. Send a reference from last employer"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
              <Button type="button" variant="outline" size="icon" onClick={addCustom} aria-label="Add line"><Plus className="w-4 h-4" /></Button>
            </div>
            {custom.length > 0 && (
              <ul className="mt-2 space-y-1">
                {custom.map(c => (
                  <li key={c} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-2 py-1">
                    {c}
                    <button onClick={() => setCustom(custom.filter(x => x !== c))} aria-label={`Remove ${c}`}><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label htmlFor="period" className="text-sm">Period (days)</Label>
            <Input id="period" type="number" min={1} max={180} value={days}
              onChange={e => setDays(Math.min(180, Math.max(1, Number(e.target.value) || DEFAULT_PERIOD_DAYS)))} className="mt-1 w-28" />
          </div>
          <div>
            <Label className="text-sm">Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value.slice(0, 500))} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="gradient-primary border-0" onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ item }: { item: VerificationItem }) {
  if (item.status === 'verified') return <Badge variant="secondary" className="text-[10px]">Verified</Badge>;
  if (isOverdue(item)) return <Badge variant="destructive" className="text-[10px]">Overdue</Badge>;
  if (item.status === 'submitted') return <Badge variant="outline" className="text-[10px]">Sent by consultant</Badge>;
  const d = daysLeft(item.due_at);
  return <Badge variant="outline" className="text-[10px]"><Clock className="w-3 h-3 me-1" />{d} day{d === 1 ? '' : 's'} left</Badge>;
}

/** Admin panel inside a consultant card. */
export function AdminVerificationItemsPanel({ consultantId, readOnly }: { consultantId: string; readOnly?: boolean }) {
  const { data: items = [] } = useVerificationItems(consultantId);
  const qc = useQueryClient();
  if (items.length === 0) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['verification-items'] });

  const setVerified = async (id: string) => {
    const { error } = await db.from('consultant_verification_items').update({ status: 'verified' }).eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Item verified.'); refresh(); }
  };
  const remove = async (id: string) => {
    const { error } = await db.from('consultant_verification_items').delete().eq('id', id);
    if (error) toast.error(error.message); else refresh();
  };

  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Items to verify</h4>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/50 p-2 text-sm">
            <span className="font-medium">{item.label}</span>
            <StatusBadge item={item} />
            <span className="text-xs text-muted-foreground">due {new Date(item.due_at).toLocaleDateString()}</span>
            {item.consultant_note && <p className="basis-full text-xs text-muted-foreground">Consultant: {item.consultant_note}</p>}
            {!readOnly && item.status !== 'verified' && (
              <div className="ms-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setVerified(item.id)}><Check className="w-3.5 h-3.5 me-1" />Verified</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(item.id)} aria-label="Remove item"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Admin warning at the top of the approvals page. */
export function OverdueItemsBanner() {
  const { data: items = [] } = useVerificationItems();
  const overdue = items.filter(i => isOverdue(i));
  if (overdue.length === 0) return null;
  const consultants = new Set(overdue.map(i => i.consultant_id)).size;
  return (
    <div role="alert" className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {overdue.length} verification item{overdue.length === 1 ? '' : 's'} passed the deadline for {consultants} consultant{consultants === 1 ? '' : 's'}. Open the Verified tab to review them.
    </div>
  );
}

/** Consultant view: what is still to be completed. */
export function ConsultantVerificationItemsCard({ consultantId }: { consultantId: string }) {
  const { data: items = [] } = useVerificationItems(consultantId || '');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const open = items.filter(i => i.status !== 'verified');
  if (!consultantId || open.length === 0) return null;

  const send = async (item: VerificationItem) => {
    const note = (notes[item.id] ?? item.consultant_note ?? '').trim().slice(0, 1000);
    const { error } = await db.from('consultant_verification_items')
      .update({ status: 'submitted', consultant_note: note || null }).eq('id', item.id);
    if (error) toast.error(error.message);
    else { toast.success('Sent to the admin for checking.'); qc.invalidateQueries({ queryKey: ['verification-items'] }); }
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-3">
      <div>
        <h3 className="font-semibold text-foreground">Complete your verification</h3>
        <p className="text-xs text-muted-foreground">Your profile is live. Please finish these items before the deadline — update your profile, then press "Done" with a short note.</p>
      </div>
      {open.map(item => (
        <div key={item.id} className="rounded-xl bg-background border border-border/50 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{item.label}</span>
            <StatusBadge item={item} />
            <span className="text-xs text-muted-foreground">due {new Date(item.due_at).toLocaleDateString()}</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={notes[item.id] ?? item.consultant_note ?? ''}
              onChange={e => setNotes({ ...notes, [item.id]: e.target.value })}
              placeholder="e.g. Certificate uploaded in my profile"
              aria-label={`Note for ${item.label}`}
            />
            <Button size="sm" onClick={() => send(item)}>{item.status === 'submitted' ? 'Update' : 'Done'}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
