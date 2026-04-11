import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'] as const;

export function useSessionTimeout() {
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const warningRef = useRef<ReturnType<typeof setTimeout>>();

  const resetTimer = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearTimeout(warningRef.current);

    warningRef.current = setTimeout(() => {
      toast.warning(
        'Your session will expire in 5 minutes due to inactivity. Move your mouse or press any key to stay logged in.',
        { duration: 300_000, id: 'session-warning' }
      );
    }, TIMEOUT_MS - WARNING_MS);

    timeoutRef.current = setTimeout(async () => {
      toast.dismiss('session-warning');
      await supabase.auth.signOut();
      toast.error('You have been logged out due to inactivity.');
      navigate('/login');
    }, TIMEOUT_MS);
  }, [navigate]);

  useEffect(() => {
    resetTimer();
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    return () => {
      clearTimeout(timeoutRef.current);
      clearTimeout(warningRef.current);
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [resetTimer]);
}
