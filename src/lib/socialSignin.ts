import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';

/**
 * Social sign-in switch. Fails closed: when the settings cannot be read (no row, no read permission,
 * network error) no social provider is offered and the OAuth start refuses.
 * The main switch `social_signin_enabled` gates everything; per-provider switches only matter when it is on.
 */
export const SOCIAL_PROVIDERS = ['google', 'apple', 'microsoft'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const SOCIAL_MAIN_KEY = 'social_signin_enabled';
export const socialProviderKey = (p: SocialProvider) => `social_signin_${p}`;
export const SOCIAL_SETTING_KEYS = [SOCIAL_MAIN_KEY, ...SOCIAL_PROVIDERS.map(socialProviderKey)];

const truthy = (v: unknown) => v === true || v === 'true';

/** Enabled providers from platform_settings rows; [] unless the main switch is explicitly on. */
export function socialProvidersFromRows(rows: { key: string; value: unknown }[] | null | undefined): SocialProvider[] {
  const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
  if (!truthy(map.get(SOCIAL_MAIN_KEY))) return [];
  return SOCIAL_PROVIDERS.filter((p) => truthy(map.get(socialProviderKey(p))));
}

export async function fetchSocialProviders(): Promise<SocialProvider[]> {
  try {
    const { data, error } = await supabase.from('platform_settings').select('key, value').in('key', SOCIAL_SETTING_KEYS);
    if (error) return [];
    return socialProvidersFromRows(data as { key: string; value: unknown }[]);
  } catch {
    return [];
  }
}

export const SOCIAL_DISABLED_MESSAGE = 'Social sign-in is not available. Please use your e-mail and password.';

/**
 * The only way the app starts a social sign-in. Re-checks the switches right before starting and refuses
 * (no redirect to the provider) when the provider is off. Returning sign-ins are not affected.
 */
export async function startSocialSignIn(provider: string, opts: { redirect_uri: string }) {
  const enabled = await fetchSocialProviders();
  if (!(enabled as string[]).includes(provider)) {
    return { error: new Error(SOCIAL_DISABLED_MESSAGE), redirected: false as const, refused: true as const };
  }
  const result = await lovable.auth.signInWithOAuth(provider as SocialProvider, opts);
  return { ...result, refused: false as const };
}
