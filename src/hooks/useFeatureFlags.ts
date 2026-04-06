import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  category: string;
}

const DEFAULT_FLAGS: FeatureFlag[] = [
  { key: 'ai_ticket_triage', label: 'AI Ticket Triage', description: 'Automatic AI categorization for new tickets', enabled: true, category: 'AI' },
  { key: 'ai_chatbot', label: 'AI Chatbot', description: 'Floating AI assistant for all users', enabled: true, category: 'AI' },
  { key: 'ai_consultant_match', label: 'AI Consultant Matching', description: 'AI-powered consultant ranking for tickets', enabled: true, category: 'AI' },
  { key: 'remote_access', label: 'Remote Access (Guacamole)', description: 'Remote desktop access for SAP environments', enabled: true, category: 'Features' },
  { key: 'video_sessions', label: 'Video Sessions', description: 'Video call sessions between clients and consultants', enabled: false, category: 'Features' },
  { key: 'credly_badges', label: 'Credly Badge Integration', description: 'Display Credly badges on consultant profiles', enabled: true, category: 'Integrations' },
  { key: 'email_notifications', label: 'Email Notifications', description: 'Send email notifications for important events', enabled: true, category: 'Notifications' },
  { key: 'push_notifications', label: 'Push Notifications', description: 'Browser push notifications', enabled: false, category: 'Notifications' },
  { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Show maintenance banner to all users', enabled: false, category: 'System' },
  { key: 'open_registration', label: 'Open Registration', description: 'Allow new user signups', enabled: true, category: 'System' },
  { key: 'guest_mode', label: 'Guest Mode', description: 'Allow exploring the platform without login', enabled: true, category: 'System' },
];

const SETTING_KEY = 'feature_flags';

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', SETTING_KEY)
        .maybeSingle();

      if (data?.value) {
        const saved = data.value as Record<string, boolean>;
        setFlags(DEFAULT_FLAGS.map(f => ({
          ...f,
          enabled: saved[f.key] !== undefined ? saved[f.key] : f.enabled,
        })));
      }
      setLoading(false);
    };
    load();
  }, []);

  const toggleFlag = useCallback(async (key: string) => {
    setFlags(prev => {
      const next = prev.map(f => f.key === key ? { ...f, enabled: !f.enabled } : f);
      // Persist asynchronously
      const payload: Record<string, boolean> = {};
      next.forEach(f => { payload[f.key] = f.enabled; });

      supabase
        .from('platform_settings')
        .upsert({ key: SETTING_KEY, value: payload }, { onConflict: 'key' })
        .then(({ error }) => {
          if (error) toast.error('Failed to save feature flag');
        });

      return next;
    });
  }, []);

  return { flags, loading, toggleFlag };
}
