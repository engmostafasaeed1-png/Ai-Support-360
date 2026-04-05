import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { useGuestMode } from '@/contexts/GuestModeContext';

interface Props {
  children: React.ReactNode;
  requiredRole?: 'client' | 'consultant' | 'admin';
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { isGuest, guestRole } = useGuestMode();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [roleOk, setRoleOk] = useState<boolean | undefined>(undefined);
  const location = useLocation();

  // Guest mode bypass
  if (isGuest && (!requiredRole || guestRole === requiredRole)) {
    return <>{children}</>;
  }

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

  if (session === undefined || (session && requiredRole && roleOk === undefined)) {
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

  return <>{children}</>;
}
