// SLA reminder delivery (docs/sql/sla-policies.sql). Two callers:
//  * the database (pg_net, sla_wake) while rows wait in sla_delivery_queue - job-token checked (_shared/jobAuth.ts,
//    verify_jwt=false). It can only send what the database queued: the service-only claim RPC leases rows (10 minutes,
//    5 attempts), drops rows whose clock is already met / feature off / person paused (except S1 "cannot be paused").
//    Channels: e-mail (registered, confirmed address only, one recipient per message), Web Push (person's own devices),
//    Telegram (only when linked). SMS does not exist.
//  * an administrator's "Send test to me" ({ action: 'test', kind, lang }): sample data, own address only, 6 per hour.
// Counts-only responses; no names, addresses or ticket text in logs.
import { adminClient, ADMIN_ROLES, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { SENDER_SETTING_KEYS, senderFromSettings } from '../_shared/emailSender.ts';
import { loadVapidKeys, sendWebPush, subscriptionUpdate, type VapidKeys } from '../_shared/webpush.ts';
import { escapeHtml, sendTelegram } from '../_shared/telegram.ts';
import { normaliseSlaKind, sampleSlaEmail, SLA_EMAIL_KINDS, slaShortText, type SlaEmailInput, type SlaEmailKind } from '../_shared/slaEmail.ts';

interface Row { id: string; user_id: string; ticket_id: string; channel: 'email' | 'push' | 'telegram'; kind: string; payload: Record<string, unknown>; email: string | null }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

function inputOf(row: Row, contactEmail: string): SlaEmailInput {
  const p = row.payload ?? {};
  return {
    kind: normaliseSlaKind(p.template ?? row.kind), lang: p.lang === 'ar' ? 'ar' : 'en', ticketTitle: str(p.ticket_title, 120),
    severity: str(p.severity, 2), clock: p.clock === 'workaround' || p.clock === 'resolution' ? p.clock : 'response',
    leftMin: Number.isFinite(Number(p.left_min)) ? Number(p.left_min) : 0,
    role: p.role === 'client' || p.role === 'admin' ? p.role : 'consultant', path: str(p.path, 200), siteUrl: SITE_URL, contactEmail,
  };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();
  const { data: senderRows } = await admin.from('platform_settings').select('key, value').in('key', [...SENDER_SETTING_KEYS]);
  const sender = senderFromSettings(senderRows);

  if (await isJobCaller(req, admin)) {
    const { data, error } = await admin.rpc('sla_claim_deliveries', { _limit: 50 });
    if (error) {
      // Before docs/sql/sla-policies.sql is applied the RPC does not exist: nothing to send.
      console.error('sla claim failed', error.code ?? '');
      return jsonResponse(req, { ok: false, notReady: true }, 503);
    }
    const rows = (data ?? []) as Row[];
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
    let vapid: VapidKeys | null | undefined;
    let sent = 0, skipped = 0, failed = 0;
    for (const row of rows) {
      const input = inputOf(row, sender.contactEmail);
      const url = `${SITE_URL.replace(/\/$/, '')}${input.path ?? '/'}`;
      let ok = false;
      let reason: string | undefined;
      try {
        if (row.channel === 'email') {
          const { data: u } = await admin.auth.admin.getUserById(row.user_id);
          if (!row.email || !u?.user?.email_confirmed_at) { reason = 'no_address'; }
          else {
            const r = await sendTemplateEmail('sla-notice', row.email, {
              templateData: input as unknown as Record<string, unknown>,
              idempotencyKey: `sla-${row.id}`,
              displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
              pause: { userId: row.user_id, category: row.payload?.unpausable === true ? 'essential' : 'reminders' },
            });
            ok = r.sent; if (!r.sent) reason = r.reason ?? 'skipped';
          }
        } else if (row.channel === 'telegram') {
          const { data: link } = await admin.from('telegram_links').select('chat_id').eq('user_id', row.user_id).eq('active', true).maybeSingle();
          if (!token || !link?.chat_id) { reason = 'not_connected'; }
          else {
            const m = slaShortText(input);
            const r = await sendTelegram(token, link.chat_id, {
              text: `<b>${escapeHtml(m.title)}</b>\n${escapeHtml(m.body)}`,
              reply_markup: { inline_keyboard: [[{ text: input.lang === 'ar' ? 'فتح التذكرة' : 'Open the ticket', url }]] },
            });
            if (r.blocked) await admin.from('telegram_links').update({ active: false, last_error: (r.error ?? 'blocked').slice(0, 60), last_error_at: new Date().toISOString() }).eq('user_id', row.user_id);
            ok = r.ok; if (!r.ok) reason = r.blocked ? 'not_connected' : r.error ?? 'failed';
          }
        } else {
          const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', row.user_id).eq('active', true).limit(10);
          if (!subs?.length) { reason = 'not_connected'; }
          else {
            if (vapid === undefined) vapid = await loadVapidKeys(admin);
            if (!vapid) { reason = 'not_connected'; }
            else {
              const m = slaShortText(input);
              const payload = JSON.stringify({ title: m.title, body: m.body, url, tag: `sla-${row.ticket_id.slice(0, 8)}`, ts: Date.now() });
              for (const s of subs) {
                const out = await sendWebPush(s, payload, { ...vapid, subject: SITE_URL }, { ttl: 6 * 3600, urgency: input.severity === 'S1' ? 'high' : 'normal' });
                await admin.from('push_subscriptions').update(subscriptionUpdate({ status: 0, ...out }, new Date().toISOString())).eq('id', s.id);
                ok = ok || out.ok;
              }
              if (!ok) reason = 'failed';
            }
          }
        }
        if (ok) sent++; else skipped++;
        await admin.rpc('sla_finish_delivery', { _id: row.id, _ok: ok, _error: ok ? null : reason ?? 'skipped' });
      } catch (e) {
        failed++;
        await admin.rpc('sla_finish_delivery', { _id: row.id, _ok: false, _error: (e instanceof Error ? e.message : 'send failed').slice(0, 200) });
      }
    }
    return jsonResponse(req, { ok: true, claimed: rows.length, sent, skipped, failed }, 200);
  }

  // Administrator test send (sample data, own confirmed address only).
  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const roles = await getUserRoles(admin, caller.id);
  if (!hasAnyRole(roles, ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
  let body: { action?: unknown; kind?: unknown; lang?: unknown } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  if (body.action !== 'test') return jsonResponse(req, { error: 'Unknown action' }, 400);
  const kind = String(body.kind ?? 'reminder');
  if (!(SLA_EMAIL_KINDS as readonly string[]).includes(kind)) return jsonResponse(req, { error: 'Choose one of the SLA e-mails' }, 400);
  const lang = body.lang === 'ar' ? 'ar' : 'en';
  const { data: u } = await admin.auth.admin.getUserById(caller.id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return jsonResponse(req, { error: 'Your own e-mail address is not confirmed' }, 400);
  if (!(await withinRateLimit(admin, `sla-test:${caller.id}`, 6, 3600))) return jsonResponse(req, { error: 'Too many test e-mails, try again later' }, 429);
  try {
    const r = await sendTemplateEmail('sla-notice', email, {
      templateData: { ...sampleSlaEmail(kind as SlaEmailKind, lang), siteUrl: SITE_URL, contactEmail: sender.contactEmail, test: true },
      subjectPrefix: '[TEST] ',
      displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
      idempotencyKey: `sla-test-${caller.id}-${crypto.randomUUID()}`,
    });
    return jsonResponse(req, { ok: r.sent, reason: r.sent ? undefined : r.reason, to: 'self' }, 200);
  } catch (e) {
    const err = e as { code?: string };
    return jsonResponse(req, { ok: false, error: err.code ?? 'send_failed' }, 502);
  }
});
