import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { TicketDetail } from '@/hooks/useTicketDetail';

const urgencyOptions = ['low', 'medium', 'high', 'critical'];
const statusOptions = [
  { value: 'new', label: 'New' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'matched', label: 'Matched' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_for_client', label: 'Waiting for Client' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];
const sessionTypes = ['chat', 'video', 'screen_share'];
const languages = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
];

interface Props {
  ticket: TicketDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TicketEditDialog({ ticket, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: ticket.title,
    description: ticket.description || '',
    urgency: ticket.urgency,
    status: ticket.status,
    preferred_language: ticket.preferred_language || 'en',
    preferred_session_type: ticket.preferred_session_type || '',
  });

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    const updates: any = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      urgency: form.urgency,
      status: form.status,
      preferred_language: form.preferred_language,
      preferred_session_type: form.preferred_session_type || null,
    };
    if (form.status === 'resolved' && ticket.status !== 'resolved') {
      updates.resolved_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from('tickets')
      .update(updates)
      .eq('id', ticket.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to update ticket');
    } else {
      toast.success('Ticket updated successfully');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticket.id] });
      queryClient.invalidateQueries({ queryKey: ['client-tickets'] });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Urgency</Label>
              <Select value={form.urgency} onValueChange={v => setForm(f => ({ ...f, urgency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {urgencyOptions.map(u => (
                    <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Preferred Language</Label>
              <Select value={form.preferred_language} onValueChange={v => setForm(f => ({ ...f, preferred_language: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {languages.map(l => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Session Type</Label>
              <Select value={form.preferred_session_type} onValueChange={v => setForm(f => ({ ...f, preferred_session_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  {sessionTypes.map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gradient-primary border-0">
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
