import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSubmitProposal, useProposalVersions } from '@/hooks/useProposals';
import { Send, Paperclip, X, FileText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface SubmitProposalModalProps {
  ticketId: string;
  ticketTitle: string;
  trigger?: React.ReactNode;
}

export default function SubmitProposalModal({ ticketId, ticketTitle, trigger }: SubmitProposalModalProps) {
  const [open, setOpen] = useState(false);
  const submit = useSubmitProposal();
  const { data: versions } = useProposalVersions(ticketId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    cover_letter: '',
    proposed_rate: '',
    estimated_hours: '',
    timeline_days: '',
  });

  const latestVersion = versions && versions.length > 0 ? versions[0] : null;
  const isRevision = !!latestVersion;
  const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));

  const handleSubmit = () => {
    if (!form.cover_letter || !form.proposed_rate) {
      toast.error('Cover letter and rate are required');
      return;
    }
    submit.mutate(
      {
        ticket_id: ticketId,
        cover_letter: form.cover_letter,
        proposed_rate: parseFloat(form.proposed_rate),
        estimated_hours: parseFloat(form.estimated_hours) || 0,
        timeline_days: parseInt(form.timeline_days) || 0,
        files: files.length > 0 ? files : undefined,
        parent_proposal_id: latestVersion?.id,
        version: nextVersion,
      },
      {
        onSuccess: () => {
          toast.success(isRevision ? `Proposal v${nextVersion} submitted!` : 'Proposal submitted!');
          setOpen(false);
          setForm({ cover_letter: '', proposed_rate: '', estimated_hours: '', timeline_days: '' });
          setFiles([]);
        },
        onError: () => toast.error('Failed to submit proposal'),
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
            <Send className="w-3.5 h-3.5" /> {isRevision ? `Submit v${nextVersion}` : 'Submit Proposal'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Submit Proposal
            {isRevision && (
              <Badge variant="secondary" className="text-[10px] bg-accent/20 text-accent gap-1">
                <RefreshCw className="w-3 h-3" /> Version {nextVersion}
              </Badge>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">Bidding on: {ticketTitle}</p>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-4 pt-2">
            {/* Previous versions */}
            {versions && versions.length > 0 && (
              <div className="bg-muted/30 rounded-xl p-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Previous Versions</p>
                {versions.map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] h-5">v{v.version}</Badge>
                      <span className="text-muted-foreground">${v.proposed_rate}/hr • {v.estimated_hours}h</span>
                    </span>
                    <Badge variant="secondary" className="text-[10px]">{v.status}</Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Cover letter */}
            <div>
              <Label className="text-xs">Cover Letter</Label>
              <Textarea
                value={form.cover_letter}
                onChange={e => setForm(f => ({ ...f, cover_letter: e.target.value }))}
                placeholder={isRevision ? 'Explain what changed in this revision...' : 'Explain why you\'re the best fit...'}
                className="mt-1 min-h-[100px]"
              />
            </div>

            {/* Rate fields */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Hourly Rate ($)</Label>
                <Input type="number" value={form.proposed_rate} onChange={e => setForm(f => ({ ...f, proposed_rate: e.target.value }))} placeholder="150" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Est. Hours</Label>
                <Input type="number" value={form.estimated_hours} onChange={e => setForm(f => ({ ...f, estimated_hours: e.target.value }))} placeholder="20" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Timeline (days)</Label>
                <Input type="number" value={form.timeline_days} onChange={e => setForm(f => ({ ...f, timeline_days: e.target.value }))} placeholder="14" className="mt-1" />
              </div>
            </div>

            {/* Estimated total */}
            {form.proposed_rate && form.estimated_hours && (
              <div className="bg-muted/50 rounded-xl p-3 text-sm">
                <span className="text-muted-foreground">Estimated Total: </span>
                <span className="font-semibold text-foreground">
                  ${(parseFloat(form.proposed_rate) * parseFloat(form.estimated_hours)).toLocaleString()}
                </span>
              </div>
            )}

            {/* File attachments */}
            <div>
              <Label className="text-xs">Attachments</Label>
              <p className="text-[10px] text-muted-foreground mb-2">Attach scope documents, CVs, or reference materials</p>
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
                className="w-full gap-1.5 text-xs border-dashed"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-3.5 h-3.5" /> Add Files
              </Button>
              {files.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 text-xs">
                      <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="truncate flex-1">{file.name}</span>
                      <span className="text-muted-foreground shrink-0">{formatSize(file.size)}</span>
                      <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit */}
            <Button onClick={handleSubmit} disabled={submit.isPending} className="w-full gradient-primary border-0">
              {submit.isPending ? 'Submitting...' : isRevision ? `Submit Revision v${nextVersion}` : 'Submit Proposal'}
            </Button>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
