import { useQuery } from '@tanstack/react-query';
import { fetchSocialConfig, type SocialProvider, type SocialPurpose } from '@/lib/socialSignin';

/** Providers offered for returning-user sign-in or new-account sign-up; empty while loading. */
export function useSocialSignin(purpose: SocialPurpose): SocialProvider[] {
  const { data } = useQuery({ queryKey: ['social-signin-config'], queryFn: fetchSocialConfig, staleTime: 60_000 });
  return data?.[purpose] ?? [];
}
