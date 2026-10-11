// Consultant: connect Telegram to receive the critical request alerts as a message on the phone.
//   { action: 'start' } -> a one-time code and the link https://t.me/<bot>?start=<code> (valid 15 minutes, single use)
//   { action: 'test' }  -> a test message to the chat that is linked now
// The bot token is the secret TELEGRAM_BOT_TOKEN; without it, or while the bot is not connected to the portal, the answer is { configured: false } (the screen explains it).
import { adminClient, authenticateUser, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { LINK_CODE_MINUTES, newLinkCode, sendTelegram, sha256Hex, tgCall, webhookUrlFor } from '../_shared/telegram.ts';

let cachedBot: { token: string; username: string } | null = null;

/** The user name of the bot. transient = Telegram could not be reached (not a wrong token), so the screen can say "try again later". */
async function botUsername(token: string): Promise<{ username: string | null; transient: boolean }> {
  if (cachedBot && cachedBot.token === token) return { username: cachedBot.username, transient: false };
  const me = await tgCall(token, 'getMe');
  const username = me.ok ? String(me.body?.result?.username ?? '') : '';
  if (!username) return { username: null, transient: me.status === 0 || me.status === 429 || me.status >= 500 };
  cachedBot = { token, username };
  return { username, transient: false };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  let body: { action?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body?.action ?? '');
  if (action !== 'start' && action !== 'test') return jsonResponse(req, { error: 'Unknown action' }, 400);

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  if (!token) return jsonResponse(req, { configured: false });

  const admin = adminClient();
  const { data: consultant } = await admin.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
  if (!consultant) return jsonResponse(req, { error: 'Only consultants can connect Telegram' }, 403);
  if (!(await withinRateLimit(admin, `telegram-link-${action}:${user.id}`, action === 'start' ? 10 : 6, 3600))) {
    return jsonResponse(req, { error: 'Too many requests' }, 429);
  }

  if (action === 'start') {
    const bot = await botUsername(token);
    if (!bot.username) return jsonResponse(req, bot.transient ? { configured: false, reason: 'bot_unreachable' } : { configured: false });
    // A Start press only reaches telegram-webhook when the webhook of the bot points at it. Block only on a definite answer from Telegram:
    // a failed diagnostic call must not tell the consultant that the administrator did something wrong.
    const hook = await tgCall(token, 'getWebhookInfo');
    const expectedUrl = await webhookUrlFor(token, Deno.env.get('SUPABASE_URL') ?? '');
    if (hook.ok && hook.body?.result?.url !== expectedUrl) return jsonResponse(req, { configured: false, reason: 'webhook_missing' });
    const code = newLinkCode();
    const { error } = await admin.from('telegram_link_codes').insert({
      code_hash: await sha256Hex(code),
      user_id: user.id,
      expires_at: new Date(Date.now() + LINK_CODE_MINUTES * 60_000).toISOString(),
    });
    if (error) {
      console.error('telegram link code failed:', error.message);
      return jsonResponse(req, { error: 'Could not create the link' }, 500);
    }
    return jsonResponse(req, { configured: true, url: `https://t.me/${bot.username}?start=${code}`, bot_username: bot.username, expires_in: LINK_CODE_MINUTES * 60 });
  }

  const { data: link } = await admin.from('telegram_links').select('chat_id, active').eq('user_id', user.id).maybeSingle();
  if (!link || !link.active) return jsonResponse(req, { configured: true, sent: false, reason: 'not_connected' });
  const res = await sendTelegram(token, Number(link.chat_id), {
    text: '✅ Test alert from AI Support 360. When a client opens a critical SAP request for your area, you will get a message like this here.',
  });
  const now = new Date().toISOString();
  if (res.ok) await admin.from('telegram_links').update({ last_sent_at: now, last_error: null, last_error_at: null }).eq('user_id', user.id);
  else if (res.blocked) await admin.from('telegram_links').update({ active: false, last_error: 'bot_blocked', last_error_at: now }).eq('user_id', user.id);
  return jsonResponse(req, { configured: true, sent: res.ok, reason: res.ok ? null : res.blocked ? 'bot_blocked' : (res.error ?? 'failed') });
});

