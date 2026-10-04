import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  skill: { id: string; module?: string | null };
  onRemoved?: () => void;
}

/** A consultant removes one of their skills (with a question first). */
export default function RemoveSkillButton({ skill, onRemoved }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = skill.module?.trim() || 'this empty skill';

  const remove = async () => {
    setBusy(true);
    const { data, error } = await supabase.from('consultant_skills').delete().eq('id', skill.id).select('id');
    setBusy(false);
    if (error || !data || data.length === 0) {
      toast.error('The skill could not be removed. Please try again.');
      return;
    }
    setOpen(false);
    toast.success('Skill removed.');
    onRemoved?.();
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
        aria-label={`Remove skill ${label}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this skill?</DialogTitle>
            <DialogDescription>"{label}" will be removed from your profile. This can not be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
