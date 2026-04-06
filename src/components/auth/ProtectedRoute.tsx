import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  requiredRole?: 'client' | 'consultant' | 'admin';
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [roleOk, setRoleOk] = useState<boolean | undefined>(undefined);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const location = useLocation();

  // Listen for auth state changes — session comes from Supabase (server-validated JWT)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Validate role from the database — never trust frontend state
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

  // Check onboarding status once role is confirmed
  useEffect(() => {
    if (!session || !roleOk || !requiredRole || requiredRole === 'admin') {
      setOnboardingChecked(true);
      return;
    }
    const checkOnboarding = async () => {
      if (requiredRole === 'client') {
        const { data } = await supabase
          .from('client_profiles')
          .select('onboarding_completed')
          .eq('user_id', session.user.id)
          .maybeSingle();
        setNeedsOnboarding(!data || !data.onboarding_completed);
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
  }, [session, roleOk, requiredRole]);

  // Loading state
  if (session === undefined || (session && requiredRole && roleOk === undefined) || (roleOk && !onboardingChecked)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No session — redirect to login
  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Role mismatch — redirect to home
  if (requiredRole && !roleOk) {
    return <Navigate to="/" replace />;
  }

  // Redirect to onboarding if not completed (skip if already on onboarding page)
  if (needsOnboarding && !location.pathname.endsWith('/onboarding')) {
    const onboardingPath = requiredRole === 'client' ? '/client/onboarding' : '/consultant/onboarding';
    return <Navigate to={onboardingPath} replace />;
  }

  return <>{children}</>;
}
