// Feature Q: one-click "Pause for 3 days | 1 week | 1 month" links (unsubscribe is the managed e-mail footer) from notification e-mails.
// verify_jwt=false: the link carries its own proof. Strict checks, in this order:
//   1. per-IP rate limit, 2. HMAC-SHA256 signature with NOTIFICATION_PAUSE_SECRET (read from the function environment),
//   3. expiry and payload shape, 4. per-recipient rate limit, 5. service-only database action (idempotent per link nonce).
// POST only (link scanners that prefetch GET never change anything). Responses never contain names, addresses or ids.
import { adminClient, clientIp, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { verifyPauseToken } from '../_shared/notificationPause.ts';
const ACTIONS = new Set(['apply', 'resume', 'status', 'unavailable']);

async function shortHash(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { ok: false, error: 'method' }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = typeof body.action === 'string' && ACTIONS.has(body.action) ? body.action : 'apply';

  const admin = adminClient();
  const ip = clientIp(req);
  if (!(await withinRateLimit(admin, `npause-ip:${ip}`, 60, 3600, true))) {
    return jsonResponse(req, { ok: false, error: 'too_many' }, 429);
  }

  const secret = Deno.env.get('NOTIFICATION_PAUSE_SECRET') ?? '';
  if (secret.length < 32) return jsonResponse(req, { ok: false, error: 'unavailable' }, 503);
  const verified = await verifyPauseToken(secret, body.token, Math.floor(Date.now() / 1000));
  if (!verified.ok) {
    return jsonResponse(req, { ok: false, error: verified.reason === 'expired' ? 'expired_link' : 'invalid_link' }, 400);
  }
  const { u: userId, d: duration, n: nonce } = verified.payload;
  if (!(await withinRateLimit(admin, `npause-u:${await shortHash(userId)}`, 20, 3600, true))) {
    return jsonResponse(req, { ok: false, error: 'too_many' }, 429);
  }

  try {
    const dbAction = action === 'apply' ? 'pause' : action;
    const { data, error } = await admin.rpc('notification_pause_link_action', {
      _user_id: userId, _nonce: nonce, _action: dbAction, _duration: duration,
    });
    if (error) return jsonResponse(req, { ok: false, error: 'unavailable' }, 503);
    const r = (data ?? {}) as Record<string, unknown>;
    // Only the pause state goes back: state, end date, chosen length and whether the availability choice applies.
    return jsonResponse(req, {
      ok: r.state !== 'disabled',
      state: r.state ?? 'not_paused',
      until: typeof r.until === 'string' ? r.until : null,
      duration: typeof r.duration === 'string' ? r.duration : null,
      can_mark_unavailable: r.can_mark_unavailable === true,
      unavailable: r.unavailable === true,
      error: r.state === 'disabled' ? 'disabled' : undefined,
    });
  } catch {
    console.error('notification pause link failed');
    return jsonResponse(req, { ok: false, error: 'unavailable' }, 503);
  }
});
