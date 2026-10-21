// Feature U — in-app feedback ("Report a bug / suggest an improvement").
//
// POST multipart/form-data  { action: "submit", payload: JSON, files: up to 3 images }  — anyone (visitors when allowed)
// POST application/json     { action: "reply", id, message, email: boolean }            — administrators
// POST application/json     { action: "maintenance" }                                   — anyone; only removes what is due
//
// Safety lives in the database functions (service-only submit with validation, rate limits and masking) plus the checks
// here: the user id comes only from a verified token, visitors are identified by a salted IP hash (never the IP itself),
// images are checked by their first bytes, stored under random names in the private "feedback" bucket, and nothing
// personal is written to the logs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { adminClient, authenticateUser, bearerToken, clientIp, getUserRoles, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { cleanPath, FEEDBACK_LIMITS, IMAGE_EXT, sniffImageType, validateFeedback, type FeedbackImageType } from '../_shared/feedback.ts';

const BUCKET = 'feedback';
const MAX_BODY = FEEDBACK_LIMITS.files * FEEDBACK_LIMITS.fileBytes + 64 * 1024;

async function ipHash(req: Request): Promise<string> {
  const salt = Deno.env.get('FEEDBACK_IP_SALT') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'feedback';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`feedback:${clientIp(req)}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

function publicError(message: string): { code: string; status: number } {
  const m = String(message ?? '');
  for (const code of ['rate_limited', 'feedback_disabled', 'too_fast', 'invalid_type', 'invalid_severity', 'invalid_title',
    'invalid_description', 'invalid_email', 'invalid_request', 'too_many_files']) {
    if (m.includes(code)) return { code, status: code === 'rate_limited' ? 429 : code === 'feedback_disabled' ? 403 : 400 };
  }
  return { code: 'error', status: 500 };
}

async function runRetention(admin: any): Promise<{ removed: number; reports: number }> {
  const { data, error } = await admin.rpc('feedback_claim_retention', { _limit: 50 });
  if (error || !data) return { removed: 0, reports: 0 };
  const paths: string[] = Array.isArray(data.paths) ? data.paths : [];
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
  return { removed: paths.length, reports: Number(data.reports_deleted ?? 0) };
}

async function handleSubmit(req: Request): Promise<Response> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY) return jsonResponse(req, { error: 'file_too_large' }, 413);
  let form: FormData;
  try { form = await req.formData(); } catch { return jsonResponse(req, { error: 'invalid_request' }, 400); }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(String(form.get('payload') ?? '{}')); } catch { return jsonResponse(req, { error: 'invalid_request' }, 400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return jsonResponse(req, { error: 'invalid_request' }, 400);

  const errors = validateFeedback({
    type: String(payload.type ?? '') as any,
    severity: (payload.severity as any) ?? null,
    title: String(payload.title ?? ''),
    description: String(payload.description ?? ''),
    contactEmail: String(payload.contact_email ?? ''),
  });
  if (Object.keys(errors).length) return jsonResponse(req, { error: 'invalid_request', fields: errors }, 400);

  // Files are checked before anything is stored.
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length > FEEDBACK_LIMITS.files) return jsonResponse(req, { error: 'too_many_files' }, 400);
  const images: Array<{ bytes: Uint8Array; type: FeedbackImageType }> = [];
  for (const f of files) {
    if (f.size < 1 || f.size > FEEDBACK_LIMITS.fileBytes) return jsonResponse(req, { error: 'file_too_large' }, 400);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return jsonResponse(req, { error: 'file_type' }, 400);
    images.push({ bytes, type });
  }

  const caller = bearerToken(req) ? await authenticateUser(req) : null;
  const admin = adminClient();
  const body = {
    ...payload,
    route: cleanPath(String(payload.route ?? '/')),
    // The visible account e-mail is never shown in the dialog; when the user leaves it empty we fall back to it later.
    contact_email: String(payload.contact_email ?? '').trim() || null,
  };
  const { data, error } = await admin.rpc('submit_feedback', {
    _user_id: caller?.id ?? null,
    _ip_hash: caller ? null : await ipHash(req),
    _payload: body,
  });
  if (error) {
    const e = publicError(error.message);
    if (e.status === 500) console.error('feedback submit failed');
    return jsonResponse(req, { error: e.code }, e.status);
  }
  const id: string | null = data?.id ?? null;
  if (!id) return jsonResponse(req, { ok: true }); // dropped as spam: looks the same as success

  let stored = 0;
  if (images.length) {
    const uploaded: Array<{ path: string; content_type: string; size: number }> = [];
    for (const img of images) {
      const path = `${id}/${crypto.randomUUID()}.${IMAGE_EXT[img.type]}`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, img.bytes, { contentType: img.type, upsert: false });
      if (!upErr) uploaded.push({ path, content_type: img.type, size: img.bytes.length });
    }
    if (uploaded.length) {
      const { error: attErr } = await admin.rpc('feedback_add_attachments', { _report_id: id, _files: uploaded });
      if (attErr) await admin.storage.from(BUCKET).remove(uploaded.map((u) => u.path));
      else stored = uploaded.length;
    }
  }

  // Retention runs now and then on submit, so no extra schedule is needed.
  if (Math.random() < 0.05) await runRetention(admin).catch(() => undefined);
  return jsonResponse(req, { ok: true, id, screenshots: stored, screenshots_failed: images.length - stored });
}

async function handleReply(req: Request, body: Record<string, unknown>): Promise<Response> {
  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  const roles = await getUserRoles(admin, caller.id);
  if (!roles.includes('admin') && !roles.includes('super_admin')) return jsonResponse(req, { error: 'Forbidden' }, 403);
  const id = String(body.id ?? '');
  const message = String(body.message ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || message.length < 2 || message.length > 2000) return jsonResponse(req, { error: 'invalid_request' }, 400);

  // The reply is written as the administrator, so the database checks the role and audits it.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${bearerToken(req)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: eventId, error } = await asUser.rpc('feedback_admin_reply', { _id: id, _message: message });
  if (error || !eventId) {
    const e = publicError(error?.message ?? '');
    return jsonResponse(req, { error: e.code === 'error' ? 'reply_failed' : e.code }, e.status === 500 ? 400 : e.status);
  }

  let emailed: 'sent' | 'no_consent' | 'skipped' | 'failed' = 'skipped';
  if (body.email === true) {
    if (!(await withinRateLimit(admin, `feedback-reply-mail:${caller.id}`, 60, 3600))) {
      return jsonResponse(req, { ok: true, emailed: 'failed', reason: 'rate_limited' });
    }
    const { data: claim } = await admin.rpc('feedback_reply_email_claim', { _event_id: eventId });
    if (!claim?.to) emailed = 'no_consent';
    else {
      try {
        const res = await sendTemplateEmail('feedback-reply', claim.to, {
          templateData: { title: claim.title, message: claim.message, lang: claim.lang === 'ar' ? 'ar' : 'en', link: `${SITE_URL}/my-feedback` },
          idempotencyKey: `feedback-reply-${eventId}`,
          ...(claim.user_id ? { pause: { userId: claim.user_id, category: 'essential' as const } } : {}),
        });
        emailed = res.sent ? 'sent' : 'skipped';
      } catch {
        emailed = 'failed';
      }
    }
  }
  return jsonResponse(req, { ok: true, emailed });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) return handleSubmit(req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (body.action === 'reply') return handleReply(req, body);
  if (body.action === 'maintenance') {
    const admin = adminClient();
    if (!(await withinRateLimit(admin, 'feedback-maintenance', 4, 3600))) return jsonResponse(req, { ok: true, skipped: true });
    return jsonResponse(req, { ok: true, ...(await runRetention(admin)) });
  }
  return jsonResponse(req, { error: 'invalid_request' }, 400);
});
