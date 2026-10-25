import { supabase } from '@/integrations/supabase/client';
import { exportNDAAsPDF } from '@/lib/ndaPdfExport';

/** "View / download" for one NDA: the party's own copy (with the other party's status) or the fully signed copy. */
export async function downloadNdaById(ndaId: string, names: { consultantName?: string; clientName?: string }, lang?: 'en' | 'ar') {
  const { data, error } = await supabase
    .from('nda_agreements')
    .select('id, nda_content, signature_data, signature_type, signed_at, revoked_at, client_signature_data, client_signature_type, client_signer_name, client_signed_at')
    .eq('id', ndaId)
    .maybeSingle();
  if (error || !data) throw new Error('nda_not_found');
  await exportNDAAsPDF({
    ndaContent: data.nda_content || '',
    signatureData: data.signature_data || '',
    signatureType: data.signature_type || 'type',
    signedAt: data.signed_at,
    consultantName: names.consultantName,
    clientName: names.clientName,
    agreementId: data.id,
    revokedAt: data.revoked_at,
    clientSignatureData: data.client_signature_data,
    clientSignatureType: data.client_signature_type,
    clientSignerName: data.client_signer_name,
    clientSignedAt: data.client_signed_at,
    lang,
  });
}
