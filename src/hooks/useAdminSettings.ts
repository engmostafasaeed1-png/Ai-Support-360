import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type SettingsMap = Record<string, boolean>;

const SETTING_KEYS = [
  'maintenance_mode',
  'open_registration',
  'email_notifications',
  'admin_alerts',
  'require_2fa',
  'audit_logging',
] as const;

export function useAdminSettings() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('key, value');
    if (error) {
      toast({ title: 'Error loading settings', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const map: SettingsMap = {};
    data?.forEach((row: any) => {
      map[row.key] = row.value === true || row.value === 'true';
    });
    setSettings(map);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const updateSetting = useCallback(async (key: string, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    const { error } = await supabase
      .from('platform_settings')
      .update({ value: value as any })
      .eq('key', key);
    if (error) {
      toast({ title: 'Error saving setting', description: error.message, variant: 'destructive' });
      fetchSettings(); // revert
    }
  }, [toast, fetchSettings]);

  return { settings, loading, updateSetting, SETTING_KEYS };
}
