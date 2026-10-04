import { useState } from 'react';
import { Award, ExternalLink, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { CERT_BUCKET, certificateDocumentPath, certificateFileKind } from '@/lib/consultantReview';

export interface ReviewCertificate {
  id: string;
  name: string;
  issuer?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  /** The path of the file in the private bucket (older rows may hold the address of the file). */
  document_url?: string | null;
  verified?: boolean | null;
}

interface Props {
  certificates: ReviewCertificate[];
  /** True in the demo: nothing can be saved. */
  readOnly?: boolean;
  onChanged?: () => void;
}

const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : '');

/** For the administrator: the certificates of a consultant, the file of each one (opened through a link that works for one minute) and a button to mark it as verified. */
export default function CertificateReview({ certificates, readOnly = false, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const openFile = async (certificate: ReviewCertificate) => {
    const path = certificateDocumentPath(certificate.document_url);
    if (!path) {
      toast.error('This certificate has no file that can be opened.');
      return;
    }
    setBusy(`open-${certificate.id}`);
    // A file that is not a PDF or an image is only downloaded, never shown by the browser.
    const download = certificateFileKind(path) === 'other';
    const { data, error } = await supabase.storage.from(CERT_BUCKET).createSignedUrl(path, 60, download ? { download: true } : undefined);
    setBusy(null);
    if (error || !data?.signedUrl) {
      toast.error('The file could not be opened.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const setVerified = async (certificate: ReviewCertificate, verified: boolean) => {
    setBusy(`verify-${certificate.id}`);
    const { error } = await supabase.from('certifications').update({ verified }).eq('id', certificate.id);
    setBusy(null);
    if (error) {
      toast.error(error.message || 'Could not save the verification.');
      return;
    }
    toast.success(verified ? 'Certificate verified.' : 'The verification was removed.');
    onChanged?.();
  };

  if (certificates.length === 0) {
    return <p className="text-xs text-muted-foreground" data-testid="certificates-empty">No certificates were added.</p>;
  }

  return (
    <div className="space-y-2" data-testid="certificate-review">
      {certificates.map(certificate => {
        const hasFile = !!certificateDocumentPath(certificate.document_url);
        return (
          <div key={certificate.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-background/50 p-3" data-testid={`certificate-${certificate.id}`}>
            <Award className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{certificate.name}</p>
              <p className="text-xs text-muted-foreground">
                {[certificate.issuer, certificate.issue_date ? `issued ${day(certificate.issue_date)}` : '', certificate.expiry_date ? `expires ${day(certificate.expiry_date)}` : ''].filter(Boolean).join(' · ') || 'No details'}
              </p>
            </div>
            {certificate.verified ? (
              <Badge variant="secondary" className="gap-1 bg-green-100 text-[10px] text-green-700"><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">Not verified yet</Badge>
            )}
            {hasFile ? (
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy === `open-${certificate.id}`} onClick={() => void openFile(certificate)}>
                {busy === `open-${certificate.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" aria-hidden="true" />} Open file <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">No file</span>
            )}
            {certificate.verified ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={readOnly || busy === `verify-${certificate.id}`} onClick={() => void setVerified(certificate, false)}>
                Remove verification
              </Button>
            ) : (
              <Button size="sm" className="h-7 px-2 text-xs" disabled={readOnly || busy === `verify-${certificate.id}`} onClick={() => void setVerified(certificate, true)}>
                Verify
              </Button>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        Open the file and check the name, the certificate and the date before you verify it. Clients see "Verified" only for certificates that you verified here.
      </p>
    </div>
  );
}
