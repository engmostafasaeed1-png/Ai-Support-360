import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/** /notifications (used in message footers): opens the signed-in person's own notification centre, keeping the query. */
export default function NotificationsRedirect() {
  const navigate = useNavigate();
  const { search } = useLocation();
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      if (!session?.user) { navigate('/login', { replace: true, state: { from: `/notifications${search}` } }); return; }
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id);
      if (!alive) return;
      const roles = (data ?? []).map((r) => String(r.role));
      const portal = roles.includes('super_admin') || roles.includes('admin') ? 'admin' : roles.includes('consultant') ? 'consultant' : 'client';
      navigate(`/${portal}/notifications${search}`, { replace: true });
    })();
    return () => { alive = false; };
  }, [navigate, search]);
  return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
}
