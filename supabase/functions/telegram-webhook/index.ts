// The webhook of the Telegram bot: Telegram calls it for every message to the bot (verify_jwt is off, the call is trusted only through the secret header).
//   /start <code>  -> links the Telegram chat to the portal account that created the code (single use, 15 minutes)
//   /stop          -> pauses the messages
//   the user blocks the bot -> the link is paused
//   any other text -> the bot says that it only sends alerts
// It always answers 200 once the call is authentic, so that Telegram does not repeat updates; failures are logged.
import { adminClient, timingSafeEqual, withinRateLimit } from '../_shared/security.ts';
import { classifyUpdate, escapeHtml, maskAccountEmail, sendTelegram, sha256Hex, webhookSecretFor } from '../_shared/telegram.ts';

const MAX_BODY = 65_536;
const done = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  if (!token) return new Response('Not configured', { status: 503 });
  const given = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!timingSafeEqual(given, await webhookSecretFor(token))) return new Response('Unauthorized', { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response('Too large', { status: 413 });
  let update: unknown = null;
  try { update = JSON.parse(raw); } catch { return done(); }

  const event = classifyUpdate(update);
  if (event.kind === 'ignore') return done();

  try {
    const admin = adminClient();
    // a chat that sends too many messages is ignored for a while (failing open: a broken rate limit must not block a real link)
    if (!(await withinRateLimit(admin, `telegram-webhook:${event.chatId}`, 30, 600, true))) return done();
    const now = new Date().toISOString();

    if (event.kind === 'start') {
      // is this chat linked and active already? (it changes what a repeated or plain /start is answered)
      const { data: current } = await admin.from('telegram_links').select('active').eq('chat_id', event.chatId).maybeSingle();
      const connected = !!current?.active;
      if (!event.code) {
        await sendTelegram(token, event.chatId, {
          text: connected
            ? '✅ This chat is already connected to your AI Support 360 account. When a client opens a critical SAP request for your area, you will get a message here. Send /stop to pause these messages.'
            : 'To connect this chat, open Settings in the AI Support 360 portal and press "Connect Telegram" (or "Reconnect Telegram" if the alerts are paused).',
        });
        return done();
      }
      const { data: userId, error } = await admin.rpc('telegram_complete_link', {
        _code_hash: await sha256Hex(event.code),
        _chat_id: event.chatId,
        _username: event.username,
      });
      if (error) console.error('telegram link failed:', error.message);
      let reply: string;
      if (userId) {
        // name the account (masked), so that a person who pressed Start on a link of somebody else notices it
        let who = '';
        try {
          const { data: u } = await admin.auth.admin.getUserById(String(userId));
          const masked = u?.user?.email ? maskAccountEmail(u.user.email) : '';
          if (masked) who = ` to the portal account ${escapeHtml(masked)}`;
        } catch (e) {
          console.error('telegram account lookup failed:', e instanceof Error ? e.message : String(e));
        }
        reply = `✅ Connected${who}. When a client opens a critical SAP request for your area, you will get a message here. If this is not your account, send /stop and then press "Connect Telegram" in your own portal Settings. The in-app alarm and the e-mail are not affected.`;
      } else if (error) {
        reply = 'Something went wrong on our side. Please press "Connect Telegram" in the portal Settings again in a minute.';
      } else {
        // the function cannot tell a used code from an expired or unknown one, so a chat that is connected already gets an answer that is true in every case
        reply = connected
          ? 'This link was already used or has expired. This chat is connected to an AI Support 360 account, so you do not need to do anything. To connect a different account, open its Settings in the portal and press "Connect Telegram".'
          : 'This link was already used or has expired. Open Settings in the AI Support 360 portal and press "Connect Telegram" (or "Reconnect Telegram") again.';
      }
      await sendTelegram(token, event.chatId, { text: reply });
    } else if (event.kind === 'stop') {
      await admin.from('telegram_links').update({ active: false, last_error: 'stopped', last_error_at: now }).eq('chat_id', event.chatId);
      await sendTelegram(token, event.chatId, {
        text: 'Stopped. You will not get critical request messages here. The in-app alarm and the e-mail still work. To start again, open Settings in the AI Support 360 portal and press "Reconnect Telegram".',
      });
    } else if (event.kind === 'other') {
      await sendTelegram(token, event.chatId, {
        text: 'I only send critical request alerts. To answer a request, tap "Open the request and reply" on the alert, or open the request in the AI Support 360 portal. Send /stop to pause the alerts.',
      });
    } else {
      await admin.from('telegram_links').update({ active: false, last_error: 'bot_blocked', last_error_at: now }).eq('chat_id', event.chatId);
    }
  } catch (e) {
    console.error('telegram webhook failed:', e instanceof Error ? e.message : String(e));
  }
  return done();
});

