// Administrator: the keys and the numbers of the phone alerts (Web Push).
//   { action: 'status' }   -> are the keys created, how many devices and consultants get phone alerts, how many pushes failed in the last 24 hours
//   { action: 'generate' } -> creates the VAPID key pair of the platform once (when there is one already, nothing changes)
// The private key stays in the table push_vapid_keys (nobody but the service role can read it) and is never part of an answer.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { generateVapidKeys, loadVapidKeys } from '../_shared/webpush.ts';

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
  if (action !== 'status' && action !== 'generate') return jsonResponse(req, { error: 'Unknown action' }, 400);
  if (!(await withinRateLimit(admin, `push-setup-${action}:${user.id}`, action === 'status' ? 600 : 10, 3600))) {
    return jsonResponse(req, { error: 'Too many requests' }, 429);
  }

  let created = false;
  let keys = await loadVapidKeys(admin);
  if (action === 'generate' && !keys) {
    const fresh = await generateVapidKeys();
    // one row only (id = true): a second call at the same time changes nothing
    const { error } = await admin.from('push_vapid_keys').upsert({ id: true, public_key: fresh.publicKey, private_jwk: fresh.privateJwk }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      console.error('push keys could not be saved:', error.message);
      return jsonResponse(req, { error: 'The keys could not be saved' }, 500);
    }
    keys = await loadVapidKeys(admin);
    created = !!keys && keys.publicKey === fresh.publicKey;
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [active, users, failed] = await Promise.all([
    admin.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('active', true),
    admin.from('push_subscriptions').select('user_id').eq('active', true).limit(5000),
    admin.from('push_subscriptions').select('id', { count: 'exact', head: true }).gte('last_error_at', since),
  ]);
  return jsonResponse(req, {
    configured: !!keys,
    created,
    devices: active.count ?? 0,
    consultants: new Set(((users.data ?? []) as { user_id: string }[]).map((r) => r.user_id)).size,
    failed_24h: failed.count ?? 0,
  });
});

