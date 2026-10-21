import { useQuery } from '@tanstack/react-query';
import { fetchSocialProviders, type SocialProvider } from '@/lib/socialSignin';

/** Providers offered on sign-in screens; empty while loading or when social sign-in is off. */
export function useSocialSignin(): SocialProvider[] {
  const { data } = useQuery({ queryKey: ['social-signin-providers'], queryFn: fetchSocialProviders, staleTime: 60_000 });
  return data ?? [];
}
