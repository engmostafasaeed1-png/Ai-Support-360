import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSubmitProposal, useProposalVersions } from '@/hooks/useProposals';
import { useNow } from '@/hooks/useCriticalService';
import { effectiveRate, formatCountdown, formatPercent, msLeft } from '@/lib/criticalService';
import { Send, Paperclip, X, FileText, RefreshCw } from 'lucide-react';
import VoiceInput from '@/components/ui/voice-input';
import { toast } from 'sonner';
import { toastWithLocationFix } from '@/lib/locationErrors';
import { LocationBlockedNotice, useLocationBlocked } from '@/components/consultant/LocationBanner';
import { PolicyBlockedNotice, usePolicyBlocked } from '@/components/consultant/policy/PolicyBanner';
import { useQueryClient } from '@tanstack/react-query';
import { bidCountdown, bidsSoFar, toneClass } from '@/lib/bidding';

interface SubmitProposalModalProps {
  ticketId: string;
  ticketTitle: string;
  trigger?: React.ReactNode;
  /** A critical request that is still inside its reply window: the surcharge that a proposal sent in time earns, and the end of the window. */
  criticalPercent?: number | null;
  criticalDueAt?: string | null;
  /** The bidding deadline of the request, the bids so far and the consultant's own currency (when the page has them). */
  bidDeadline?: string | null;
  bidCount?: number;
  currency?: string | null;
}

