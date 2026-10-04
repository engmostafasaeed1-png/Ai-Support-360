import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { safeFileName } from '@/lib/storagePath';
import { CERT_BUCKET, certificateFileProblem } from '@/lib/consultantReview';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  /** The id of the signed-in user: the first folder of the file path must be this id (storage policy). */
  userId: string;
  onAdded?: () => void;
}

/** A consultant adds a certificate (name, issuer, dates and, if there is one, the file). The platform team opens the file and verifies the certificate. */
export default function AddCertificateDialog({ open, onOpenChange, consultantId, userId, onAdded }: Props) {
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setIssuer('');
    setIssueDate('');
    setExpiryDate('');
    setFile(null);
    setProblem(null);
  };

  const submit = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setProblem('Enter the name of the certificate.');
      return;
    }
    if (issueDate && expiryDate && expiryDate < issueDate) {
      setProblem('The expiry date is before the issue date.');
      return;
    }
    const fileProblem = file ? certificateFileProblem(file) : null;
    if (fileProblem) {
      setProblem(fileProblem);
      return;
    }

    setProblem(null);
    setSaving(true);
    let path: string | null = null;
    try {
      if (file) {
        // Private bucket; the stored value is the storage path (first folder = user id, as the storage policy requires).
        path = `${userId}/certifications/${Date.now()}-${safeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from(CERT_BUCKET).upload(path, file);
        if (uploadError) {
          path = null;
          throw new Error('The file could not be uploaded. Please try again.');
        }
      }
      const { error } = await supabase.from('certifications').insert({
        consultant_id: consultantId,
        name: cleanName,
        issuer: issuer.trim() || null,
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
        document_url: path,
      });
      if (error) {
        if (path) await supabase.storage.from(CERT_BUCKET).remove([path]);
        throw new Error('The certificate could not be saved. Please try again.');
      }
      toast.success('Certificate added. The platform team will check it.');
      onAdded?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not add the certificate.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a certificate</DialogTitle>
          <DialogDescription>The platform team opens the file and verifies the certificate. Clients see "Verified" only after that.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cert-name">Certificate name</Label>
            <Input id="cert-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="SAP Certified Application Associate - SAP S/4HANA" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-issuer">Issued by (optional)</Label>
            <Input id="cert-issuer" value={issuer} onChange={e => setIssuer(e.target.value)} maxLength={200} placeholder="SAP SE" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cert-issued">Issue date (optional)</Label>
              <Input id="cert-issued" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-expires">Expiry date (optional)</Label>
              <Input id="cert-expires" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-file" className="flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" aria-hidden="true" /> Certificate file (optional, PDF, JPG or PNG, up to 10 MB)</Label>
            <Input id="cert-file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add certificate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
