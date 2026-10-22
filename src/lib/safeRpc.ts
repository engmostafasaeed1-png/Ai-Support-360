import { supabase } from '@/integrations/supabase/client';

/**
 * Database function calls for the app's own RPC helpers.
 *
 * `supabase.rpc()` returns a query builder that can be awaited but has no `.catch()`. Chaining `.catch()` on it
 * throws "catch is not a function" and takes the whole page down. `safeRpc` always returns a real Promise that
 * never rejects: network failures and missing functions come back as `{ data: null, error }`.
 */
export interface RpcError { message: string; code?: string; details?: string; hint?: string }
export interface RpcResult<T = unknown> { data: T | null; error: RpcError | null }

type RawRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

function toError(e: unknown): RpcError {
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    return {
      message: String(o.message ?? 'Request failed'),
      ...(typeof o.code === 'string' ? { code: o.code } : {}),
      ...(typeof o.details === 'string' ? { details: o.details } : {}),
      ...(typeof o.hint === 'string' ? { hint: o.hint } : {}),
    };
  }
  return { message: String(e ?? 'Request failed') };
}

export async function safeRpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<RpcResult<T>> {
  try {
    // Called on the client object itself: a detached rpc method loses its binding.
    const res = await (supabase as unknown as { rpc: RawRpc }).rpc(fn, args);
    return { data: ((res?.data ?? null) as T | null), error: res?.error ? toError(res.error) : null };
  } catch (e) {
    return { data: null, error: toError(e) };
  }
}

/** True when the database function is not installed yet (prepared SQL not applied) or the API cannot find it. */
export function isMissingRpc(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|schema cache|PGRST202|404/i.test(String(error.message ?? ''));
}

/** Runs a best-effort call without ever throwing or leaving an unhandled rejection (works for builders and promises). */
export function fireAndForget(run: () => PromiseLike<unknown> | unknown): void {
  try {
    Promise.resolve(run()).then(undefined, () => undefined);
  } catch {
    /* best effort */
  }
}
