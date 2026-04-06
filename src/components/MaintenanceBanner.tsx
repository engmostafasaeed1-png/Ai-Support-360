import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function MaintenanceBanner() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('maintenance_dismissed') === 'true');
  const { t } = useTranslation();

  useEffect(() => {
    if (dismissed) return;
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'maintenance_mode')
      .maybeSingle()
      .then(({ data }) => {
        if (data && (data.value === true || data.value === 'true')) {
          setVisible(true);
        }
      });
  }, [dismissed]);

  if (!visible || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 text-center text-sm font-medium px-4 py-2.5 flex items-center justify-center gap-2 shadow-md animate-fade-in">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{t('maintenance.banner', 'The platform is currently undergoing scheduled maintenance. Some features may be temporarily unavailable.')}</span>
      <button
        onClick={() => {
          setDismissed(true);
          sessionStorage.setItem('maintenance_dismissed', 'true');
        }}
        className="absolute end-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-amber-600/20 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
