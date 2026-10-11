// Tells the consultants who were alerted about a critical request, by e-mail, by Telegram and by a push message to their phones (Web Push). The alarm and
// the in-app notice are made by the database; these are the three outside channels. The client who owns the ticket (or an administrator) calls it right
// after the request is created or changed.
//   { ticket_id } -> one e-mail, one Telegram message and one push message per device of every alerted consultant and version of the request: the first
//   alert, and again after an extension.
// Nobody is told after the reply window, after a reply, after "not for me", or once a consultant is assigned.
// Telegram is only used for consultants who connected it (table telegram_links) while the bot token (secret TELEGRAM_BOT_TOKEN) exists.
// Push messages go to the devices in the table push_subscriptions while the VAPID keys of the platform exist (function push-setup).
// The channels run in separate pools of workers, so that a slow channel never holds back another one.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { buildAlertMessage, safeAreas, sendTelegram } from '../_shared/telegram.ts';
import { buildAlertPush, loadVapidKeys, pushTtlSeconds, sendWebPush, subscriptionUpdate } from '../_shared/webpush.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECIPIENTS = 300;
const PARALLEL = 6;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const ticketId = String(body?.ticket_id ?? '');
  if (!UUID_RE.test(ticketId)) return jsonResponse(req, { error: 'ticket_id is required' }, 400);

  const admin = adminClient();
  const { data: ticket } = await admin.from('tickets')
    .select('id, client_id, title, sap_modules, status, consultant_id, critical_response, critical_surcharge_percent, critical_due_at, critical_extensions')
    .eq('id', ticketId).maybeSingle();
  // the same answer for a ticket that does not exist, is not a critical request or belongs to somebody else
  if (!ticket || !ticket.critical_response) return jsonResponse(req, { error: 'Not found' }, 404);
  if (ticket.client_id !== user.id && !hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Not found' }, 404);

  const due = new Date(ticket.critical_due_at).getTime();
  if (!Number.isFinite(due) || due <= Date.now() || ticket.consultant_id || ['resolved', 'closed', 'cancelled'].includes(String(ticket.status))) {
    return jsonResponse(req, { sent: 0, skipped: 0, telegram_sent: 0, telegram_skipped: 0, push_sent: 0, push_skipped: 0, reason: 'closed' });
  }
  if (!(await withinRateLimit(admin, `critical-alert-email:${user.id}`, 20, 3600, true))) return jsonResponse(req, { error: 'Too many requests' }, 429);

  const version = Number(ticket.critical_extensions ?? 0);
  const [alertsRes, repliesRes] = await Promise.all([
    admin.from('critical_alerts').select('id, consultant_id, user_id, emailed_ext, telegram_ext, push_ext').eq('ticket_id', ticketId).is('dismissed_at', null).limit(MAX_RECIPIENTS),
    admin.from('critical_replies').select('consultant_id').eq('ticket_id', ticketId),
  ]);
  const replied = new Set((repliesRes.data ?? []).map((r: any) => r.consultant_id));
  const open: any[] = (alertsRes.data ?? []).filter((a: any) => !replied.has(a.consultant_id));
  const ids: string[] = open.map((a: any) => a.user_id);

  // the consultants who connected Telegram (only when the bot exists); the queries are split so that a long list of ids stays short
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  const chats = new Map<string, number>();
  if (botToken && ids.length > 0) {
    for (let i = 0; i < ids.length; i += 100) {
      const { data: links } = await admin.from('telegram_links').select('user_id, chat_id').eq('active', true).in('user_id', ids.slice(i, i + 100));
      (links ?? []).forEach((l: any) => chats.set(l.user_id, Number(l.chat_id)));
    }
  }

  // the devices of the consultants who turned phone alerts on (only when the keys of the platform exist)
  const vapidKeys = await loadVapidKeys(admin);
  const devices = new Map<string, { id: string; endpoint: string; p256dh: string; auth: string }[]>();
  if (vapidKeys && ids.length > 0) {
    for (let i = 0; i < ids.length; i += 100) {
      const { data: subs } = await admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').eq('active', true).in('user_id', ids.slice(i, i + 100));
      (subs ?? []).forEach((s: any) => devices.set(s.user_id, [...(devices.get(s.user_id) ?? []), { id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }]));
    }
  }

  const emailQueue: any[] = open.filter((a: any) => a.emailed_ext === null || a.emailed_ext < version);
  const telegramQueue: any[] = open.filter((a: any) => chats.has(a.user_id) && (a.telegram_ext === null || a.telegram_ext < version));
  const pushQueue: any[] = open.filter((a: any) => devices.has(a.user_id) && (a.push_ext === null || a.push_ext < version));

  const minutesLeft = Math.max(1, Math.ceil((due - Date.now()) / 60_000));
  const until = `${new Date(due).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
  const areas = ((ticket.sap_modules as string[] | null) ?? []).join(', ').slice(0, 160) || 'SAP';
  const percent = Number(ticket.critical_surcharge_percent ?? 0);
  const url = `${SITE_URL}/consultant/open-tickets?critical=${ticketId}`;
  // the area names that go to the phones are plain names only (the e-mail keeps its own text as before)
  const plainAreas = safeAreas(ticket.sap_modules);
  const telegramMessage = buildAlertMessage({ areas: plainAreas, minutes: minutesLeft, percent, url, updated: version > 0, until });
  const pushPayload = buildAlertPush({ areas: plainAreas, minutes: minutesLeft, percent, url, ticketId, updated: version > 0 });
  const pushTtl = pushTtlSeconds(due, Date.now());
  const pushTopic = ticketId.replace(/-/g, '').slice(0, 32);
  let sent = 0;
  let skipped = 0;
  let telegramSent = 0;
  let telegramSkipped = 0;
  let pushSent = 0;
  let pushSkipped = 0;

  const emailWorker = async () => {
    for (let a = emailQueue.shift(); a; a = emailQueue.shift()) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(a.user_id);
        const email = u?.user?.email;
        if (!email) { skipped++; continue; }
        const { data: p } = await admin.from('profiles').select('display_name').eq('user_id', a.user_id).maybeSingle();
        const res = await sendTemplateEmail('critical-request-alert', email, {
          templateData: {
            name: p?.display_name || undefined,
            title: String(ticket.title ?? '').slice(0, 160),
            areas,
            minutes: minutesLeft,
            percent,
            until,
            updated: version > 0,
            url,
          },
          idempotencyKey: `critical-${ticketId}-${a.consultant_id}-${version}`,
        });
        // a suppressed address is not tried again; a switched-off e-mail service is (the window is still open)
        if (res.sent || res.reason === 'recipient_suppressed') {
          await admin.from('critical_alerts').update({ emailed_at: new Date().toISOString(), emailed_ext: version }).eq('id', a.id);
        }
        if (res.sent) sent++; else skipped++;
      } catch (e) {
        console.error('critical alert e-mail failed', a.consultant_id, e instanceof Error ? e.message : String(e));
        skipped++;
      }
    }
  };

  const telegramWorker = async () => {
    for (let a = telegramQueue.shift(); a; a = telegramQueue.shift()) {
      let claimed = false;
      try {
        // Telegram has no idempotency key: this version of the alert is claimed first with one UPDATE, so of two calls at the same time only one sends
        // (the second UPDATE waits for the row lock, finds telegram_ext set already and changes 0 rows). An older call cannot lower telegram_ext either.
        // If the function is killed between the claim and the send, this version is not sent again; the alarm and the e-mail still reach the consultant.
        const claim = await admin.from('critical_alerts').update({ telegram_ext: version }).eq('id', a.id)
          .or(`telegram_ext.is.null,telegram_ext.lt.${version}`).select('id');
        if (claim.error) {
          console.error('critical alert Telegram claim failed', a.consultant_id, claim.error.message);
          telegramSkipped++;
          continue;
        }
        if (!claim.data || claim.data.length === 0) continue; // another call took it
        claimed = true;
        const res = await sendTelegram(botToken, chats.get(a.user_id)!, telegramMessage);
        const now = new Date().toISOString();
        if (res.ok) {
          await admin.from('critical_alerts').update({ telegram_sent_at: now }).eq('id', a.id);
          await admin.from('telegram_links').update({ last_sent_at: now, last_error: null, last_error_at: null }).eq('user_id', a.user_id);
          telegramSent++;
        } else {
          // a blocked bot pauses the link (the consultant sees it in the settings); any other failure is only noted. Either way the claim is given back,
          // so that the next call (for example after an extension, or after the consultant reconnects) can try again.
          await admin.from('critical_alerts').update({ telegram_ext: a.telegram_ext ?? null }).eq('id', a.id).eq('telegram_ext', version);
          claimed = false;
          await admin.from('telegram_links').update(res.blocked
            ? { active: false, last_error: 'bot_blocked', last_error_at: now }
            : { last_error: res.error ?? 'failed', last_error_at: now }).eq('user_id', a.user_id);
          telegramSkipped++;
        }
      } catch (e) {
        console.error('critical alert Telegram failed', a.consultant_id, e instanceof Error ? e.message : String(e));
        if (claimed) {
          try { await admin.from('critical_alerts').update({ telegram_ext: a.telegram_ext ?? null }).eq('id', a.id).eq('telegram_ext', version); } catch { /* the next call may then send it again */ }
        }
        telegramSkipped++;
      }
    }
  };

  const pushWorker = async () => {
    for (let a = pushQueue.shift(); a; a = pushQueue.shift()) {
      let claimed = false;
      try {
        // the same claim as for Telegram: one UPDATE decides which call sends this version of the alert
        const claim = await admin.from('critical_alerts').update({ push_ext: version }).eq('id', a.id)
          .or(`push_ext.is.null,push_ext.lt.${version}`).select('id');
        if (claim.error) {
          console.error('critical alert push claim failed', a.consultant_id, claim.error.message);
          pushSkipped++;
          continue;
        }
        if (!claim.data || claim.data.length === 0) continue; // another call took it
        claimed = true;
        let accepted = 0;
        for (const device of devices.get(a.user_id) ?? []) {
          const res = await sendWebPush(device, pushPayload, { ...vapidKeys!, subject: SITE_URL }, { ttl: pushTtl, urgency: 'high', topic: pushTopic });
          await admin.from('push_subscriptions').update(subscriptionUpdate(res, new Date().toISOString())).eq('id', device.id);
          if (res.ok) accepted++;
          else console.warn('critical alert push not accepted', a.consultant_id, res.status, res.error);
        }
        if (accepted > 0) {
          await admin.from('critical_alerts').update({ push_sent_at: new Date().toISOString() }).eq('id', a.id);
          pushSent++;
        } else {
          // no device took the message: the claim is given back, so that the next call can try again
          await admin.from('critical_alerts').update({ push_ext: a.push_ext ?? null }).eq('id', a.id).eq('push_ext', version);
          claimed = false;
          pushSkipped++;
        }
      } catch (e) {
        console.error('critical alert push failed', a.consultant_id, e instanceof Error ? e.message : String(e));
        if (claimed) {
          try { await admin.from('critical_alerts').update({ push_ext: a.push_ext ?? null }).eq('id', a.id).eq('push_ext', version); } catch { /* the next call may then send it again */ }
        }
        pushSkipped++;
      }
    }
  };

  await Promise.all([
    ...Array.from({ length: Math.min(PARALLEL, emailQueue.length) }, () => emailWorker()),
    ...Array.from({ length: Math.min(PARALLEL, telegramQueue.length) }, () => telegramWorker()),
    ...Array.from({ length: Math.min(PARALLEL, pushQueue.length) }, () => pushWorker()),
  ]);

  return jsonResponse(req, { sent, skipped, telegram_sent: telegramSent, telegram_skipped: telegramSkipped, push_sent: pushSent, push_skipped: pushSkipped });
});

