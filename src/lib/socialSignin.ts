import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { isFirstTimeOAuthUser } from '@/lib/oauthReturn';

/**
 * Social sign-in rules.
 * - `social_login_providers` (JSON array, default ["google"]): providers offered on /login to returning users.
 * - `social_signup_enabled` (boolean, default off): offers those providers on screens that create new accounts.
 * Only Google, Apple and Microsoft are ever offered; any other provider (e.g. Lovable) is never started.
 */
export const SOCIAL_PROVIDERS = ['google', 'apple', 'microsoft'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export type SocialPurpose = 'login' | 'signup';

export const SOCIAL_SIGNUP_KEY = 'social_signup_enabled';
export const SOCIAL_LOGIN_PROVIDERS_KEY = 'social_login_providers';
export const DEFAULT_LOGIN_PROVIDERS: SocialProvider[] = ['google'];

export interface SocialConfig { login: SocialProvider[]; signup: SocialProvider[] }

const truthy = (v: unknown) => v === true || v === 'true';

function parseProviders(v: unknown): SocialProvider[] | null {
  let list = v;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { return null; } }
  if (!Array.isArray(list)) return null;
  return SOCIAL_PROVIDERS.filter((p) => list.includes(p));
}

/** Rules from platform_settings rows; a missing/unreadable login list means the default ["google"]. */
export function socialConfigFromRows(rows: { key: string; value: unknown }[] | null | undefined): SocialConfig {
  const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const login = parseProviders(map.get(SOCIAL_LOGIN_PROVIDERS_KEY)) ?? DEFAULT_LOGIN_PROVIDERS;
  const signup = truthy(map.get(SOCIAL_SIGNUP_KEY)) ? login : [];
  return { login, signup };
}

export async function fetchSocialConfig(): Promise<SocialConfig> {
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', [SOCIAL_SIGNUP_KEY, SOCIAL_LOGIN_PROVIDERS_KEY]);
    return socialConfigFromRows(error ? [] : (data as { key: string; value: unknown }[]));
  } catch {
    return socialConfigFromRows([]);
  }
}

/** Marks that the user deliberately started a social sign-up (kept 10 minutes across the redirect). */
const SIGNUP_INTENT_KEY = 'social_signup_intent';
const SIGNUP_INTENT_TTL_MS = 10 * 60 * 1000;
export function storeSocialSignupIntent(now = Date.now()) {
  try { localStorage.setItem(SIGNUP_INTENT_KEY, String(now + SIGNUP_INTENT_TTL_MS)); } catch { /* storage blocked */ }
}
export function readSocialSignupIntent(now = Date.now()): boolean {
  try {
    const exp = Number(localStorage.getItem(SIGNUP_INTENT_KEY));
    if (exp > now) return true;
    localStorage.removeItem(SIGNUP_INTENT_KEY);
  } catch { /* storage blocked */ }
  return false;
}
export function clearSocialSignupIntent() {
  try { localStorage.removeItem(SIGNUP_INTENT_KEY); } catch { /* storage blocked */ }
}

export const NO_SOCIAL_ACCOUNT_MESSAGE = 'No account found for this Google profile. Please sign up with e-mail first.';
export const SOCIAL_DISABLED_MESSAGE = 'This sign-in option is not available. Please use your e-mail and password.';

/** A brand-new social account that did not come from an allowed social sign-up must be refused. */
export function shouldRefuseNewSocialUser(user: Parameters<typeof isFirstTimeOAuthUser>[0], now = Date.now()): boolean {
  return isFirstTimeOAuthUser(user, now) && !readSocialSignupIntent(now);
}

/**
 * The only way the app starts a social sign-in. Re-checks the rules right before starting and refuses
 * (no redirect to the provider) when the provider is not allowed for this purpose.
 */
export async function startSocialSignIn(provider: string, opts: { redirect_uri: string }, purpose: SocialPurpose = 'login') {
  const config = await fetchSocialConfig();
  if (!(config[purpose] as string[]).includes(provider)) {
    return { error: new Error(SOCIAL_DISABLED_MESSAGE), redirected: false as const, refused: true as const };
  }
  if (purpose === 'signup') storeSocialSignupIntent();
  else clearSocialSignupIntent();
  const result = await lovable.auth.signInWithOAuth(provider as SocialProvider, opts);
  return { ...result, refused: false as const };
}
