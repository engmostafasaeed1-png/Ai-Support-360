import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/lib/auditLog';

export function useLogout() {
  const navigate = useNavigate();

  const logout = async () => {
    await logAudit('logout');
    await supabase.auth.signOut();
    navigate('/');
    toast.success('Signed out successfully');
  };

  return logout;
}
