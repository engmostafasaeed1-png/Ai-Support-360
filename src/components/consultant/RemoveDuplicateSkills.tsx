import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { duplicateSkillIds, type SkillRow } from '@/lib/skillDuplicates';

interface Props {
  skills: SkillRow[];
  onRemoved?: () => void;
}

/** Shown only when some skills are listed more than once or are empty: one button removes the repeated and the empty rows and keeps the best row of each SAP module. */
export default function RemoveDuplicateSkills({ skills, onRemoved }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = useMemo(() => duplicateSkillIds(skills), [skills]);

  if (ids.length === 0) return null;

  const remove = async () => {
    setBusy(true);
    const { data, error } = await supabase.from('consultant_skills').delete().in('id', ids).select('id');
    setBusy(false);
    const removed = data?.length ?? 0;
    if (removed > 0) onRemoved?.();
    if (error || removed === 0) {
      toast.error('The skills could not be removed. Please try again.');
      return;
    }
    setOpen(false);
    if (removed < ids.length) toast.warning(`${removed} of ${ids.length} rows were removed. Some are still there.`);
    else toast.success(removed === 1 ? '1 row removed.' : `${removed} rows removed.`);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="duplicate-skills">
      <p className="text-sm text-amber-900">
        {ids.length === 1 ? '1 row is repeated or empty.' : `${ids.length} rows are repeated or empty.`} You keep one row for each SAP module.
      </p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Remove the repeated rows</Button>
      <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove the repeated rows?</DialogTitle>
            <DialogDescription>
              {ids.length === 1 ? '1 row is removed' : `${ids.length} rows are removed`}: the rows without a module and, for every SAP module that is listed more than once, all rows but the best one
              (certified first, then the higher level, then more years). This can not be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
