// NDA signing calls. The rules live in supabase/functions/_shared/ndaSignature.ts (shared with the nda-signature edge
// function) and docs/sql/nda-signature-identity.sql. Before that SQL is applied, fetchSigningSettings returns null and
// the screens keep the previous signing dialogs, so signing never stops working.
import { supabase } from '@/integrations/supabase/client';
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import type { IdType, NdaEvidence, NdaParty, NdaStatus, SignMethod, Stroke } from '../../../supabase/functions/_shared/ndaSignature';

export * from '../../../supabase/functions/_shared/ndaSignature';

export interface SigningSettings {
  available: true;
  allow_typed_signature: boolean;
  store_ip: boolean;
  id_retention_years: number;
  reminder_hours: number;
}

/** null = the stricter signing is not installed yet (legacy dialogs stay in use). */
export async function fetchSigningSettings(): Promise<SigningSettings | null> {
  const { data, error } = await safeRpc<SigningSettings>('nda_signing_settings');
  if (error || !data || (data as { available?: boolean }).available !== true) return null;
  return data;
}

export async function fetchNdaStatus(a: { ndaId?: string | null; consultantId?: string | null; clientId?: string | null }): Promise<NdaStatus | null> {
  if (!a.ndaId && !(a.consultantId && a.clientId)) return null;
  const { data, error } = await safeRpc<NdaStatus>('nda_signature_status', {
    _nda: a.ndaId ?? null, _consultant: a.ndaId ? null : a.consultantId, _client: a.ndaId ? null : a.clientId,
  });
  if (error) {
    if (isMissingRpc(error)) return null;
    throw new Error(error.message);
  }
  return data;
}

/** Evidence rows (masked ID only) for several NDAs at once; empty before the SQL is applied. */
export async function fetchNdaEvidence(ndaIds: string[]): Promise<Map<string, Partial<Record<NdaParty, NdaEvidence>>>> {
  const out = new Map<string, Partial<Record<NdaParty, NdaEvidence>>>();
  if (!ndaIds.length) return out;
  const { data, error } = await (supabase as unknown as { from: (t: string) => any })
    .from('nda_signatures')
    .select('id, nda_id, party, kind, method, signer_name, job_title, company_name, id_type, id_country, id_masked, document_hash, image_sha256, signed_at, captured_at')
    .in('nda_id', ndaIds);
  if (error || !Array.isArray(data)) return out;
  for (const r of data as Array<NdaEvidence & { id: string; nda_id: string; party: NdaParty }>) {
    const m = out.get(r.nda_id) ?? {};
    m[r.party] = { ...r, signature_id: r.id };
    out.set(r.nda_id, m);
  }
  return out;
}

async function invoke<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; code: string; nextAt?: string | null }> {
  const { data, error } = await supabase.functions.invoke('nda-signature', { body });
  if (!error) return { ok: true, data: data as T };
  let code = 'nda_failed';
  let nextAt: string | null = null;
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const j = await ctx.json();
      if (typeof j?.error === 'string') code = j.error;
      if (typeof j?.next_at === 'string') nextAt = j.next_at;
    }
  } catch { /* keep the generic code */ }
  return { ok: false, code, nextAt };
}

export interface SignRequest {
  action: 'sign' | 'supplement';
  party: NdaParty;
  ndaId?: string | null;
  consultantId?: string | null;
  clientId?: string | null;
  ndaContent?: string | null;
  method: SignMethod;
  strokes: Stroke[];
  typedSignature?: string;
  png: string;
  signerName: string;
  jobTitle?: string;
  companyName?: string;
  idType: IdType;
  idCountry: string;
  idNumber: string;
}

export async function submitSignature(r: SignRequest) {
  return invoke<{ ok: true; nda_id: string; signature_id: string; idempotent: boolean; emailed: boolean }>({
    action: r.action, party: r.party, nda_id: r.ndaId ?? undefined, consultant_id: r.consultantId ?? undefined, client_id: r.clientId ?? undefined,
    nda_content: r.ndaContent ?? undefined, method: r.method, strokes: r.strokes, typed_signature: r.typedSignature, png: r.png,
    signer_name: r.signerName, job_title: r.jobTitle || undefined, company_name: r.companyName || undefined,
    id_type: r.idType, id_country: r.idCountry, id_number: r.idNumber, authorised: true, agreed: true,
  });
}

export async function sendNdaReminder(a: { ndaId?: string | null; consultantId?: string | null; clientId?: string | null }) {
  return invoke<{ ok: true; emailed: boolean }>({ action: 'remind', nda_id: a.ndaId ?? undefined, consultant_id: a.consultantId ?? undefined, client_id: a.clientId ?? undefined });
}

export async function revealIdNumber(signatureId: string, reason?: string) {
  return invoke<{ id_number: string; id_type: IdType; id_country: string }>({ action: 'reveal', signature_id: signatureId, reason });
}

export async function logNdaDownload(ndaId: string): Promise<void> {
  await safeRpc('nda_log_download', { _nda: ndaId });
}

export interface AdminNdaRow {
  nda_id: string;
  created_at: string;
  revoked_at: string | null;
  consultant_name: string;
  client_name: string;
  consultant_signed_at: string | null;
  client_signed_at: string | null;
  document_hash: string;
  signatures: Array<Pick<NdaEvidence, 'signature_id' | 'kind' | 'method' | 'signer_name' | 'job_title' | 'company_name' | 'id_type' | 'id_country' | 'id_masked' | 'signed_at' | 'captured_at' | 'image_sha256'>
    & { party: NdaParty; anonymised: boolean; full_id_views: number }>;
}

export async function fetchAdminSignatures(q: string): Promise<AdminNdaRow[] | null> {
  const { data, error } = await safeRpc<AdminNdaRow[]>('nda_admin_signatures', { _q: q || null, _limit: 200 });
  if (error) {
    if (isMissingRpc(error)) return null;
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function fetchAdminAccessLog(signatureId: string): Promise<Array<{ at: string; role: string; reason: string; by: string }>> {
  const { data } = await safeRpc<Array<{ at: string; role: string; reason: string; by: string }>>('nda_admin_access_log', { _signature: signatureId });
  return data ?? [];
}

export async function saveSigningSettings(patch: Partial<Omit<SigningSettings, 'available'>>, reason: string) {
  const { data, error } = await safeRpc<SigningSettings>('nda_admin_set_signing_settings', { _patch: patch, _reason: reason });
  if (error) throw new Error(error.message);
  return data;
}

/** User-facing error key for a code from the edge function / database (translations under ndaSign.err.*). */
export function errorKey(code: string): string {
  const known = ['nda_rate_limited', 'nda_reminder_too_soon', 'nda_not_your_party', 'nda_no_relation', 'nda_consultant_not_verified', 'nda_already_signed',
    'nda_revoked', 'nda_signature_too_small', 'nda_signature_image_invalid', 'nda_name_invalid', 'nda_id_invalid', 'nda_id_country_invalid',
    'nda_company_details_required', 'nda_contact_details', 'nda_typed_not_allowed', 'nda_id_key_missing', 'nda_reason_required', 'nda_forbidden',
    'nda_identity_anonymised', 'nda_nothing_to_remind', 'nda_content_invalid', 'nda_invalid_input'];
  return `ndaSign.err.${known.includes(code) ? code : 'generic'}`;
}
