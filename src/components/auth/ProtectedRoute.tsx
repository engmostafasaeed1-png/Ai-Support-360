import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { getClientOnboardingState } from '@/lib/clientOnboarding';

interface Props {
  children: React.ReactNode;
  requiredRole?: 'client' | 'consultant' | 'admin';
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [roleOk, setRoleOk] = useState<boolean | undefined>(undefined);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [tenantChecked, setTenantChecked] = useState(false);
  const [hasTenant, setHasTenant] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !requiredRole) {
      setRoleOk(requiredRole ? undefined : true);
      return;
    }
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .eq('role', requiredRole)
      .maybeSingle()
      .then(({ data }) => {
        setRoleOk(!!data);
      });
  }, [session, requiredRole]);

  useEffect(() => {
    if (!session || !roleOk || requiredRole !== 'client') {
      setTenantChecked(true);
      setHasTenant(true);
      return;
    }
    supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', session.user.id)
      .limit(1)
      .then(({ data }) => {
        setHasTenant(!!data && data.length > 0);
        setTenantChecked(true);
      });
  }, [session, roleOk, requiredRole]);

  useEffect(() => {
    if (!session || !roleOk || !requiredRole || requiredRole === 'admin' || !tenantChecked || !hasTenant) {
      setOnboardingChecked(true);
      return;
    }
    const checkOnboarding = async () => {
      if (requiredRole === 'client') {
        const { data } = await supabase
          .from('client_profiles')
          .select('onboarding_completed, company_name, company_size, industry, sap_modules, phone')
          .eq('user_id', session.user.id)
          .maybeSingle();

        setNeedsOnboarding(!getClientOnboardingState(data).completed);
      } else {
        const { data } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('user_id', session.user.id)
          .maybeSingle();
        setNeedsOnboarding(!data || !data.onboarding_completed);
      }
      setOnboardingChecked(true);
    };
    checkOnboarding();
  }, [session, roleOk, requiredRole, tenantChecked, hasTenant]);

  if (
    session === undefined ||
    (session && requiredRole && roleOk === undefined) ||
    (roleOk && !tenantChecked) ||
    (roleOk && tenantChecked && hasTenant && !onboardingChecked)
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requiredRole && !roleOk) {
    return <Navigate to="/" replace />;
  }

  const isOnClientSetupPage = location.pathname === '/client/companies' || location.pathname === '/client/onboarding';
  const isOnConsultantOnboardingPage = location.pathname === '/consultant/onboarding';

  if (requiredRole === 'client' && !hasTenant && !isOnClientSetupPage) {
    return <Navigate to="/client/companies" replace />;
  }

  if (needsOnboarding && !isOnClientSetupPage && !isOnConsultantOnboardingPage) {
    const onboardingPath = requiredRole === 'client' ? '/client/onboarding' : '/consultant/onboarding';
    return <Navigate to={onboardingPath} replace />;
  }

  return <>{children}</>;
}
