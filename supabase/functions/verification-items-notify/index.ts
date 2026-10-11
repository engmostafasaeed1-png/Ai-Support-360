// Emails consultants about their open verification items.
//   { action: "assigned", consultant_id } -> admin only; emails the consultant their open items.
//   { action: "reminders" }               -> daily job; emails items due within 3 days, once per item.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, isServiceRoleRequest, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

type Admin = ReturnType<typeof adminClient>;

async function emailConsultant(admin: Admin, consultantId: string, items: any[], reminder: boolean, key: string) {
  const { data: c } = await admin.from('consultants').select('user_id').eq('id', consultantId).maybeSingle();
  if (!c?.user_id) return false;
  const { data: u } = await admin.auth.admin.getUserById(c.user_id);
  const email = u?.user?.email;
  if (!email) return false;
  const { data: p } = await admin.from('profiles').select('display_name').eq('user_id', c.user_id).maybeSingle();
  const res = await sendTemplateEmail('verification-items', email, {
    templateData: {
      name: p?.display_name || undefined,
      reminder,
      items: items.map((i) => ({ label: i.label, due: fmt(i.due_at) })),
      url: `${SITE_URL}/consultant/verification`,
    },
    idempotencyKey: key,
  });
  return res.sent;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const admin = adminClient();

  if (body.action === 'assigned') {
    const user = await authenticateUser(req);
    if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
    if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
    const id = String(body.consultant_id || '');
    if (!UUID_RE.test(id)) return jsonResponse(req, { error: 'consultant_id is required' }, 400);
    const { data: items } = await admin.from('consultant_verification_items')
      .select('id, label, due_at').eq('consultant_id', id).neq('status', 'verified').order('due_at');
    if (!items?.length) return jsonResponse(req, { sent: false });
    const sent = await emailConsultant(admin, id, items, false, `verif-assigned-${items.map((i) => i.id).sort().join('').slice(0, 200)}`);
    return jsonResponse(req, { sent });
  }

  if (body.action === 'reminders') {
    // Daily job: only the scheduler (service role) or an administrator may trigger it — it reads private
    // verification items and sends e-mails, so an anonymous caller must not run it.
    if (!isServiceRoleRequest(req)) {
      const user = await authenticateUser(req);
      if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
      if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
    }
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { data: items } = await admin.from('consultant_verification_items')
      .select('id, consultant_id, label, due_at').eq('status', 'open').is('reminder_sent_at', null)
      .gt('due_at', new Date().toISOString()).lte('due_at', soon).limit(500);
    const groups = new Map<string, any[]>();
    for (const i of items ?? []) groups.set(i.consultant_id, [...(groups.get(i.consultant_id) ?? []), i]);
    let count = 0;
    for (const [cid, list] of groups) {
      try {
        await emailConsultant(admin, cid, list, true, `verif-reminder-${list.map((i) => i.id).sort().join('').slice(0, 200)}`);
        count++;
      } catch (e) { console.error('reminder failed', cid, e); continue; }
      await admin.from('consultant_verification_items').update({ reminder_sent_at: new Date().toISOString() }).in('id', list.map((i) => i.id));
    }
    return jsonResponse(req, { consultants: count });
  }

  return jsonResponse(req, { error: 'Unknown action' }, 400);
});
