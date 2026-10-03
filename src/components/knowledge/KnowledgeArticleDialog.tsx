import { useMemo, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SAP_AREA_GROUPS, MAX_SAP_AREAS, filterAreaGroups, hasArea, isOtherArea, toggleArea } from '@/lib/sapAreas';
import { MAX_PROBLEM, MAX_SOLUTION, MAX_TITLE, parseNoteNumbers, parseTags, validateArticle } from '@/lib/knowledgeReview';
import { useSubmitArticle } from '@/hooks/useKnowledgeReview';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A consultant or an administrator writes a knowledge article. It goes to the administrators as a draft; clients see it only after it is published. */
export default function KnowledgeArticleDialog({ open, onOpenChange }: Props) {
  const submit = useSubmitArticle();
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [solution, setSolution] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const found = useMemo(() => {
    if (!query.trim()) return [];
    return filterAreaGroups(SAP_AREA_GROUPS, query).flatMap(g => g.areas).filter(a => !isOtherArea(a.name)).slice(0, 8);
  }, [query]);

  const problemText = validateArticle({ title, problem, solution, areas, confirmed });

  const reset = () => {
    setTitle('');
    setProblem('');
    setSolution('');
    setTags('');
    setNotes('');
    setAreas([]);
    setQuery('');
    setConfirmed(false);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const send = () => {
    submit.mutate(
      {
        title: title.trim(),
        problem: problem.trim(),
        solution: solution.trim(),
        areas,
        tags: parseTags(tags),
        note_numbers: parseNoteNumbers(notes),
      },
      {
        onSuccess: () => {
          toast.success('Thank you. An administrator reviews your article before anyone sees it.');
          close(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Write an article</DialogTitle>
          <DialogDescription>
            Describe a problem and how to solve it, in your own words. An administrator reads it before anyone else sees it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ka-title">Title</Label>
            <Input id="ka-title" value={title} maxLength={MAX_TITLE} placeholder="For example: Vendor invoice cannot be posted, the posting period is closed" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ka-problem">What goes wrong</Label>
            <Textarea id="ka-problem" rows={3} value={problem} maxLength={MAX_PROBLEM} placeholder="What does the user see? Which transaction or message?" onChange={(e) => setProblem(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ka-solution">How to solve it</Label>
            <Textarea id="ka-solution" rows={7} value={solution} maxLength={MAX_SOLUTION - 200} placeholder={'1. First step\n2. Second step'} onChange={(e) => setSolution(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ka-area-search">Areas ({areas.length} of {MAX_SAP_AREAS})</Label>
            <Input id="ka-area-search" value={query} placeholder="Search an SAP module or area, for example payable or pricing" onChange={(e) => setQuery(e.target.value)} />
            {found.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/50 p-1">
                {found.map(a => (
                  <button
                    key={a.name}
                    type="button"
                    aria-pressed={hasArea(areas, a.name)}
                    className={`block w-full rounded-md px-2 py-1 text-start text-xs hover:bg-accent/10 ${hasArea(areas, a.name) ? 'bg-accent/10 font-medium' : ''}`}
                    onClick={() => setAreas(prev => toggleArea(prev, a.name))}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}
            {areas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {areas.map(a => (
                  <Badge key={a} variant="secondary" className="gap-1 text-[11px]">
                    {a}
                    <button type="button" aria-label={`Remove ${a}`} onClick={() => setAreas(prev => toggleArea(prev, a))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ka-tags">Tags (separated by commas, optional)</Label>
              <Input id="ka-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ka-notes">SAP Note numbers (optional)</Label>
              <Input id="ka-notes" value={notes} placeholder="For example 2270407, 2345678" onChange={(e) => setNotes(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Numbers only. Clients open them in SAP for Me with their own login.</p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border/50 p-3">
            <Checkbox id="ka-confirm" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
            <Label htmlFor="ka-confirm" className="text-xs font-normal leading-snug">
              I wrote this myself. It names no company, person, system, host, e-mail address or document number, and it does not copy text from SAP Notes or SAP Community.
            </Label>
          </div>
          {problemText && (title || problem || solution || areas.length > 0 || confirmed) && <p className="text-xs text-muted-foreground">{problemText}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button className="gradient-primary border-0" disabled={!!problemText || submit.isPending} onClick={send}>
            {submit.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Send className="me-2 h-4 w-4" />}
            Send for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
