// Feature Y e-mails: the one-time urgent "add your weekly availability" notice, administrator reminders and the
// "welcome back" notice when a hold ends. Woken by the database (pg_net, availability_wake) only while e-mails wait in
// availability_email_queue - no permanent schedule. Credential-free like the other sweeps (verify_jwt=false): safety
// lives in the service-role-only availability_email_claim RPC (atomic, at most 5 attempts, 10-minute claim lease) and
// a call can only send what the database queued. Responses contain counts only.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

interface Row { id: string; consultant_id: string; user_id: string; kind: 'first' | 'admin' | 'resumed'; lang: string | null; display_name: string | null; deadline: string | null }

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: Row): Promise<'sent' | 'skipped'> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return 'skipped';
  const lang = row.lang === 'ar' ? 'ar' : 'en';
  const url = `${SITE_URL}/consultant/profile#availability`;
  if (row.kind === 'resumed') {
    await sendTemplateEmail('hold-ended', email, {
      templateData: { name: row.display_name || undefined, lang, url },
      idempotencyKey: `hold-ended-${row.id}`,
    });
    return 'sent';
  }
  await sendTemplateEmail('availability-urgent', email, {
    templateData: { name: row.display_name || undefined, lang, url, deadline: row.deadline || undefined },
    idempotencyKey: `availability-${row.kind}-${row.id}`,
    // The first notice is an essential service notice; administrator reminders follow the pause rules.
    ...(row.kind === 'admin' ? { pause: { userId: row.user_id, category: 'reminders' as const } } : {}),
  });
  return 'sent';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();
  const { data, error } = await admin.rpc('availability_email_claim', { _limit: 100 });
  if (error) {
    console.error('availability claim failed');
    return jsonResponse(req, { ok: false }, 500);
  }
  const rows = (data ?? []) as Row[];
  let sent = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await sendOne(admin, row);
      if (r === 'sent') sent++; else skipped++;
      await admin.rpc('availability_email_done', { _id: row.id, _ok: true });
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : 'send failed';
      await admin.rpc('availability_email_done', { _id: row.id, _ok: false, _error: msg.slice(0, 200) });
    }
  }
  return jsonResponse(req, { ok: true, claimed: rows.length, sent, skipped, failed }, 200);
});
