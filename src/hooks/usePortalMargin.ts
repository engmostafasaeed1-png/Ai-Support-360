import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function usePortalMargin() {
  const [margin, setMargin] = useState(5);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'portal_margin')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value != null) {
          const v = Number(data.value);
          if (!isNaN(v) && v >= 0 && v <= 20) setMargin(v);
        }
      });
  }, []);

  return margin;
}
