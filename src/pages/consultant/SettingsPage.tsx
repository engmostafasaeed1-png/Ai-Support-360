import { useEffect, useState } from 'react';
import AssignmentPolicyNote from '@/components/consultant/AssignmentPolicyNote';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import TelegramAlertsCard from '@/components/consultant/TelegramAlertsCard';
import PushAlertsCard from '@/components/consultant/PushAlertsCard';
import NotificationPauseCard from '@/components/notifications/NotificationPauseCard';
import NameFormatPicker from '@/components/consultant/NameFormatPicker';

type PrefKey = 'new_case_alerts' | 'profile_visible' | 'show_availability';
type Prefs = Record<PrefKey, boolean>;

export default function ConsultantSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ new_case_alerts: true, profile_visible: true, show_availability: true });
  const [saving, setSaving] = useState<PrefKey | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (alive) setLoading(false); return; }
      const { data } = await supabase
        .from('consultants')
        .select('id, new_case_alerts, profile_visible, show_availability')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!alive) return;
      if (data) {
        setConsultantId(data.id);
        setPrefs({ new_case_alerts: data.new_case_alerts, profile_visible: data.profile_visible, show_availability: data.show_availability });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const change = async (key: PrefKey, value: boolean) => {
    if (!consultantId) return;
    const before = prefs[key];
    setPrefs(p => ({ ...p, [key]: value }));
    setSaving(key);
    const patch: Partial<Prefs> = {};
    patch[key] = value;
    const { error } = await supabase.from('consultants').update(patch).eq('id', consultantId);
    setSaving(null);
    if (error) {
      setPrefs(p => ({ ...p, [key]: before }));
      toast.error('Your setting could not be saved', { description: error.message });
      return;
    }
    toast.success('Saved');
    queryClient.invalidateQueries({ queryKey: ['realtime-consultants'] });
    queryClient.invalidateQueries({ queryKey: ['consultant-profile'] });
  };

  const row = (key: PrefKey, label: string, hint: string) => (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={`pref-${key}`} className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={`pref-${key}`} checked={prefs[key]} disabled={saving !== null} onCheckedChange={(v) => change(key, v)} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.settings', 'Settings')}</h1>
        <p className="text-muted-foreground text-sm">Manage your account preferences</p>
      </div>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : !consultantId ? (
        <p className="text-sm text-muted-foreground">Your consultant profile is not set up yet. These settings are available after you finish your profile.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Bell className="w-4 h-4" /> Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {row('new_case_alerts', 'New case alerts', 'Get a notification when a client sends you a match request, and the alarm when a client opens a critical request for your SAP area. When off, you will not be notified of new requests and you will not get critical alarms.')}
              <AssignmentPolicyNote />
            </CardContent>
          </Card>
          <Card className="border-border/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" /> Privacy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {row('profile_visible', 'Profile visible to clients', 'When off, clients who do not work with you yet do not find your profile in the consultants list or on the map. Clients you already work with still see it.')}
              {row('show_availability', 'Show availability status', 'When off, clients see you as Offline and do not see your weekly hours.')}
              <NameFormatPicker consultantId={consultantId} />
            </CardContent>
          </Card>
          <NotificationPauseCard />
          <TelegramAlertsCard />
          <PushAlertsCard />
        </div>
      )}
    </div>
  );
}
