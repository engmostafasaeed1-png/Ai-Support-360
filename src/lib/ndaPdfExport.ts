import { format } from 'date-fns';
import { downloadNdaPdf, type NdaPdfParty } from '@/lib/nda/pdf';
import { fetchNdaEvidence, logNdaDownload, sha256Hex, type NdaEvidence } from '@/lib/nda/api';

interface NDAExportData {
  ndaContent: string;
  signatureData: string;
  signatureType: 'draw' | 'type' | string;
  signedAt: string;
  consultantName?: string;
  clientName?: string;
  agreementId?: string;
  revokedAt?: string | null;
  clientSignatureData?: string | null;
  clientSignatureType?: string | null;
  clientSignerName?: string | null;
  clientSignedAt?: string | null;
  lang?: 'en' | 'ar';
}

const isImage = (s: string | null | undefined) => !!s && s.startsWith('data:image');

/**
 * Builds the NDA PDF: the NDA text, then each party's signature block (free-hand signature image or legacy typed
 * signature, printed name, masked ID with type and country, date/time, role, company), the document version hash and
 * the "not a qualified electronic signature" footer on every page. Evidence rows are read when the stricter signing is
 * installed (docs/sql/nda-signature-identity.sql); without them a signed party shows as a legacy signature.
 * Unsigned previews show empty signature boxes.
 */
export async function exportNDAAsPDF(data: NDAExportData) {
  const lang = data.lang ?? (typeof document !== 'undefined' && document.documentElement.lang?.startsWith('ar') ? 'ar' : 'en');
  const signed = !!data.signatureData;
  let ev: Partial<Record<'consultant' | 'client', NdaEvidence>> = {};
  if (data.agreementId && signed) {
    ev = (await fetchNdaEvidence([data.agreementId])).get(data.agreementId) ?? {};
    void logNdaDownload(data.agreementId);
  }
  const party = (sig: string | null | undefined, at: string | null | undefined, name: string, company: string | null, e: NdaEvidence | undefined): NdaPdfParty => ({
    signedAt: sig ? at ?? null : null,
    image: isImage(sig) ? sig! : null,
    typed: sig && !isImage(sig) ? sig : null,
    name,
    company,
    evidence: e ?? null,
    legacy: !!sig && !e,
  });
  const documentHash = ev.consultant?.document_hash ?? ev.client?.document_hash ?? (signed ? await sha256Hex(data.ndaContent || '') : null);
  await downloadNdaPdf({
    ndaId: data.agreementId ?? null,
    content: data.ndaContent || '',
    consultantName: data.consultantName || 'Consultant',
    clientName: data.clientName || 'Client',
    consultant: party(data.signatureData, data.signedAt, data.consultantName || '', null, ev.consultant),
    client: party(data.clientSignatureData, data.clientSignedAt, data.clientSignerName || data.clientName || '', data.clientName || null, ev.client),
    documentHash,
    revokedAt: data.revokedAt ?? null,
  }, lang, `NDA_${(data.consultantName || 'Consultant').replace(/\s+/g, '_')}_${format(new Date(data.signedAt || Date.now()), 'yyyy-MM-dd')}.pdf`);
}
