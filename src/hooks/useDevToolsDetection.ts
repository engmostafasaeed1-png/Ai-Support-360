import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useDevToolsDetection(): boolean {
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if current user has admin/superadmin role
  useEffect(() => {
    const checkRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin');
      if (data && data.length > 0) {
        setIsAdmin(true);
      }
    };
    checkRole();
  }, []);

  useEffect(() => {
    if (isAdmin) return; // Skip detection for admins

    const threshold = 160;

    const check = () => {
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;
      setDevToolsOpen(widthDiff || heightDiff);
    };

    const interval = setInterval(check, 1500);
    window.addEventListener('resize', check);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', check);
    };
  }, [isAdmin]);

  // Admins always get false (DevTools allowed)
  return isAdmin ? false : devToolsOpen;
}