export default function SubmitProposalModal({ ticketId, ticketTitle, trigger, criticalPercent, criticalDueAt, bidDeadline, bidCount, currency }: SubmitProposalModalProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const unit = currency ? `${currency}/hr` : '$/hr';
  const money = (n: number) => (currency ? `${currency} ${n.toLocaleString()}` : `$${n.toLocaleString()}`);
  const deadlineClock = useNow(open ? 30_000 : 0);
  const deadline = bidCountdown(bidDeadline, deadlineClock);
  const submit = useSubmitProposal();
  const locationBlocked = useLocationBlocked();
  const policyBlocked = usePolicyBlocked();
  const { data: versions } = useProposalVersions(ticketId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    cover_letter: '',
    proposed_rate: '',
    estimated_hours: '',
    timeline_days: '',
  });

  const rateNumber = parseFloat(form.proposed_rate);
  // the countdown only runs while the form is open
  const clock = useNow(open && criticalDueAt ? 1000 : 0);
  const criticalOn = !!criticalPercent && criticalPercent > 0 && !!criticalDueAt && msLeft(criticalDueAt, clock) > 0;
  const latestVersion = versions && versions.length > 0 ? versions[0] : null;
  // revising = changing a bid that the client has not answered yet; after a withdrawal or a decision a new bid is placed
  const isRevision = !!latestVersion && latestVersion.status === 'pending';
  const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));

  const handleSubmit = () => {
    const rate = parseFloat(form.proposed_rate);
    const hours = form.estimated_hours === '' ? 0 : parseFloat(form.estimated_hours);
    const days = form.timeline_days === '' ? 0 : parseInt(form.timeline_days, 10);
    if (!form.cover_letter.trim()) { toast.error('Please write a cover letter'); return; }
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100000) { toast.error('The rate must be more than 0 and at most 100,000 per hour'); return; }
    if (!Number.isFinite(hours) || hours < 0 || hours > 100000) { toast.error('The estimated hours must be 0 or more'); return; }
    if (!Number.isFinite(days) || days < 0 || days > 3650) { toast.error('The days must be 0 or more (at most 3,650)'); return; }
    if (!form.cover_letter || !form.proposed_rate) {
      toast.error('Cover letter and rate are required');
      return;
    }
    submit.mutate(
      {
        ticket_id: ticketId,
        cover_letter: form.cover_letter,
        proposed_rate: rate,
        estimated_hours: hours,
        timeline_days: days,
        files: files.length > 0 ? files : undefined,
        parent_proposal_id: latestVersion?.id,
        version: nextVersion,
      },
      {
        onSuccess: () => {
          toast.success(isRevision ? 'Your bid was revised.' : 'Your bid was sent.');
          for (const key of ['my-bids', 'open-tickets-for-bidding', 'ticket-bid-counts']) void queryClient.invalidateQueries({ queryKey: [key] });
          setOpen(false);
          setForm({ cover_letter: '', proposed_rate: '', estimated_hours: '', timeline_days: '' });
          setFiles([]);
        },
        onError: (e: any) => toastWithLocationFix(e, 'Your bid could not be sent.'),
      }
    );
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gradient-primary border-0 gap-1.5 text-xs">
            <Send className="w-3.5 h-3.5" /> {isRevision ? 'Revise bid' : 'Place a bid'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] w-[calc(100vw-2rem)] flex flex-col p-4 sm:p-6 rounded-2xl">
        <DialogHeader className="pb-1">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            {isRevision ? 'Revise your bid' : 'Place a bid'}
            {isRevision && (
              <Badge variant="secondary" className="text-[10px] bg-accent/20 text-accent gap-1">
                <RefreshCw className="w-3 h-3" /> v{nextVersion}
              </Badge>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">Bidding on: {ticketTitle}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span className={toneClass[deadline.tone]} title={bidDeadline ? new Date(bidDeadline).toLocaleString() : undefined}>{deadline.text}</span>
            {bidCount !== undefined && <span className="text-muted-foreground">{bidsSoFar(bidCount)}</span>}
          </div>
          <p className="text-xs text-muted-foreground">You can revise or withdraw your bid until the client answers.</p>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-3 pt-1 pb-2">
            {/* Previous versions - compact on mobile */}
            {versions && versions.length > 0 && (
              <div className="bg-muted/30 rounded-xl p-2.5 space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">Earlier versions of your bid</p>
                {versions.slice(0, 3).map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5">v{v.version}</Badge>
                      <span className="text-muted-foreground">{money(Number(v.proposed_rate))}/hr • {v.estimated_hours}h</span>
                    </span>
                    <Badge variant="secondary" className="text-[9px] h-4">{v.status}</Badge>
                  </div>
                ))}
                {versions.length > 3 && (
                  <p className="text-[10px] text-muted-foreground text-center">+{versions.length - 3} more</p>
                )}
              </div>
            )}

            {/* Cover letter */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Cover Letter</Label>
                <VoiceInput size="sm" onTranscript={(t) => setForm(f => ({ ...f, cover_letter: f.cover_letter + t }))} />
              </div>
              <Textarea
                value={form.cover_letter}
                onChange={e => setForm(f => ({ ...f, cover_letter: e.target.value }))}
                placeholder={isRevision ? 'Explain what changed in this revision...' : 'Explain why you\'re the best fit...'}
                className="mt-1 min-h-[80px] sm:min-h-[100px] text-sm"
              />
            </div>

            {/* Rate fields - stack 2+1 on mobile */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div>
                <Label className="text-[11px] sm:text-xs">Rate ({unit})</Label>
                <Input
                  type="number"
                  value={form.proposed_rate}
                  onChange={e => setForm(f => ({ ...f, proposed_rate: e.target.value }))}
                  placeholder="150"
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-[11px] sm:text-xs">Est. Hours</Label>
                <Input
                  type="number"
                  value={form.estimated_hours}
                  onChange={e => setForm(f => ({ ...f, estimated_hours: e.target.value }))}
                  placeholder="20"
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-[11px] sm:text-xs">Days</Label>
                <Input
                  type="number"
                  value={form.timeline_days}
                  onChange={e => setForm(f => ({ ...f, timeline_days: e.target.value }))}
                  placeholder="14"
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>

            {/* Estimated total */}
            {form.proposed_rate && form.estimated_hours && (
              <div className="bg-muted/50 rounded-xl p-2.5 text-sm flex items-center justify-between">
                <span className="text-muted-foreground text-xs">Estimated total</span>
                <span className="font-semibold text-foreground">
                  {money(parseFloat(form.proposed_rate) * parseFloat(form.estimated_hours))}
                </span>
              </div>
            )}

            {criticalOn && criticalPercent && criticalDueAt && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200" data-testid="critical-proposal-note">
                <p className="font-semibold">{`Critical request: +${formatPercent(criticalPercent)} on your hourly rate`}</p>
                <p className="mt-0.5">{`Send this bid within ${formatCountdown(msLeft(criticalDueAt, clock))} and, if the client accepts it, ${formatPercent(criticalPercent)} is added to the rate you enter.`}</p>
                {Number.isFinite(rateNumber) && rateNumber > 0 && (
                  <p className="mt-0.5 font-medium">{`A rate of ${money(rateNumber)}/hr becomes ${money(effectiveRate(rateNumber, criticalPercent))}/hr when it is accepted.`}</p>
                )}
              </div>
            )}

            {/* File attachments */}
            <div>
              <Label className="text-xs">Attachments</Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileAdd}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs border-dashed mt-1 h-9"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-3.5 h-3.5" /> Add Files
              </Button>
              {files.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 bg-muted/50 rounded-lg px-2.5 py-1.5 text-[11px]">
                      <FileText className="w-3 h-3 text-accent shrink-0" />
                      <span className="truncate flex-1 min-w-0">{file.name}</span>
                      <span className="text-muted-foreground shrink-0">{formatSize(file.size)}</span>
                      <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Sticky submit button */}
        <div className="pt-2 border-t border-border/50">
          <LocationBlockedNotice />
          <PolicyBlockedNotice />
          <Button onClick={handleSubmit} disabled={submit.isPending || locationBlocked || policyBlocked} className="w-full gradient-primary border-0 h-10">
            {submit.isPending ? 'Sending...' : isRevision ? `Send revised bid (v${nextVersion})` : 'Send bid'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
