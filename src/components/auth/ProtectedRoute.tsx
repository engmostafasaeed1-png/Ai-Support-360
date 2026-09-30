import { useEffect, useState, useCallback } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { getClientOnboardingState } from '@/lib/clientOnboarding';

interface Props {
  children: React.ReactNode;
  requiredRole?: 'client' | 'consultant' | 'admin' | 'super-admin';
}

interface AuthState {
  status: 'loading' | 'ready';
  session: Session | null;
  roleOk: boolean;
  hasTenant: boolean;
  needsOnboarding: boolean;
}

// Route keys use hyphens; the database enum uses underscores.
const DB_ROLE: Record<NonNullable<Props['requiredRole']>, string> = {
  client: 'client',
  consultant: 'consultant',
  admin: 'admin',
  'super-admin': 'super_admin',
};

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    session: null,
    roleOk: false,
    hasTenant: true,
    needsOnboarding: false,
  });
  const location = useLocation();

  const checkAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      setState({ status: 'ready', session: null, roleOk: false, hasTenant: true, needsOnboarding: false });
      return;
    }

    if (!requiredRole) {
      setState({ status: 'ready', session, roleOk: true, hasTenant: true, needsOnboarding: false });
      return;
    }

    // Run all checks in parallel
    const [roleResult, tenantResult, onboardingResult] = await Promise.all([
      // Role check - maps the route key to the database enum value
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('role', DB_ROLE[requiredRole] as any)
        .maybeSingle(),

      // Tenant check (only for clients)
      requiredRole === 'client'
        ? supabase.from('tenant_members').select('tenant_id').eq('user_id', session.user.id).limit(1)
        : Promise.resolve({ data: [{ tenant_id: 'dummy' }] }),

      // Onboarding check
      requiredRole === 'client'
        ? supabase.from('client_profiles')
            .select('onboarding_completed, company_name, company_size, industry, sap_modules, phone')
            .eq('user_id', session.user.id)
            .maybeSingle()
        : requiredRole === 'consultant'
        ? supabase.from('profiles')
            .select('onboarding_completed')
            .eq('user_id', session.user.id)
            .maybeSingle()
        : Promise.resolve({ data: { onboarding_completed: true } }),
    ]);

    const roleOk = !!roleResult.data;
    const hasTenant = !!(tenantResult.data && (tenantResult.data as any[]).length > 0);

    let needsOnboarding = false;
    if (roleOk && hasTenant) {
      if (requiredRole === 'client') {
        needsOnboarding = !getClientOnboardingState(onboardingResult.data).completed;
      } else if (requiredRole === 'consultant') {
        needsOnboarding = !onboardingResult.data || !(onboardingResult.data as any).onboarding_completed;
      }
    }

    setState({ status: 'ready', session, roleOk, hasTenant, needsOnboarding });
  }, [requiredRole]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth, location.pathname]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s) {
        setState({ status: 'ready', session: null, roleOk: false, hasTenant: true, needsOnboarding: false });
      } else {
        void checkAuth();
      }
    });
    return () => subscription.unsubscribe();
  }, [checkAuth]);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state.session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requiredRole && !state.roleOk) {
    return <Navigate to="/" replace />;
  }

  const isOnClientSetupPage = location.pathname === '/client/companies' || location.pathname === '/client/onboarding';
  const isOnConsultantOnboardingPage = location.pathname === '/consultant/onboarding';

  if (requiredRole === 'client' && !state.hasTenant && !isOnClientSetupPage) {
    return <Navigate to="/client/companies" replace />;
  }

  if (state.needsOnboarding && !isOnClientSetupPage && !isOnConsultantOnboardingPage) {
    const onboardingPath = requiredRole === 'client' ? '/client/onboarding' : '/consultant/onboarding';
    return <Navigate to={onboardingPath} replace />;
  }

  return <>{children}</>;
}
