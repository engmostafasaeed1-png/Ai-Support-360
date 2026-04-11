import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, X } from 'lucide-react';

export default function SecurityAlert() {
  const [alerts, setAlerts] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const checkSecurity = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const detectedAlerts: string[] = [];

      const storedAgent = localStorage.getItem('qurtuba_last_agent');
      const currentAgent = navigator.userAgent;
      if (storedAgent && storedAgent !== currentAgent) {
        detectedAlerts.push('New device or browser detected. If this was not you, change your password immediately.');
      }
      localStorage.setItem('qurtuba_last_agent', currentAgent);

      const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null;
      if (lastSignIn) {
        const daysSinceLogin = (Date.now() - lastSignIn.getTime()) / 86400000;
        if (daysSinceLogin > 30) {
          detectedAlerts.push('You have not logged in for over 30 days. Review your account activity.');
        }
      }

      setAlerts(detectedAlerts);
    };
    checkSecurity();
  }, []);

  if (!alerts.length || dismissed) return null;

  return (
    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-destructive">Security Notice</p>
        {alerts.map((a, i) => (
          <p key={i} className="text-sm text-muted-foreground mt-1">{a}</p>
        ))}
      </div>
      <button onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground" type="button">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
