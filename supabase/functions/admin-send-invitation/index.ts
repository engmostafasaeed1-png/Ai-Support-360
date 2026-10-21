// Admin-only: e-mails invitations to sign up as consultant or client.
// One person ({ email, role, name, message, language }) or many ({ invites: [...], dry_run }), max 200 per run:
// addresses are validated and de-duplicated, people who already have an account are skipped, sending is rate limited
// per admin (300 invitations an hour) and every run is recorded in the audit history.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = 200;

type Invite = { email: string; role: 'consultant' | 'client'; name?: string; message?: string; language: 'en' | 'ar' };

// deno-lint-ignore no-explicit-any
function clean(raw: any): Invite | null {
  const email = String(raw?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  return {
    email,
    role: raw?.role === 'consultant' ? 'consultant' : 'client',
    name: String(raw?.name || '').trim().slice(0, 80) || undefined,
    message: String(raw?.message || '').trim().slice(0, 500) || undefined,
    language: raw?.language === 'ar' ? 'ar' : 'en',
  };
}

// deno-lint-ignore no-explicit-any
async function existingAccounts(admin: any, emails: string[]): Promise<Set<string>> {
  const { data, error } = await admin.rpc('um_emails_with_accounts', { _emails: emails });
  if (!error) return new Set((data ?? []) as string[]);
  const found = new Set<string>();
  const wanted = new Set(emails);
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: e2 } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (e2) break;
    for (const u of list.users) if (u.email && wanted.has(u.email.toLowerCase())) found.add(u.email.toLowerCase());
    if (list.users.length < 200) break;
  }
  return found;
}

// deno-lint-ignore no-explicit-any
async function send(inv: Invite) {
  const url = `${SITE_URL}/signup?role=${inv.role}&email=${encodeURIComponent(inv.email)}&invite=admin${inv.language === 'ar' ? '&lang=ar' : ''}`;
  return await sendTemplateEmail('platform-invitation', inv.email, {
    templateData: { name: inv.name, role: inv.role, message: inv.message, url, language: inv.language },
    idempotencyKey: `invite-${inv.role}-${inv.email}-${crypto.randomUUID()}`,
  });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  const roles = await getUserRoles(admin, user.id);
  if (!hasAnyRole(roles, ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
  const { data: allowed, error: permErr } = await admin.rpc('admin_can', { _uid: user.id, _perm: 'users.invite' });
  if (!permErr && allowed !== true) return jsonResponse(req, { error: 'You do not have permission to invite people' }, 403);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (!Array.isArray(body.invites)) {
    const inv = clean(body);
    if (!inv) return jsonResponse(req, { error: 'Valid email is required' }, 400);
    if (!(await withinRateLimit(admin, `um-invite:${user.id}`, 300, 3600))) {
      return jsonResponse(req, { error: 'Too many invitations in the last hour. Please try again later.' }, 429);
    }
    try {
      const res = await send(inv);
      await admin.from('audit_logs').insert({ user_id: user.id, action: 'admin_user.invite', entity_type: 'admin_user',
        metadata: { count: res.sent ? 1 : 0, role: inv.role, language: inv.language } }).then(() => {}, () => {});
      return jsonResponse(req, res.sent ? { sent: true } : { sent: false, reason: res.reason });
    } catch (e) {
      console.error('invite failed', e instanceof Error ? e.message : String(e));
      return jsonResponse(req, { error: 'Could not send the email' }, 500);
    }
  }

  if (body.invites.length > MAX) return jsonResponse(req, { error: `At most ${MAX} invitations per run` }, 400);
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Map<string, Invite>();
  for (const raw of body.invites) {
    const inv = clean(raw);
    if (!inv) { invalid.push(String(raw?.email || '').slice(0, 254)); continue; }
    if (seen.has(inv.email)) { duplicates.push(inv.email); continue; }
    seen.set(inv.email, inv);
  }
  const existing = await existingAccounts(admin, [...seen.keys()]);
  const ready = [...seen.values()].filter((i) => !existing.has(i.email));
  const summary = { valid: ready.map((i) => i.email), invalid, duplicates, existing: [...existing] };
  if (body.dry_run !== false) return jsonResponse(req, { dry_run: true, ...summary });

  const sent: string[] = [];
  const suppressed: string[] = [];
  const failed: string[] = [];
  const notSent: string[] = [];
  for (const inv of ready) {
    if (!(await withinRateLimit(admin, `um-invite:${user.id}`, 300, 3600))) { notSent.push(inv.email); continue; }
    try {
      const res = await send(inv);
      if (res.sent) sent.push(inv.email); else suppressed.push(inv.email);
    } catch (e) {
      console.error('bulk invite failed', e instanceof Error ? e.message : String(e));
      failed.push(inv.email);
    }
  }
  await admin.from('audit_logs').insert({ user_id: user.id, action: 'admin_user.bulk_invite', entity_type: 'admin_user',
    metadata: { sent: sent.length, suppressed: suppressed.length, failed: failed.length, rate_limited: notSent.length,
      skipped_existing: existing.size, invalid: invalid.length, duplicates: duplicates.length } }).then(() => {}, () => {});
  return jsonResponse(req, { dry_run: false, sent, suppressed, failed, rate_limited: notSent, ...summary });
});
