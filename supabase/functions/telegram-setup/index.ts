// Administrator: the state of the Telegram bot and the one-click connection of the bot to this portal.
//   { action: 'status' }       -> is the secret set, which bot it is, where the webhook points, whether the webhook function answers, how many consultants are connected
//   { action: 'set_webhook' }  -> tells Telegram to send the messages of the bot to the telegram-webhook function (with the secret header)
// The bot token (secret TELEGRAM_BOT_TOKEN) is never part of an answer.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { tgCall, webhookSecretFor, webhookUrlFor } from '../_shared/telegram.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);

  let body: { action?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body?.action ?? '');
  if (action !== 'status' && action !== 'set_webhook') return jsonResponse(req, { error: 'Unknown action' }, 400);
  // the admin card reads the status every minute; setting the webhook is rare and has its own, smaller allowance
  if (!(await withinRateLimit(admin, `telegram-setup-${action}:${user.id}`, action === 'status' ? 600 : 20, 3600))) {
    return jsonResponse(req, { error: 'Too many requests' }, 429);
  }

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  if (!token) return jsonResponse(req, { configured: false });

  const secret = await webhookSecretFor(token);
  const expectedUrl = await webhookUrlFor(token, Deno.env.get('SUPABASE_URL') ?? '');
  let set: { ok: boolean; description: string | null } | null = null;
  if (action === 'set_webhook') {
    const res = await tgCall(token, 'setWebhook', {
      url: expectedUrl,
      secret_token: secret,
      allowed_updates: ['message', 'my_chat_member'],
      max_connections: 20,
    });
    set = { ok: res.ok, description: res.ok ? null : String(res.body?.description ?? `http_${res.status}`).slice(0, 200) };
  }

  const me = await tgCall(token, 'getMe');
  if (!me.ok) {
    // 401 = Telegram rejected the token, 404 = the token is malformed. Anything else (network, 429, 5xx) is not the owner's fault.
    if (me.status !== 401 && me.status !== 404) return jsonResponse(req, { error: 'Telegram could not be reached' }, 502);
    return jsonResponse(req, { configured: true, bot_ok: false, set });
  }
  const info = await tgCall(token, 'getWebhookInfo');
  const hook = info.ok ? info.body?.result ?? {} : {};
  const urlMatches = info.ok && hook.url === expectedUrl;

  // prove that the webhook function itself answers the call that Telegram will make: an update that the webhook ignores (no side effects, no database access)
  let probeStatus = 0;
  if (urlMatches) {
    try {
      const probe = await fetch(expectedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: JSON.stringify({ update_id: 0 }),
        signal: AbortSignal.timeout(8000),
      });
      probeStatus = probe.status;
    } catch { /* stays 0 */ }
  }

  const [total, active] = await Promise.all([
    admin.from('telegram_links').select('user_id', { count: 'exact', head: true }),
    admin.from('telegram_links').select('user_id', { count: 'exact', head: true }).eq('active', true),
  ]);
  return jsonResponse(req, {
    configured: true,
    bot_ok: true,
    bot: { username: String(me.body?.result?.username ?? ''), name: String(me.body?.result?.first_name ?? '') },
    webhook: {
      connected: urlMatches && probeStatus === 200,
      url_matches: urlMatches,
      probe_status: probeStatus,
      url_set: info.ok && !!hook.url,
      pending_updates: Number(hook.pending_update_count ?? 0),
      last_error: hook.last_error_message ? String(hook.last_error_message).slice(0, 200) : null,
      last_error_at: hook.last_error_date ? new Date(Number(hook.last_error_date) * 1000).toISOString() : null,
    },
    links: { total: total.count ?? 0, active: active.count ?? 0 },
    set,
  });
});

