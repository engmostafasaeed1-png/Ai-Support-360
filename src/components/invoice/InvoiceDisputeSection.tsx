import { useEffect, useState } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  AlertTriangle, Paperclip, X, Clock, CheckCircle2, XCircle, Loader2,
  ShieldAlert, FileText, Plus, Eye,
} from 'lucide-react';
import { openExternal } from '@/lib/safeUrl';

const disputeSchema = z.object({
  reason_category: z.string().min(1, 'Select a reason'),
  description: z.string().trim().min(20, 'Please provide at least 20 characters').max(2000, 'Maximum 2000 characters'),
});

const REASONS = [
  { value: 'duplicate_charge', label: 'Duplicate charge' },
  { value: 'incorrect_amount', label: 'Incorrect amount' },
  { value: 'service_not_delivered', label: 'Service not delivered' },
  { value: 'unsatisfactory_quality', label: 'Unsatisfactory quality' },
  { value: 'unauthorized_charge', label: 'Unauthorized charge' },
  { value: 'other', label: 'Other' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  open: { label: 'Open', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  under_review: { label: 'Under Review', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Loader2 },
  resolved: { label: 'Resolved', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
};

interface Props {
  payment: any;
}

interface Dispute {
  id: string;
  payment_id: string;
  client_id: string;
  consultant_id: string | null;
  reason_category: string;
  description: string;
  evidence_urls: { name: string; path: string }[];
  status: string;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export function InvoiceDisputeSection({ payment }: Props) {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reasonCategory, setReasonCategory] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const fetchDisputes = async () => {
    setLoading(true);
    const { data, error } = await (supabase.from('invoice_disputes') as any)
      .select('*')
      .eq('payment_id', payment.id)
      .order('created_at', { ascending: false });
    if (!error && data) setDisputes(data as Dispute[]);
    setLoading(false);
  };

  useEffect(() => {
    if (payment?.id) fetchDisputes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.id]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    const valid = list.filter(f => {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} exceeds 10MB`);
        return false;
      }
      return true;
    });
    setFiles(prev => [...prev, ...valid].slice(0, 5));
  };

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    const parsed = disputeSchema.safeParse({ reason_category: reasonCategory, description });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const evidence: { name: string; path: string }[] = [];
      for (const f of files) {
        const path = `${user.id}/${payment.id}/${Date.now()}-${f.name}`;
        const { error: upErr } = await supabase.storage.from('dispute-evidence').upload(path, f);
        if (upErr) throw upErr;
        evidence.push({ name: f.name, path });
      }

      const { error } = await (supabase.from('invoice_disputes') as any).insert({
        payment_id: payment.id,
        client_id: user.id,
        consultant_id: payment.consultant_id || null,
        reason_category: parsed.data.reason_category,
        description: parsed.data.description,
        evidence_urls: evidence,
        status: 'open',
      });
      if (error) throw error;

      toast.success('Dispute submitted successfully');
      setShowForm(false);
      setReasonCategory('');
      setDescription('');
      setFiles([]);
      fetchDisputes();
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit dispute');
    } finally {
      setSubmitting(false);
    }
  };

  const viewEvidence = async (path: string) => {
    const { data, error } = await supabase.storage.from('dispute-evidence').createSignedUrl(path, 60);
    if (error || !data) {
      toast.error('Could not open file');
      return;
    }
    openExternal(data.signedUrl);
  };

  const hasOpen = disputes.some(d => d.status === 'open' || d.status === 'under_review');

  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-orange-500" /> Disputes
          {disputes.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{disputes.length}</Badge>
          )}
        </p>
        {!showForm && !hasOpen && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowForm(true)}>
            <Plus className="w-3 h-3" /> Open Dispute
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : disputes.length === 0 && !showForm ? (
        <p className="text-xs text-muted-foreground">No disputes filed for this invoice.</p>
      ) : (
        <div className="space-y-2">
          {disputes.map(d => {
            const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.open;
            const Icon = sc.icon;
            const reasonLabel = REASONS.find(r => r.value === d.reason_category)?.label || d.reason_category;
            return (
              <div key={d.id} className="rounded-md bg-muted/40 border border-border/40 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`gap-1 text-[10px] ${sc.color}`}>
                    <Icon className={`w-3 h-3 ${d.status === 'under_review' ? 'animate-spin' : ''}`} /> {sc.label}
                  </Badge>
                  <span className="text-xs font-medium text-foreground">{reasonLabel}</span>
                  <span className="text-[10px] text-muted-foreground ms-auto">
                    {format(new Date(d.created_at), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{d.description}</p>
                {d.evidence_urls?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {d.evidence_urls.map((e, i) => (
                      <Button key={i} type="button" size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => viewEvidence(e.path)}>
                        <Eye className="w-2.5 h-2.5" /> {e.name}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1.5 border-t border-border/40">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" /> Submitted
                  </span>
                  <span>→</span>
                  <span className={`inline-flex items-center gap-1 ${['under_review','resolved','rejected'].includes(d.status) ? 'text-foreground' : ''}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${['under_review','resolved','rejected'].includes(d.status) ? 'bg-blue-500' : 'bg-muted-foreground/30'}`} /> Under Review
                  </span>
                  <span>→</span>
                  <span className={`inline-flex items-center gap-1 ${d.status === 'resolved' || d.status === 'rejected' ? 'text-foreground' : ''}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${d.status === 'resolved' ? 'bg-green-500' : d.status === 'rejected' ? 'bg-red-500' : 'bg-muted-foreground/30'}`} />
                    {d.status === 'rejected' ? 'Rejected' : 'Resolved'}
                  </span>
                </div>
                {d.resolution_notes && (
                  <div className="rounded bg-background/60 border border-border/40 p-2 mt-1">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Resolution</p>
                    <p className="text-xs text-foreground">{d.resolution_notes}</p>
                    {d.resolved_at && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(d.resolved_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-md bg-orange-50/50 dark:bg-orange-950/10 border border-orange-200/60 dark:border-orange-900/40 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">
              Disputes are reviewed by our team within 3-5 business days. Provide as much detail and evidence as possible.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Reason</Label>
            <Select value={reasonCategory} onValueChange={setReasonCategory}>
              <SelectTrigger className="rounded-lg h-9 text-xs"><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Description <span className="text-muted-foreground font-normal">({description.length}/2000)</span></Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 2000))}
              placeholder="Explain why you're disputing this invoice..."
              className="rounded-lg min-h-[90px] text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Evidence <span className="text-muted-foreground font-normal">(up to 5 files, 10MB each)</span></Label>
            <label className="flex items-center justify-center gap-2 h-9 rounded-lg border border-dashed border-border bg-background hover:bg-muted/40 cursor-pointer text-xs text-muted-foreground">
              <Paperclip className="w-3.5 h-3.5" />
              {files.length >= 5 ? 'Maximum 5 files' : 'Attach files (PDF, images, docs)'}
              <input
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt"
                disabled={files.length >= 5}
                onChange={handleFileChange}
              />
            </label>
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-background rounded px-2 py-1 border border-border/40">
                    <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-muted-foreground text-[10px]">{(f.size / 1024).toFixed(0)}KB</span>
                    <Button type="button" size="icon" variant="ghost" className="h-5 w-5" onClick={() => removeFile(i)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => { setShowForm(false); setFiles([]); setReasonCategory(''); setDescription(''); }} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" className="flex-1 gap-1.5" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              {submitting ? 'Submitting...' : 'Submit Dispute'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
