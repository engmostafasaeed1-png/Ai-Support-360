import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Save, Globe, Bell, Clock, MessageSquare, Cpu, ChevronRight } from 'lucide-react';
import AvatarUpload from '@/components/profile/AvatarUpload';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useClientProfileData, useUpdateClientProfile } from '@/hooks/useClientProfile';
import { useGuestMode } from '@/contexts/GuestModeContext';

const guestProfile = {
  displayName: 'Guest User',
  email: 'guest@qurtuba.demo',
  avatarUrl: null,
  initials: 'GU',
};

const timezones = [
  'Asia/Riyadh', 'Asia/Dubai', 'Asia/Bahrain', 'Asia/Kuwait',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Singapore', 'Asia/Tokyo', 'Asia/Kolkata',
  'Africa/Cairo', 'Africa/Johannesburg',
];

const communicationOptions = [
  { value: 'email', labelKey: 'client_onboarding.comm_email' },
  { value: 'phone', labelKey: 'client_onboarding.comm_phone' },
  { value: 'whatsapp', labelKey: 'client_onboarding.comm_whatsapp' },
  { value: 'in_app', labelKey: 'client_onboarding.comm_in_app' },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const { profile: realProfile, loading: profileLoading } = useUserProfile();
  const { data: clientProfile } = useClientProfileData();
  const updateClientProfile = useUpdateClientProfile();
  const profile = isGuest ? guestProfile : realProfile;

  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [timezone, setTimezone] = useState('Asia/Riyadh');
  const [communicationPreference, setCommunicationPreference] = useState('email');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isGuest && !loaded) {
      setDisplayName(guestProfile.displayName);
      setPhone('+966 50 000 0000');
      setLoaded(true);
      return;
    }
    if (profile && !loaded) {
      setDisplayName(profile.displayName || '');
      const fetchPhone = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
          .from('profiles')
          .select('phone, preferred_language')
          .eq('user_id', session.user.id)
          .maybeSingle();
        setPhone(data?.phone || '');
        setPreferredLanguage(data?.preferred_language || 'en');
        setLoaded(true);
      };
      fetchPhone();
    }
  }, [profile, loaded, isGuest]);

  useEffect(() => {
    if (clientProfile) {
      setTimezone(clientProfile.timezone || 'Asia/Riyadh');
      setCommunicationPreference((clientProfile as any).communication_preference || 'email');
    }
  }, [clientProfile]);

  const handleSave = async () => {
    if (isGuest) {
      toast.success(t('guest.demo_action', 'Changes saved (demo mode)'));
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error('Please log in'); return; }

      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          phone: phone.trim() || null,
          preferred_language: preferredLanguage,
        })
        .eq('user_id', session.user.id);

      if (error) throw error;

      // Update client profile preferences
      updateClientProfile.mutate({
        timezone,
        communication_preference: communicationPreference,
        preferred_language: preferredLanguage,
        phone: phone.trim() || null,
      } as any);

      toast.success(t('settings_page.saved', 'Profile updated successfully!'));
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (!isGuest && profileLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('sidebar.settings')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('settings_page.subtitle', 'Manage your profile and preferences')}</p>
      </div>

      {/* Avatar */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">{t('settings_page.profile_picture', 'Profile Picture')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <AvatarUpload />
          <div className="text-sm text-muted-foreground">
            <p>{t('settings_page.upload_avatar', 'Click to upload a new avatar')}</p>
            <p className="text-xs mt-1">{t('settings_page.upload_hint', 'JPG, PNG or GIF. Max 5MB.')}</p>
          </div>
        </CardContent>
      </Card>

      {/* Personal Info */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">{t('settings_page.personal_info', 'Personal Information')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('settings_page.email', 'Email')}</Label>
            <Input id="email" value={profile?.email || ''} disabled className="bg-muted/50" />
            <p className="text-xs text-muted-foreground">{t('settings_page.email_hint', 'Email cannot be changed')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">{t('settings_page.display_name', 'Display Name')}</Label>
            <Input id="displayName" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{t('client_onboarding.phone')}</Label>
            <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+966 5XX XXX XXXX" type="tel" />
          </div>
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            {t('settings_page.preferences', 'Preferences')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('client_onboarding.preferred_language')}</Label>
              <Select value={preferredLanguage} onValueChange={setPreferredLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {t('settings_page.timezone', 'Timezone')}
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {timezones.map(tz => (
                    <SelectItem key={tz} value={tz}>{tz.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              {t('client_onboarding.communication_preference')}
            </Label>
            <Select value={communicationPreference} onValueChange={setCommunicationPreference}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {communicationOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Quick Links */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">{t('settings_page.quick_links', 'Quick Links')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link to="/client/company" className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/60 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-sm font-medium text-foreground">{t('sidebar.company_profile')}</span>
                <p className="text-xs text-muted-foreground">{t('settings_page.edit_company_desc', 'Edit company details, logo, and contacts')}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Link>
          <Link to="/client/onboarding" className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/60 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Cpu className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-sm font-medium text-foreground">{t('settings_page.edit_sap', 'SAP Modules & Setup')}</span>
                <p className="text-xs text-muted-foreground">{t('settings_page.edit_sap_desc', 'Update your SAP modules and landscape')}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Link>
          <Link to="/client/companies" className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/60 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-sm font-medium text-foreground">{t('settings_page.switch_company', 'Switch Company')}</span>
                <p className="text-xs text-muted-foreground">{t('settings_page.switch_company_desc', 'Manage or switch between companies')}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Link>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2 px-6">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('settings_page.save', 'Save Changes')}
        </Button>
      </div>
    </div>
  );
}
