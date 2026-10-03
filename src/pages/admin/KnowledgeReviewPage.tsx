import { useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, Archive, BookOpenCheck, Loader2, Pencil, ShieldCheck, Sparkles, Undo2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useAiSwitches, useKnowledgeCounts, useKnowledgeItems, useLearnFromTickets, useSetAiSwitch, useUpdateKnowledge,
  type AiSwitchKey, type KnowledgeItem, type KnowledgeStatus,
} from '@/hooks/useKnowledgeReview';
import {
  MAX_PROBLEM, MAX_SOLUTION, MAX_TITLE, ORIGIN_LABEL, describeFlags, parseTags, validateReview,
} from '@/lib/knowledgeReview';

const EMPTY_TEXT: Record<KnowledgeStatus, string> = {
  draft: 'Nothing waits for review. Drafts appear after a session is analysed, or when you press "Learn from finished tickets" above.',
  published: 'Nothing is published yet. Until you publish solutions, clients see general SAP guidance, clearly marked as such.',
  archived: 'Nothing is archived.',
};

function SwitchRow({ id, label, help, checked, disabled, onChange }: {
  id: string; label: string; help: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function ReviewDialog({ item, onClose }: { item: KnowledgeItem; onClose: () => void }) {
  const update = useUpdateKnowledge();
  const [title, setTitle] = useState(item.title);
  const [problem, setProblem] = useState(item.problem_description ?? '');
  const [solution, setSolution] = useState(item.solution ?? '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [confirmed, setConfirmed] = useState(false);
  const problemText = validateReview({ title, problem, solution });
  const flags = describeFlags(item.privacy_flags);

  const save = (status?: KnowledgeStatus) => {
    update.mutate(
      {
        id: item.id,
        patch: {
          title: title.trim(),
          problem_description: problem.trim(),
          solution: solution.trim(),
          tags: parseTags(tags),
          ...(status ? { status } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(status === 'published' ? 'Published. Clients can now get this as a suggestion.' : 'Saved');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item.status === 'published' ? 'Edit published solution' : 'Review and publish'}</DialogTitle>
          <DialogDescription>
            {item.origin_kind ? ORIGIN_LABEL[item.origin_kind] : 'Knowledge item'}. Change anything that is wrong before you publish.
          </DialogDescription>
        </DialogHeader>

        {flags && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The automatic check removed: {flags}. Check that nothing identifying is left.
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kr-title">Title</Label>
            <Input id="kr-title" value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kr-problem">Problem</Label>
            <Textarea id="kr-problem" rows={4} value={problem} maxLength={MAX_PROBLEM} onChange={(e) => setProblem(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kr-solution">Solution</Label>
            <Textarea id="kr-solution" rows={8} value={solution} maxLength={MAX_SOLUTION} onChange={(e) => setSolution(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kr-tags">Tags (separated by commas)</Label>
            <Input id="kr-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          {item.sap_modules.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Areas:</span>
              {item.sap_modules.map((a) => <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>)}
            </div>
          )}
          {item.status !== 'published' && (
            <div className="flex items-start gap-2 rounded-lg border border-border/50 p-3">
              <Checkbox id="kr-confirm" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
              <Label htmlFor="kr-confirm" className="text-xs font-normal leading-snug">
                I read this text. It names no company, person, system, host, e-mail address or document number.
              </Label>
            </div>
          )}
          {problemText && <p className="text-xs text-destructive">{problemText}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={!!problemText || update.isPending} onClick={() => save()}>Save changes</Button>
          {item.status !== 'published' && (
            <Button className="gradient-primary border-0" disabled={!!problemText || !confirmed || update.isPending} onClick={() => save('published')}>
              {update.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="me-2 h-4 w-4" />}
              Publish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgeReviewPage() {
  const [status, setStatus] = useState<KnowledgeStatus>('draft');
  const [reviewing, setReviewing] = useState<KnowledgeItem | null>(null);
  const counts = useKnowledgeCounts();
  const items = useKnowledgeItems(status);
  const switches = useAiSwitches();
  const setSwitch = useSetAiSwitch();
  const learn = useLearnFromTickets();
  const update = useUpdateKnowledge();

  const label = (name: string, key: KnowledgeStatus) => `${name}${counts.data ? ` (${counts.data[key]})` : ''}`;
  const move = (item: KnowledgeItem, to: KnowledgeStatus) => update.mutate({ id: item.id, patch: { status: to } });

  const skipped = (learn.data?.results ?? []).filter((r) => r.outcome !== 'created');
  const reasons = [...new Set(skipped.map((r) => r.reason).filter(Boolean))].join('; ');

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <BookOpenCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Knowledge review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Anonymised solutions learned from finished sessions and tickets wait here. Nothing is shown to a client until you publish it.
            Read each text first: it must name no company, person, system or host.
          </p>
        </div>
      </div>

      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-accent" /> AI suggestions for clients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow
            id="ai-suggestions-switch"
            label="Show possible solutions when a client opens a ticket"
            help="Uses published knowledge only. When nothing fits, the client sees general SAP guidance, clearly marked as such."
            checked={switches.data?.ai_suggestions_enabled ?? true}
            disabled={switches.isLoading || setSwitch.isPending}
            onChange={(value) => setSwitch.mutate({ key: 'ai_suggestions_enabled' as AiSwitchKey, value })}
          />
          <SwitchRow
            id="ai-learning-switch"
            label="Learn anonymised solutions from finished sessions and tickets"
            help="Only creates drafts. Drafts are visible to administrators until you publish them."
            checked={switches.data?.ai_learning_enabled ?? true}
            disabled={switches.isLoading || setSwitch.isPending}
            onChange={(value) => setSwitch.mutate({ key: 'ai_learning_enabled' as AiSwitchKey, value })}
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={learn.isPending || switches.data?.ai_learning_enabled === false}
              onClick={() => learn.mutate()}
            >
              {learn.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Learn from finished tickets
            </Button>
            <span className="text-xs text-muted-foreground">Looks at up to 5 resolved or closed tickets that have no draft yet.</span>
          </div>
          {learn.data && (
            <p className="text-xs text-muted-foreground">
              {learn.data.enabled === false
                ? 'Learning is switched off.'
                : `Looked at ${learn.data.looked_at} ticket(s): ${learn.data.created} new draft(s).${reasons ? ` Not used: ${reasons}.` : ''}${learn.data.stopped ? ` ${learn.data.stopped}` : ''}`}
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs value={status} onValueChange={(v) => setStatus(v as KnowledgeStatus)}>
        <TabsList>
          <TabsTrigger value="draft">{label('Waiting for review', 'draft')}</TabsTrigger>
          <TabsTrigger value="published">{label('Published', 'published')}</TabsTrigger>
          <TabsTrigger value="archived">{label('Archived', 'archived')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {items.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      ) : items.error ? (
        <p className="text-sm text-destructive">Could not load the knowledge items.</p>
      ) : (items.data ?? []).length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{EMPTY_TEXT[status]}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(items.data ?? []).map((item) => (
            <Card key={item.id} className="rounded-2xl border-border/50">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.origin_kind && <Badge variant="secondary" className="text-[10px]">{ORIGIN_LABEL[item.origin_kind]}</Badge>}
                      {item.sap_modules.slice(0, 4).map((a) => <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>)}
                      {item.status === 'published' && <Badge className="text-[10px]">{item.helpful_count ?? 0} found it helpful</Badge>}
                      <span className="text-[11px] text-muted-foreground">{format(new Date(item.created_at), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.status === 'draft' && (
                      <>
                        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setReviewing(item)}>
                          <ShieldCheck className="h-3.5 w-3.5" /> Review and publish
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={update.isPending} onClick={() => move(item, 'archived')}>
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </Button>
                      </>
                    )}
                    {item.status === 'published' && (
                      <>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setReviewing(item)}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={update.isPending} onClick={() => move(item, 'draft')}>
                          <Undo2 className="h-3.5 w-3.5" /> Unpublish
                        </Button>
                      </>
                    )}
                    {item.status === 'archived' && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={update.isPending} onClick={() => move(item, 'draft')}>
                        <Undo2 className="h-3.5 w-3.5" /> Back to drafts
                      </Button>
                    )}
                  </div>
                </div>
                {item.privacy_flags.length > 0 && (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    The automatic check removed: {describeFlags(item.privacy_flags)}. Check that nothing identifying is left.
                  </p>
                )}
                {item.problem_description && <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{item.problem_description}</p>}
                {item.solution && <p className="line-clamp-6 whitespace-pre-wrap text-xs text-foreground">{item.solution}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {reviewing && <ReviewDialog item={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}
