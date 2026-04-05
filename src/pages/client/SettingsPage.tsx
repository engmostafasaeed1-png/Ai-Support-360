import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import AvatarUpload from '@/components/profile/AvatarUpload';
import { useUserProfile } from '@/hooks/useUserProfile';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { profile, loading: profileLoading } = useUserProfile();
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (profile && !loaded) {
      setDisplayName(profile.displayName || '');
      // Fetch phone from profiles table
      const fetchPhone = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
          .from('profiles')
          .select('phone')
          .eq('user_id', session.user.id)
          .maybeSingle();
        setPhone(data?.phone || '');
        setLoaded(true);
      };
      fetchPhone();
    }
  }, [profile, loaded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error('Please log in'); return; }

      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          phone: phone.trim() || null,
        })
        .eq('user_id', session.user.id);

      if (error) throw error;
      toast.success('Profile updated successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (profileLoading) {
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
        <p className="text-muted-foreground text-sm mt-1">Manage your profile and preferences</p>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Profile Picture</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <AvatarUpload />
          <div className="text-sm text-muted-foreground">
            <p>Click to upload a new avatar</p>
            <p className="text-xs mt-1">JPG, PNG or GIF. Max 5MB.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={profile?.email || ''}
              disabled
              className="bg-muted/50"
            />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+966 5XX XXX XXXX"
              type="tel"
            />
          </div>

          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
