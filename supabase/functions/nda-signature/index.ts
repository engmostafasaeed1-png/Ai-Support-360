// NDA signing with signer identity (docs/sql/nda-signature-identity.sql). Signed-in callers only (token checked in code).
// Actions:
//  * sign / supplement - validate every item with _shared/ndaSignature.ts (strokes, real PNG, name, ID, authorisation,
//    company details), encrypt the ID number with NDA_ID_ENCRYPTION_KEY (never stored in clear, never sent back),
//    upload the PNG to the private nda-documents bucket, then call the service-only nda_sign_record with the verified
//    user id (the database checks everything again and decides the party). E-mails the other party.
//  * remind  - nda_reminder_record (1 per 24 h per pair) + e-mail in the "reminders" pause category.
//  * reveal  - the full ID number for the signer (own record) or an admin with a reason; the read is logged first.
import { z } from 'https://esm.sh/zod@3.23.8';
import { adminClient, authenticateUser, clientIp, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { SENDER_SETTING_KEYS, senderFromSettings } from '../_shared/emailSender.ts';
import {
  base64ToBytes, idProblems, maskIdNumber, nameProblems, normaliseIdNumber, normaliseName, pngInfo, sha256Hex,
  shortTextProblems, signatureProblems, strokeMetrics, SIGNATURE_RULES,
} from '../_shared/ndaSignature.ts';
import { decryptIdNumber, encryptIdNumber, ID_KEY_ENV, keyUsable } from '../_shared/ndaIdCrypto.ts';

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const SignBody = z.object({
  action: z.enum(['sign', 'supplement']),
  party: z.enum(['client', 'consultant']),
  nda_id: z.string().uuid().optional(),
  consultant_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  nda_content: z.string().max(200_000).optional(),
  method: z.enum(['draw', 'typed']),
  strokes: z.array(z.array(point).max(SIGNATURE_RULES.maxPoints)).max(SIGNATURE_RULES.maxStrokes).default([]),
  typed_signature: z.string().max(200).optional(),
  png: z.string().min(10).max(420_000),
  signer_name: z.string().max(200),
  job_title: z.string().max(200).optional(),
  company_name: z.string().max(300).optional(),
  id_type: z.enum(['national_id', 'passport']),
  id_country: z.string().max(4),
  id_number: z.string().max(40),
  authorised: z.literal(true),
  agreed: z.literal(true),
});
const RemindBody = z.object({
  action: z.literal('remind'),
  nda_id: z.string().uuid().optional(),
  consultant_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
});
const RevealBody = z.object({ action: z.literal('reveal'), signature_id: z.string().uuid(), reason: z.string().max(500).optional() });

const codeOf = (msg: string | undefined) => (String(msg ?? '').match(/nda_[a-z_]+/)?.[0] ?? 'nda_failed');
const FORBIDDEN = new Set(['nda_not_your_party', 'nda_forbidden', 'nda_not_found', 'nda_no_relation', 'nda_consultant_not_verified']);
const fail = (req: Request, code: string, extra: Record<string, unknown> = {}) =>
  jsonResponse(req, { error: code, ...extra }, FORBIDDEN.has(code) ? 403 : code === 'nda_rate_limited' || code === 'nda_reminder_too_soon' ? 429 : 400);

interface Notify { user_id: string; role: string; kind: 'needs_signature' | 'reminder' | 'fully_signed'; lang: 'en' | 'ar'; signer: string; path: string }

async function mail(admin: ReturnType<typeof adminClient>, n: Notify, key: string) {
  try {
    const { data: u } = await admin.auth.admin.getUserById(n.user_id);
    const email = u?.user?.email;
    if (!email || !u.user.email_confirmed_at) return { sent: false, reason: 'no_address' };
    const { data: senderRows } = await admin.from('platform_settings').select('key, value').in('key', [...SENDER_SETTING_KEYS]);
    const sender = senderFromSettings(senderRows);
    const r = await sendTemplateEmail('nda-notice', email, {
      templateData: { lang: n.lang, kind: n.kind, signer: n.signer, path: n.path, siteUrl: SITE_URL, contactEmail: sender.contactEmail },
      idempotencyKey: key,
      displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
      pause: { userId: n.user_id, category: n.kind === 'reminder' ? 'reminders' : 'essential' },
    });
    return { sent: r.sent, reason: r.sent ? undefined : r.reason };
  } catch (e) {
    console.error('nda mail failed', (e as { code?: string }).code ?? 'send_failed');
    return { sent: false, reason: 'send_failed' };
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonResponse(req, { error: 'invalid_body' }, 400); }
  const action = (raw as { action?: unknown })?.action;

  // ---------------------------------------------------------------- reminder
  if (action === 'remind') {
    const p = RemindBody.safeParse(raw);
    if (!p.success) return jsonResponse(req, { error: 'invalid_body' }, 400);
    if (!(await withinRateLimit(admin, `nda-remind:${caller.id}`, 20, 3600))) return fail(req, 'nda_rate_limited');
    const { data, error } = await admin.rpc('nda_reminder_record', { _actor: caller.id, _nda: p.data.nda_id ?? null, _consultant: p.data.consultant_id ?? null, _client: p.data.client_id ?? null });
    if (error) return fail(req, codeOf(error.message), codeOf(error.message) === 'nda_reminder_too_soon' ? { next_at: error.details ?? null } : {});
    const n = data as Notify;
    const hour = new Date().toISOString().slice(0, 13);
    const m = await mail(admin, n, `nda-remind-${caller.id}-${p.data.nda_id ?? p.data.consultant_id}-${hour}`);
    return jsonResponse(req, { ok: true, emailed: m.sent }, 200);
  }

  // ---------------------------------------------------------------- full ID number
  if (action === 'reveal') {
    const p = RevealBody.safeParse(raw);
    if (!p.success) return jsonResponse(req, { error: 'invalid_body' }, 400);
    const secret = Deno.env.get(ID_KEY_ENV);
    if (!keyUsable(secret)) return jsonResponse(req, { error: 'nda_id_key_missing' }, 503);
    const { data, error } = await admin.rpc('nda_identity_cipher_for', { _actor: caller.id, _signature: p.data.signature_id, _reason: p.data.reason ?? null });
    if (error) return fail(req, codeOf(error.message));
    const row = data as { cipher: string; user_id: string; id_type: string; id_country: string; id_masked: string };
    try {
      const value = await decryptIdNumber(row.cipher, secret, row.user_id);
      return jsonResponse(req, { id_number: value, id_type: row.id_type, id_country: row.id_country }, 200, { 'Cache-Control': 'no-store' });
    } catch (e) {
      return jsonResponse(req, { error: (e as Error).message === 'id_key_mismatch' ? 'nda_id_key_mismatch' : 'nda_id_unreadable' }, 500);
    }
  }

  // ---------------------------------------------------------------- sign / supplement
  const p = SignBody.safeParse(raw);
  if (!p.success) return jsonResponse(req, { error: 'nda_invalid_input', fields: Object.keys(p.error.flatten().fieldErrors) }, 400);
  const b = p.data;
  if (!(await withinRateLimit(admin, `nda-sign:${caller.id}`, 10, 3600))) return fail(req, 'nda_rate_limited');
  const secret = Deno.env.get(ID_KEY_ENV);
  if (!keyUsable(secret)) return jsonResponse(req, { error: 'nda_id_key_missing' }, 503);

  // the same rules as the form, on the server
  const metrics = strokeMetrics(b.strokes);
  if (b.method === 'draw' && signatureProblems(metrics).length) return fail(req, 'nda_signature_too_small');
  if (b.method === 'typed' && nameProblems(b.typed_signature ?? '').length) return fail(req, 'nda_signature_too_small');
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(b.png); } catch { return fail(req, 'nda_signature_image_invalid'); }
  const info = pngInfo(bytes);
  if (!info.ok) return fail(req, 'nda_signature_image_invalid');
  const name = normaliseName(b.signer_name);
  if (nameProblems(name).length) return fail(req, 'nda_name_invalid');
  const country = b.id_country.toUpperCase();
  if (idProblems(b.id_type, country, b.id_number).length) return fail(req, 'nda_id_invalid');
  if (b.party === 'client' && (shortTextProblems(b.job_title ?? '', 80).length || shortTextProblems(b.company_name ?? '', 160).length)) return fail(req, 'nda_company_details_required');

  const idNumber = normaliseIdNumber(b.id_number);
  const sha = await sha256Hex(bytes);
  const cipher = await encryptIdNumber(idNumber, secret, caller.id);
  const ua = req.headers.get('user-agent');
  const path = `signatures/${caller.id}/${crypto.randomUUID()}.png`;
  const up = await admin.storage.from('nda-documents').upload(path, bytes, { contentType: 'image/png', upsert: false });
  if (up.error) {
    console.error('nda signature upload failed');
    return jsonResponse(req, { error: 'nda_upload_failed' }, 500);
  }
  const { data, error } = await admin.rpc('nda_sign_record', {
    _actor: caller.id,
    _p: {
      party: b.party, kind: b.action === 'supplement' ? 'supplement' : 'signature', method: b.method,
      nda_id: b.nda_id ?? null, consultant_id: b.consultant_id ?? null, client_id: b.client_id ?? null, nda_content: b.nda_content ?? null,
      png_base64: b.png.replace(/^data:image\/png;base64,/, ''), image_sha256: sha, image_path: path, metrics,
      signer_name: name, job_title: b.job_title ?? null, company_name: b.company_name ?? null,
      id_type: b.id_type, id_country: country, id_masked: maskIdNumber(idNumber), id_cipher: cipher,
      authorised: true, agreed: true, user_agent_hash: ua ? await sha256Hex(ua) : null, ip: clientIp(req),
    },
  });
  if (error || (data as { idempotent?: boolean })?.idempotent) {
    await admin.storage.from('nda-documents').remove([path]);
  }
  if (error) return fail(req, codeOf(error.message));
  const r = data as { signature_id: string; nda_id: string; party: string; idempotent: boolean; notify?: Notify | null };
  let emailed = false;
  if (!r.idempotent && r.notify?.user_id) emailed = (await mail(admin, r.notify, `nda-${r.notify.kind}-${r.signature_id}`)).sent;
  return jsonResponse(req, { ok: true, nda_id: r.nda_id, signature_id: r.signature_id, idempotent: r.idempotent, emailed }, 200);
});
