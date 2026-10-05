// Shared security helpers for edge functions: CORS allow-list, caller authentication,
// constant-time comparison and DB-backed rate limiting.
//
// Edge functions run on serverless isolates, so in-memory counters are not a real
// rate limit. withinRateLimit uses the check_rate_limit SQL function (service role only).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// deno-lint-ignore no-explicit-any
export type AdminClient = any;

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const BASE_ALLOWED_ORIGINS = [
  'https://www.aisupport360.com',
  'https://aisupport360.com',
  'https://www.aisapsupportnow.com',
  'https://aisapsupportnow.com',
  'https://smartsapsupport.qurtubatalks.com',
  'https://www.qurtubatalks.com',
  'https://smart-sap-connect.lovable.app',
  'http://localhost:8080',
  'http://localhost:5173',
];

// Lovable preview / editor hosts for THIS project only.
const PREVIEW_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/id-preview--2b30b1db-ed1c-4d7b-8706-596c66fe5232\.lovable\.app$/,
  /^https:\/\/2b30b1db-ed1c-4d7b-8706-596c66fe5232(-[a-z0-9-]+)?\.lovableproject\.com$/,
  /^https:\/\/[a-z0-9-]+--2b30b1db-ed1c-4d7b-8706-596c66fe5232\.lovable\.app$/,
];

export function allowedOrigins(): string[] {
  const extra = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...BASE_ALLOWED_ORIGINS, ...extra];
}

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin) || PREVIEW_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

/**
 * CORS headers for the calling origin. The Allow-Origin header is only emitted for
 * allow-listed origins (never a wildcard, never a fallback to a different origin).
 * Also usable as a drop-in for the legacy per-function getCorsHeaders(req) helper.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsHeaders(req) }) : null;
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// ---------------------------------------------------------------------------
// Authentication / authorization
// ---------------------------------------------------------------------------
export const ADMIN_ROLES = ['admin', 'super_admin'];

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function bearerToken(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

/** True only when the request carries the project's service-role key (trusted server-side callers). */
export function isServiceRoleRequest(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const token = bearerToken(req);
  return key.length > 0 && token.length > 0 && timingSafeEqual(token, key);
}

export interface CallerUser {
  id: string;
  email: string | null;
}

/** Validates the caller's user JWT. Returns null for anon-key / service-key / invalid tokens. */
export async function authenticateUser(req: Request): Promise<CallerUser | null> {
  const token = bearerToken(req);
  if (!token || isServiceRoleRequest(req)) return null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return null;
  const sb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export function adminClient(): AdminClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserRoles(admin: AdminClient, userId: string): Promise<string[]> {
  const { data } = await admin.from('user_roles').select('role').eq('user_id', userId);
  return ((data ?? []) as Array<{ role: string }>).map((r) => String(r.role));
}

export function hasAnyRole(roles: string[], allowed: string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

// ---------------------------------------------------------------------------
// Rate limiting (DB-backed, shared across all isolates)
// ---------------------------------------------------------------------------
export async function withinRateLimit(
  admin: AdminClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
  failOpen = false,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('check_rate_limit', {
      _bucket: bucket,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.error('rate-limit check failed:', error.message);
      return failOpen;
    }
    return data === true;
  } catch (e) {
    console.error('rate-limit check threw:', e instanceof Error ? e.message : String(e));
    return failOpen;
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'unknown')).trim();
  return (ip || 'unknown').slice(0, 64);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function maskEmail(email: string): string {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return local.slice(0, 1) + "***@" + domain;
}

export const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://www.aisapsupportnow.com').replace(/\/+$/, '');
