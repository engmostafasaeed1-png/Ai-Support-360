import { useEffect, useState, useCallback, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { getClientOnboardingState } from '@/lib/clientOnboarding';
import { getSessionWithRetry } from '@/lib/authSession';
import TwoFactorGate from '@/components/auth/TwoFactorGate';

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
  // Each check gets a number; only the newest may set the state, so a slower older check (started with a session)
  // can never overwrite a later sign-out and render the page without a session.
  const checkSeq = useRef(0);

  const checkAuth = useCallback(async () => {
    const seq = ++checkSeq.current;
    const session = await getSessionWithRetry();
    if (seq !== checkSeq.current) return;

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

      // Onboarding check (clients only). Consultants are never sent back to their profile: the setup guide, banners
      // and the server-side bid/assignment gates handle an incomplete profile, so every page stays reachable.
      requiredRole === 'client'
        ? supabase.from('client_profiles')
            .select('onboarding_completed, company_name, company_size, industry, sap_modules, phone')
            .eq('user_id', session.user.id)
            .maybeSingle()
        : Promise.resolve({ data: { onboarding_completed: true } }),
    ]);
    if (seq !== checkSeq.current) return;

    const roleOk = !!roleResult.data;
    const hasTenant = !!(tenantResult.data && (tenantResult.data as any[]).length > 0);

    let needsOnboarding = false;
    if (roleOk && hasTenant) {
      if (requiredRole === 'client') {
        needsOnboarding = !getClientOnboardingState(onboardingResult.data).completed;
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
        checkSeq.current++; // cancels any check still running
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

  if (requiredRole === 'client' && !state.hasTenant && !isOnClientSetupPage) {
    return <Navigate to="/client/companies" replace />;
  }

  if (requiredRole === 'client' && state.needsOnboarding && !isOnClientSetupPage) {
    return <Navigate to="/client/onboarding" replace />;
  }

  return <TwoFactorGate>{children}</TwoFactorGate>;
}
