// "Send to me only" for the Refer & earn invitation on the push and Telegram channels (the in-app test goes through
// admin_referral_invite_send in test mode). Admins and super admins only (checked in code). The recipient is ALWAYS the
// signed-in admin - their own active push devices and their own connected Telegram chat, read from the verified token,
// never from the request. Title prefixed "[TEST] ". Writes no campaign, notification or invitation record (only an audit
// line). Rate limited per admin (6 per hour). Body: { channels: ['push' | 'telegram'], lang?: 'en' | 'ar' }.
import { adminClient, ADMIN_ROLES, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTelegram } from '../_shared/telegram.ts';
import { loadVapidKeys, sendWebPush, subscriptionUpdate } from '../_shared/webpush.ts';
import { footerText, pushMessage, renderVariables, telegramText, toPlainText } from '../_shared/bulkMessaging.ts';

const LINK_PATH = (ch: 'push' | 'telegram') => `/consultant/referrals?tab=programme&from=invite&ch=${ch}`;
type Result = { channel: 'push' | 'telegram'; status: 'sent' | 'skipped' | 'failed'; reason?: string };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  const roles = await getUserRoles(admin, caller.id);
  if (!hasAnyRole(roles, ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);

  let body: { channels?: unknown; lang?: unknown } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const raw = Array.isArray(body.channels) ? body.channels.map(String) : [];
  const channels = (['push', 'telegram'] as const).filter((c) => raw.includes(c));
  if (!channels.length || raw.some((c) => c !== 'push' && c !== 'telegram')) {
    return jsonResponse(req, { error: 'Choose push and / or Telegram' }, 400);
  }
  if (!(await withinRateLimit(admin, `referral-invite-test:${caller.id}`, 6, 3600))) {
    return jsonResponse(req, { error: 'Too many tests, try again later' }, 429);
  }

  const { data: prof } = await admin.from('profiles').select('display_name, preferred_language').eq('user_id', caller.id).maybeSingle();
  const lang: 'en' | 'ar' = body.lang === 'ar' || (body.lang == null && String(prof?.preferred_language ?? '').startsWith('ar')) ? 'ar' : 'en';
  const { data: m, error: mErr } = await admin.rpc('ri_message');
  if (mErr || !m) return jsonResponse(req, { error: 'The invitation text is not available' }, 503);
  const firstName = String(prof?.display_name ?? '').trim().split(/\s+/)[0] ?? '';
  const link = `${SITE_URL}${LINK_PATH('telegram')}`;
  const subject = `[TEST] ${lang === 'ar' ? m.subject_ar : m.subject_en}`;
  const text = renderVariables(String(lang === 'ar' ? m.body_ar : m.body_en), { first_name: firstName, link }, lang);
  const plain = toPlainText(text);

  const results: Result[] = [];
  if (channels.includes('push')) {
    const keys = await loadVapidKeys(admin);
    const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', caller.id).eq('active', true).limit(5);
    if (!keys) results.push({ channel: 'push', status: 'skipped', reason: 'push_not_ready' });
    else if (!subs?.length) results.push({ channel: 'push', status: 'skipped', reason: 'push_not_enabled' });
    else {
      const payload = pushMessage(subject, plain, LINK_PATH('push'), 'referral-invite-test');
      let ok = false;
      for (const s of subs) {
        const res = await sendWebPush(s, payload, { ...keys, subject: SITE_URL }, { ttl: 600, urgency: 'normal', topic: 'test' });
        await admin.from('push_subscriptions').update(subscriptionUpdate(res, new Date().toISOString())).eq('id', s.id);
        if (res.ok) ok = true;
      }
      results.push(ok ? { channel: 'push', status: 'sent' } : { channel: 'push', status: 'failed', reason: 'push_failed' });
    }
  }
  if (channels.includes('telegram')) {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
    const { data: tg } = await admin.from('telegram_links').select('chat_id').eq('user_id', caller.id).eq('active', true).maybeSingle();
    if (!tg?.chat_id) results.push({ channel: 'telegram', status: 'skipped', reason: 'telegram_not_connected' });
    else if (!token) results.push({ channel: 'telegram', status: 'skipped', reason: 'bot_not_configured' });
    else {
      const res = await sendTelegram(token, Number(tg.chat_id), {
        text: telegramText(subject, plain, link, footerText(lang, 'marketing')),
        reply_markup: { inline_keyboard: [[{ text: lang === 'ar' ? 'افتح أحِل واربح' : 'Open Refer & earn', url: link }]] },
      });
      results.push(res.ok ? { channel: 'telegram', status: 'sent' } : { channel: 'telegram', status: 'failed', reason: res.error ?? 'failed' });
    }
  }
  await admin.from('audit_logs').insert({
    user_id: caller.id, action: 'referral_invitation_test', entity_type: 'referral_invitation_run',
    metadata: { channels, results: results.map((r) => `${r.channel}:${r.status}`), test: true },
  });
  return jsonResponse(req, { ok: true, to: 'self', results }, 200);
});
