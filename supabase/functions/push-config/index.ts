// Phone alerts (Web Push) for a signed-in consultant.
//   { action: 'config' } -> { configured, public_key }: the public VAPID key that the browser needs to subscribe (nothing secret)
//   { action: 'test' }   -> a test message to every active device of the consultant
// While the administrator has not created the keys (function push-setup) the answer is { configured: false } and the screen explains it.
import { adminClient, authenticateUser, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { loadVapidKeys, sendWebPush, subscriptionUpdate } from '../_shared/webpush.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  let body: { action?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body?.action ?? '');
  if (action !== 'config' && action !== 'test') return jsonResponse(req, { error: 'Unknown action' }, 400);

  const admin = adminClient();
  const keys = await loadVapidKeys(admin);
  if (!keys) return jsonResponse(req, { configured: false });
  if (action === 'config') return jsonResponse(req, { configured: true, public_key: keys.publicKey });

  const { data: consultant } = await admin.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
  if (!consultant) return jsonResponse(req, { error: 'Only consultants can turn on phone alerts' }, 403);
  if (!(await withinRateLimit(admin, `push-test:${user.id}`, 6, 3600))) return jsonResponse(req, { error: 'Too many requests' }, 429);

  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', user.id).eq('active', true).limit(8);
  const list: { id: string; endpoint: string; p256dh: string; auth: string }[] = subs ?? [];
  if (list.length === 0) return jsonResponse(req, { configured: true, devices: 0, sent: 0, failed: 0 });

  const payload = JSON.stringify({
    v: 1,
    title: 'Test alert from AI Support 360',
    body: 'Phone alerts are on for this device. When a client opens a critical SAP request for your area, you will get a message like this.',
    url: `${SITE_URL}/consultant/settings`,
    tag: 'test',
    urgent: false,
    sent_at: Date.now(),
  });
  let sent = 0;
  let failed = 0;
  for (const s of list) {
    const res = await sendWebPush(s, payload, { ...keys, subject: SITE_URL }, { ttl: 300, urgency: 'high', topic: 'test' });
    await admin.from('push_subscriptions').update(subscriptionUpdate(res, new Date().toISOString())).eq('id', s.id);
    if (res.ok) sent++;
    else { failed++; console.warn('test push not accepted', res.status, res.error); }
  }
  return jsonResponse(req, { configured: true, devices: list.length, sent, failed });
});

