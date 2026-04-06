import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';

export function useReferralCode() {
  const { isGuest } = useGuestMode();
  return useQuery({
    queryKey: ['my-referral-code'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('user_id', user.id)
        .maybeSingle();
      return data?.referral_code || null;
    },
    enabled: !isGuest,
    placeholderData: isGuest ? 'DEMO1234' : undefined,
  });
}

export function useMyReferrals() {
  const { isGuest } = useGuestMode();
  return useQuery({
    queryKey: ['my-referrals'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('referrals')
        .select('*')
        .eq('referrer_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !isGuest,
    placeholderData: isGuest ? [
      { id: 'r1', referral_code: 'DEMO1234', referred_email: 'john@company.com', status: 'rewarded', source: 'email', created_at: '2026-04-01T10:00:00Z', referred_user_id: 'u1', referrer_id: 'me', updated_at: '2026-04-01T10:00:00Z' },
      { id: 'r2', referral_code: 'DEMO1234', referred_email: 'sara@corp.com', status: 'registered', source: 'whatsapp', created_at: '2026-04-03T14:00:00Z', referred_user_id: 'u2', referrer_id: 'me', updated_at: '2026-04-03T14:00:00Z' },
      { id: 'r3', referral_code: 'DEMO1234', referred_email: null, status: 'pending', source: 'link', created_at: '2026-04-05T09:00:00Z', referred_user_id: '', referrer_id: 'me', updated_at: '2026-04-05T09:00:00Z' },
    ] as any : undefined,
  });
}

export function useMyRewards() {
  const { isGuest } = useGuestMode();
  return useQuery({
    queryKey: ['my-rewards'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('referral_rewards')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !isGuest,
    placeholderData: isGuest ? [
      { id: 'rw1', reward_type: 'credit', amount: 25, currency: 'USD', status: 'applied', description: 'Referral bonus — you invited a new user', created_at: '2026-04-01T10:00:00Z', applied_at: '2026-04-01T10:00:00Z', referral_id: 'r1', user_id: 'me' },
      { id: 'rw2', reward_type: 'credit', amount: 25, currency: 'USD', status: 'pending', description: 'Referral bonus — you invited a new user', created_at: '2026-04-03T14:00:00Z', applied_at: '', referral_id: 'r2', user_id: 'me' },
    ] as any : undefined,
  });
}

export function getReferralLink(code: string) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/signup?ref=${code}`;
}
