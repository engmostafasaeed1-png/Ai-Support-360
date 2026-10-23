import { safeRpc, type RpcResult } from '@/lib/safeRpc';

/**
 * Refer & earn invitation click-throughs (docs/sql/referral-invite-tracking.sql).
 * The invitation links carry only `from=invite&ch=<channel>` - no token, id or address. When a signed-in consultant opens
 * the page from such a link, the database records one click for that person, invitation version and channel (only if
 * they really received the invitation). No tracking pixels: e-mail opens are not measured.
 * Mirrors INVITE_CLICK_CHANNELS of supabase/functions/_shared/bulkMessagesRun.ts (checked by a test).
 */
export const INVITE_CLICK_CHANNELS = ['in_app', 'push', 'telegram', 'email'] as const;
export type InviteClickChannel = typeof INVITE_CLICK_CHANNELS[number];

/** Channel of an invitation link, or null when the page was not opened from one. Old untagged links were bell notices. */
export function inviteSourceFrom(params: URLSearchParams): InviteClickChannel | null {
  if (params.get('from') !== 'invite') return null;
  const ch = params.get('ch') ?? '';
  return (INVITE_CLICK_CHANNELS as readonly string[]).includes(ch) ? (ch as InviteClickChannel) : 'in_app';
}

/** The same address without the tracking tag, so a reload or a shared copy is not counted again. */
export function withoutInviteTag(params: URLSearchParams): URLSearchParams {
  const n = new URLSearchParams(params);
  n.delete('from');
  n.delete('ch');
  return n;
}

const SESSION_KEY = 'ai360.invite-click.';

/** True once per browser tab session and channel; storage problems count as "not yet" (the server dedupes anyway). */
export function claimInviteClick(channel: InviteClickChannel, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession()): boolean {
  if (!storage) return true;
  try {
    if (storage.getItem(SESSION_KEY + channel)) return false;
    storage.setItem(SESSION_KEY + channel, '1');
  } catch { /* private mode: still count once, the database keeps one row per person */ }
  return true;
}

function safeSession(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult<unknown>>;

/** Best effort: never throws, never blocks the page. Returns true when the database counted the click. */
export async function trackInviteClick(channel: InviteClickChannel, rpc: Rpc = safeRpc, storage?: Pick<Storage, 'getItem' | 'setItem'> | null): Promise<boolean> {
  if (!claimInviteClick(channel, storage === undefined ? safeSession() : storage)) return false;
  try {
    const r = await rpc('referral_invite_track_click', { _channel: channel });
    return r.data === true;
  } catch {
    return false;
  }
}

export interface InviteEffectiveness {
  available: boolean;
  version: number;
  versions: number[];
  /** Consultants the invitation reached on at least one channel (tests excluded). */
  reached: number;
  delivered: Record<InviteClickChannel, number>;
  /** Bell notices marked read. */
  read_in_app: number;
  /** Consultants who opened Refer & earn from the invitation, per channel and in total (each person once). */
  clicked: Record<InviteClickChannel, number>;
  clickers: number;
  /** Clicks from the admins' own test sends, kept apart. */
  test_clicks: number;
  first_click_at: string | null;
  last_click_at: string | null;
}

const zero = (): Record<InviteClickChannel, number> => ({ in_app: 0, push: 0, telegram: 0, email: 0 });
const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** Shapes the administrators-only effectiveness summary; anything missing reads as zero. */
export function parseEffectiveness(raw: unknown): InviteEffectiveness {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rec = (v: unknown) => {
    const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const out = zero();
    for (const c of INVITE_CLICK_CHANNELS) out[c] = n(src[c]);
    return out;
  };
  return {
    available: o.available !== false,
    version: n(o.version) || 1,
    versions: Array.isArray(o.versions) ? [...new Set(o.versions.map(n).filter(Boolean))].sort((a, b) => b - a) : [],
    reached: n(o.reached),
    delivered: rec(o.delivered),
    read_in_app: n(o.read_in_app),
    clicked: rec(o.clicked),
    clickers: n(o.clickers),
    test_clicks: n(o.test_clicks),
    first_click_at: typeof o.first_click_at === 'string' ? o.first_click_at : null,
    last_click_at: typeof o.last_click_at === 'string' ? o.last_click_at : null,
  };
}

/** Whole-number percentage, or null when there is nobody to divide by. */
export function rate(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return Math.round((Math.min(part, whole) / whole) * 100);
}
