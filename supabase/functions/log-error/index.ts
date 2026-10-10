// Client error reporting endpoint.
//
// Deployed with verify_jwt = false so that signed-out users and crashes during login can still be
// reported. Because it is public and writes with the service role it is throttled per IP and
// globally, payloads are size-limited, and the de-duplication fingerprint is a SHA-256 digest.
import { adminClient, authenticateUser, clientIp, corsHeaders, preflight, withinRateLimit } from '../_shared/security.ts';
import { ignoredReason } from '../_shared/errorNoise.ts';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_CONTEXT_CHARS = 8_000;
const LEVELS = new Set(['warn', 'error', 'fatal']);

interface ErrorPayload {
  level?: string;
  source?: string;
  message: string;
  stack?: string;
  url?: string;
  route?: string;
  user_agent?: string;
  context?: Record<string, unknown>;
}

async function fingerprint(message: string, stack?: string): Promise<string> {
  const base = (message || '') + '|' + (stack || '').split('\n').slice(0, 3).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `fp_${hex.slice(0, 24)}`;
}

/** Strip query string and fragment (they may carry tokens) before storing a URL. */
function cleanUrl(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`.slice(0, max);
  } catch {
    return value.split(/[?#]/)[0].slice(0, max);
  }
}

function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed' }, 405);

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(req, { ok: false, dropped: true, reason: 'too_large' }, 413);

    let body: ErrorPayload;
    try {
      body = JSON.parse(raw) as ErrorPayload;
    } catch {
      return reply(req, { error: 'Invalid JSON' }, 400);
    }
    if (!body || typeof body.message !== 'string' || !body.message) {
      return reply(req, { error: 'message is required' }, 400);
    }

    // Reports nobody can act on (editor preview, crawlers, library noise) never use the rate limit or the table.
    const agent = `${typeof body.user_agent === 'string' ? body.user_agent : ''} ${req.headers.get('user-agent') ?? ''}`;
    const ignored = ignoredReason({ message: body.message, url: body.url, userAgent: agent });
    if (ignored) return reply(req, { ok: true, ignored });

    const supabase = adminClient();

    // Throttle: per IP and globally. Dropping reports is acceptable; flooding the table is not.
    const withinIp = await withinRateLimit(supabase, `log-error:ip:${clientIp(req)}`, 30, 60, true);
    const withinGlobal = await withinRateLimit(supabase, 'log-error:global', 600, 60, true);
    if (!withinIp || !withinGlobal) return reply(req, { ok: false, dropped: true, reason: 'rate_limited' }, 429);

    // Identify the user from the JWT when present (optional).
    const user = await authenticateUser(req).catch(() => null);
    const userId = user?.id ?? null;

    const message = body.message.slice(0, 4000);
    const stack = typeof body.stack === 'string' ? body.stack.slice(0, 8000) : undefined;
    const fp = await fingerprint(message, stack);
    const level = body.level && LEVELS.has(body.level) ? body.level : 'error';

    let context: Record<string, unknown> = {};
    if (body.context && typeof body.context === 'object' && !Array.isArray(body.context)) {
      const serialized = JSON.stringify(body.context);
      context = serialized.length <= MAX_CONTEXT_CHARS ? body.context : { truncated: true, original_size: serialized.length };
    }

    // Dedupe: bump occurrence_count for a recent unresolved error with the same fingerprint (last 1h).
    const { data: existing } = await supabase
      .from('error_reports')
      .select('id, occurrence_count')
      .eq('fingerprint', fp)
      .eq('resolved', false)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('error_reports')
        .update({ occurrence_count: (existing.occurrence_count ?? 1) + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      return reply(req, { ok: true, id: existing.id, deduped: true });
    }

    const { data, error } = await supabase
      .from('error_reports')
      .insert({
        level,
        source: typeof body.source === 'string' ? body.source.slice(0, 100) : 'client',
        message,
        stack: stack ?? null,
        url: cleanUrl(body.url, 1000),
        route: typeof body.route === 'string' ? body.route.split(/[?#]/)[0].slice(0, 500) : null,
        user_agent: typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) : null,
        user_id: userId,
        context,
        fingerprint: fp,
      })
      .select('id')
      .single();
    if (error) throw error;

    return reply(req, { ok: true, id: data.id });
  } catch (e) {
    // Never fail loudly: error reporting must not create new errors.
    console.error('log-error failed:', e instanceof Error ? e.message : String(e));
    return reply(req, { ok: false, dropped: true }, 202);
  }
});
