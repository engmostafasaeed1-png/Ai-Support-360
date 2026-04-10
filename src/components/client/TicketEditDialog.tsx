import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Upload, X, FileText, Paperclip } from 'lucide-react';
import type { TicketDetail } from '@/hooks/useTicketDetail';

const urgencyOptions = ['low', 'medium', 'high', 'critical'];
const statusOptions = [
  { value: 'new', label: 'New' },
  { value: 'triaging', label: 'Triaging' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'planning', label: 'Planning' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'matched', label: 'Matched' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'waiting_for_client', label: 'Waiting for Client' },
  { value: 'waiting_for_vendor', label: 'Waiting for Vendor' },
  { value: 'testing', label: 'Testing' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'reopened', label: 'Reopened' },
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
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
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
      if (error) throw error;

      // Upload new files
      if (newFiles.length > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          for (const file of newFiles) {
            // Get next version
            const { data: existing } = await supabase
              .from('ticket_documents')
              .select('version')
              .eq('ticket_id', ticket.id)
              .eq('file_name', file.name)
              .order('version', { ascending: false })
              .limit(1);
            const nextVersion = (existing && existing.length > 0) ? (existing[0] as any).version + 1 : 1;

            const storagePath = `${ticket.id}/${session.user.id}/${Date.now()}_${file.name}`;
            await supabase.storage.from('ticket-documents').upload(storagePath, file);
            await supabase.from('ticket_documents').insert({
              ticket_id: ticket.id,
              uploaded_by: session.user.id,
              file_name: file.name,
              file_url: storagePath,
              file_size: file.size,
              mime_type: file.type || null,
              version: nextVersion,
            } as any);
          }
        }
      }

      toast.success('Ticket updated successfully');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticket.id] });
      queryClient.invalidateQueries({ queryKey: ['client-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-documents', ticket.id] });
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to update ticket');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
              <Select value={form.preferred_session_type || 'any'} onValueChange={v => setForm(f => ({ ...f, preferred_session_type: v === 'any' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {sessionTypes.map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Document Upload */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5" /> Attach Documents
            </Label>
            <div className="p-3 rounded-xl border-2 border-dashed border-border/50 bg-muted/20 space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  const valid = files.filter(f => f.size <= 20 * 1024 * 1024);
                  if (valid.length < files.length) toast.error('Some files exceed 20MB limit');
                  setNewFiles(prev => [...prev, ...valid]);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5" /> Add Files
                </Button>
                <span className="text-[11px] text-muted-foreground">Max 20MB per file</span>
              </div>
              {newFiles.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {newFiles.map((file, i) => (
                    <div key={`${file.name}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 text-sm">
                      <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="truncate flex-1 text-foreground">{file.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{(file.size / 1024).toFixed(0)} KB</span>
                      <button
                        type="button"
                        onClick={() => setNewFiles(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
