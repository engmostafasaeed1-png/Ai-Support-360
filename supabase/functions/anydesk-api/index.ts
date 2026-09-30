// AnyDesk directory API proxy.
//
// The AnyDesk API key belongs to the platform operator's own AnyDesk account and exposes that
// account's whole device / session / licence inventory, so only platform administrators may use
// it. Other signed-in users only learn that the directory is restricted.
import { z } from 'https://esm.sh/zod@3.23.8';
import {
  ADMIN_ROLES,
  adminClient,
  authenticateUser,
  getUserRoles,
  hasAnyRole,
  jsonResponse,
  preflight,
  withinRateLimit,
} from '../_shared/security.ts';

const ANYDESK_API_BASE = 'https://v1.api.anydesk.com';
const ID_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const TIME_RE = /^[0-9TZ:+.-]{1,40}$/;
const SORTS = new Set(['last-session', 'alias', 'client-id', 'online', 'version']);
const ORDERS = new Set(['asc', 'desc']);

const SetAliasSchema = z.object({
  clientId: z.union([z.string().regex(ID_RE), z.number().int().nonnegative()]),
  alias: z.string().max(200).optional(),
});

class UpstreamError extends Error {
  status: number;
  constructor(status: number) {
    super('AnyDesk request failed');
    this.status = status;
  }
}
class BadRequest extends Error {}

function intParam(v: string | null, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function idParam(v: string | null, name: string): string {
  if (!v || !ID_RE.test(v)) throw new BadRequest(`${name} is missing or invalid`);
  return v;
}

async function anydesk(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${ANYDESK_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error(`AnyDesk API error [${res.status}] ${path.split('?')[0]}`);
    throw new UpstreamError(res.status);
  }
  return res;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const user = await authenticateUser(req);
    if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

    const admin = adminClient();
    const isAdmin = hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES);
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const apiKey = Deno.env.get('ANYDESK_API_KEY');

    if (action === 'status') {
      return jsonResponse(
        req,
        isAdmin
          ? { configured: Boolean(apiKey), missing: apiKey ? [] : ['ANYDESK_API_KEY'] }
          : { configured: false, restricted: true, missing: [] },
      );
    }

    if (!isAdmin) return jsonResponse(req, { error: 'Forbidden' }, 403);
    if (!apiKey) return jsonResponse(req, { error: 'AnyDesk integration not configured' }, 503);
    if (!(await withinRateLimit(admin, `anydesk:${user.id}`, 60, 60, true))) {
      return jsonResponse(req, { error: 'Too many requests' }, 429);
    }

    let result: unknown;

    switch (action) {
      case 'clients': {
        const offset = intParam(url.searchParams.get('offset'), 0, 0, 100_000);
        const limit = intParam(url.searchParams.get('limit'), 50, 1, 100);
        const sortParam = url.searchParams.get('sort') ?? 'last-session';
        const orderParam = url.searchParams.get('order') ?? 'desc';
        if (!SORTS.has(sortParam) || !ORDERS.has(orderParam)) throw new BadRequest('Invalid sort or order');
        let endpoint = `/clients?offset=${offset}&limit=${limit}&sort=${encodeURIComponent(sortParam)}&order=${orderParam}`;
        if (url.searchParams.get('online') === 'true') endpoint += '&online=true';
        result = await (await anydesk(endpoint, apiKey)).json();
        break;
      }

      case 'client-detail': {
        const clientId = idParam(url.searchParams.get('clientId'), 'clientId');
        result = await (await anydesk(`/clients/${encodeURIComponent(clientId)}`, apiKey)).json();
        break;
      }

      case 'sessions': {
        const limit = intParam(url.searchParams.get('limit'), 50, 1, 100);
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        const clientId = url.searchParams.get('clientId') ?? '';
        if ((from && !TIME_RE.test(from)) || (to && !TIME_RE.test(to))) throw new BadRequest('Invalid time range');
        if (clientId && !ID_RE.test(clientId)) throw new BadRequest('clientId is invalid');
        let endpoint = `/sessions?limit=${limit}`;
        if (from) endpoint += `&from=${encodeURIComponent(from)}`;
        if (to) endpoint += `&to=${encodeURIComponent(to)}`;
        if (clientId) endpoint += `&cid=${encodeURIComponent(clientId)}`;
        result = await (await anydesk(endpoint, apiKey)).json();
        break;
      }

      case 'session-detail': {
        const sessionId = idParam(url.searchParams.get('sessionId'), 'sessionId');
        result = await (await anydesk(`/sessions/${encodeURIComponent(sessionId)}`, apiKey)).json();
        break;
      }

      case 'set-alias': {
        if (req.method !== 'POST') throw new BadRequest('POST required');
        const parsed = SetAliasSchema.safeParse(await req.json());
        if (!parsed.success) return jsonResponse(req, { error: parsed.error.flatten().fieldErrors }, 400);
        const { clientId, alias } = parsed.data;
        await anydesk(`/clients/${encodeURIComponent(String(clientId))}`, apiKey, {
          method: 'PATCH',
          body: JSON.stringify({ alias: alias || '' }),
        });
        result = { success: true };
        break;
      }

      case 'connection-link': {
        const clientId = idParam(url.searchParams.get('clientId'), 'clientId');
        result = {
          uri: `anydesk:${clientId}`,
          clientId,
          instructions: 'Click the link or paste the AnyDesk ID into your AnyDesk app to connect.',
        };
        break;
      }

      case 'license': {
        result = await (await anydesk('/license', apiKey)).json();
        break;
      }

      default:
        return jsonResponse(
          req,
          {
            error: 'Invalid action',
            validActions: ['status', 'clients', 'client-detail', 'sessions', 'session-detail', 'set-alias', 'connection-link', 'license'],
          },
          400,
        );
    }

    return jsonResponse(req, result);
  } catch (error: unknown) {
    if (error instanceof BadRequest) return jsonResponse(req, { error: error.message }, 400);
    if (error instanceof UpstreamError) return jsonResponse(req, { error: 'AnyDesk request failed' }, 502);
    console.error('anydesk-api error:', error instanceof Error ? error.message : String(error));
    return jsonResponse(req, { error: 'Internal error' }, 500);
  }
});
