import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wrench } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getSessionWithRetry } from '@/lib/authSession';
import { Button } from '@/components/ui/button';

/** Pages that stay open in maintenance mode: administrators must be able to sign in, and the legal pages and the unsubscribe link must always work. */
const OPEN_PATHS = new Set([
  '/login',
  '/forgot-password',
  '/reset-password',
  '/unsubscribe',
  '/privacy-policy',
  '/terms-and-conditions',
  '/refund-policy',
  '/subscription-and-cancellation',
  '/service-delivery',
  '/cookie-policy',
  '/acceptable-use',
]);

/**
 * Maintenance mode (Platform Settings): everyone except administrators sees a maintenance page.
 * This is a screen gate; the platform_settings row maintenance_mode is the single switch and is read every minute.
 */
export default function MaintenanceGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();

  const { data: maintenance } = useQuery({
    queryKey: ['maintenance-mode'],
    queryFn: async (): Promise<boolean> => {
      const { data } = await supabase.from('platform_settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
      return data?.value === true || data?.value === 'true';
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const open = OPEN_PATHS.has(pathname) || pathname.startsWith('/.lovable/');
  const gated = maintenance === true && !open;

  const { data: who, isLoading: whoLoading } = useQuery({
    queryKey: ['maintenance-gate-who'],
    enabled: gated,
    queryFn: async (): Promise<{ admin: boolean }> => {
      const session = await getSessionWithRetry();
      if (!session?.user) return { admin: false };
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .in('role', ['admin', 'super_admin'] as never);
      return { admin: !!data && data.length > 0 };
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance-gate-who'] });
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  if (!gated) return <>{children}</>;

  if (whoLoading) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (who?.admin) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warning/10">
        <Wrench aria-hidden="true" className="h-8 w-8 text-warning" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-bold text-foreground">{t('maintenance.page_title', "We'll be back soon")}</h1>
        <p className="text-sm text-muted-foreground">
          {t('maintenance.page_body', 'AI Support 360 is under scheduled maintenance. Please try again in a little while.')}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/login">{t('maintenance.admin_sign_in', 'Administrator sign-in')}</Link>
      </Button>
    </div>
  );
}
