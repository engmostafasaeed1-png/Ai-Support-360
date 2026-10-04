import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { CERT_BUCKET, certificateDocumentPath } from '@/lib/consultantReview';

interface Props {
  certificate: { id: string; name?: string | null; document_url?: string | null };
  onRemoved?: () => void;
}

/** A consultant removes a certificate that is not verified yet (for example one that was added by mistake) and, if there is one, the file that was uploaded for it. */
export default function RemoveCertificateButton({ certificate, onRemoved }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = certificate.name?.trim() || 'this certificate';
  const path = certificateDocumentPath(certificate.document_url);

  const remove = async () => {
    setBusy(true);
    const { data, error } = await supabase.from('certifications').delete().eq('id', certificate.id).select('id');
    if (error || !data || data.length === 0) {
      setBusy(false);
      toast.error('The certificate could not be removed. Please try again.');
      return;
    }
    if (path) {
      // The certificate is already gone; a file that stays behind is only a leftover.
      await supabase.storage.from(CERT_BUCKET).remove([path]);
    }
    setBusy(false);
    setOpen(false);
    toast.success('Certificate removed.');
    onRemoved?.();
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${label}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this certificate?</DialogTitle>
            <DialogDescription>
              "{label}" will be removed from your profile{path ? ', together with the file you uploaded for it' : ''}. This can not be undone.
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
    </>
  );
}
