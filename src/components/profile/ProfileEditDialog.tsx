import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { locationError, resolvePlacePoint } from '@/lib/consultantLocation';
import { Loader2 } from 'lucide-react';
import AvatarUpload from './AvatarUpload';
import { normalizeLinkedinUrl, LINKEDIN_HINT } from '@/lib/consultantLinks';


interface ProfileData {
  display_name: string;
  phone: string;
  preferred_language: string;
  // consultant fields
  bio: string;
  hourly_rate: string;
  city: string;
  country: string;
  linkedin_url: string;
  github_url: string;
  personal_website: string;
  // client fields
  company_name: string;
  company_website: string;
  industry: string;
  headquarters: string;
}

const emptyProfile: ProfileData = {
  display_name: '', phone: '', preferred_language: 'en',
  bio: '', hourly_rate: '', city: '', country: '',
  linkedin_url: '', github_url: '', personal_website: '',
  company_name: '', company_website: '', industry: '', headquarters: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: 'client' | 'consultant';
}

export default function ProfileEditDialog({ open, onOpenChange, role }: Props) {
  const [data, setData] = useState<ProfileData>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const uid = session.user.id;

      const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', uid).maybeSingle();

      const updates: Partial<ProfileData> = {
        display_name: profile?.display_name || '',
        phone: profile?.phone || '',
        preferred_language: profile?.preferred_language || 'en',
      };

      if (role === 'consultant') {
        const { data: row } = await supabase.from('consultants').select('id, bio, hourly_rate, city, country').eq('user_id', uid).maybeSingle();
        // The links are read from the view of contact links (the consultant's own row).
        const { data: links } = row
          ? await (supabase as any).from('consultant_contact_links').select('linkedin_url, github_url, personal_website').eq('consultant_id', row.id).maybeSingle()
          : { data: null };
        const c = row ? { ...row, linkedin_url: links?.linkedin_url ?? null, github_url: links?.github_url ?? null, personal_website: links?.personal_website ?? null } : null;
        if (c) {
          updates.bio = c.bio || '';
          updates.hourly_rate = c.hourly_rate?.toString() || '';
          updates.city = c.city || '';
          updates.country = c.country || '';
          updates.linkedin_url = c.linkedin_url || '';
          updates.github_url = c.github_url || '';
          updates.personal_website = c.personal_website || '';
        }
      } else {
        const { data: cp } = await supabase.from('client_profiles').select('*').eq('user_id', uid).maybeSingle();
        if (cp) {
          updates.company_name = cp.company_name || '';
          updates.company_website = cp.company_website || '';
          updates.industry = cp.industry || '';
          updates.headquarters = cp.headquarters || '';
          updates.phone = cp.phone || updates.phone || '';
        }
      }

      setData(prev => ({ ...prev, ...updates }));
      setLoading(false);
    };
    load();
  }, [open, role]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const uid = session.user.id;

      // Update profiles table
      const { error: pErr } = await supabase.from('profiles').update({
        display_name: data.display_name,
        phone: data.phone,
        preferred_language: data.preferred_language,
      }).eq('user_id', uid);
      if (pErr) throw pErr;

      if (role === 'consultant') {
        // The database rejects a LinkedIn text that is not a profile link; check first so the save is not half done.
        const linkedin = normalizeLinkedinUrl(data.linkedin_url);
        if (data.linkedin_url.trim() && !linkedin) {
          toast.error(LINKEDIN_HINT);
          return;
        }
        // Country and city are mandatory for consultants; the map point follows the city (country centre for an unlisted city).
        const missingPlace = locationError(data.country, data.city);
        if (missingPlace) { toast.error(missingPlace); return; }
        const point = resolvePlacePoint(data.country, data.city, uid);
        const { error: cErr } = await supabase.from('consultants').update({
          bio: data.bio || null,
          hourly_rate: data.hourly_rate ? parseFloat(data.hourly_rate) : 0,
          city: data.city || null,
          country: data.country || null,
          latitude: point?.lat ?? null,
          longitude: point?.lng ?? null,
          linkedin_url: linkedin,
          github_url: data.github_url || null,
          personal_website: data.personal_website || null,
        }).eq('user_id', uid);
        if (cErr) throw cErr;
      } else {
        const { error: cpErr } = await supabase.from('client_profiles').update({
          company_name: data.company_name || null,
          company_website: data.company_website || null,
          industry: data.industry || null,
          headquarters: data.headquarters || null,
          phone: data.phone || null,
        } as any).eq('user_id', uid);
        if (cpErr) throw cpErr;
      }

      toast.success('Profile updated successfully!');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData(prev => ({ ...prev, [key]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5">
            {/* Avatar */}
            <div className="flex justify-center">
              <AvatarUpload />
            </div>

            {/* Common fields */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="display_name">Display Name</Label>
                <Input id="display_name" value={data.display_name} onChange={set('display_name')} />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={data.phone} onChange={set('phone')} />
              </div>
            </div>

            {/* Role-specific fields */}
            {role === 'consultant' ? (
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold text-muted-foreground">Consultant Details</h3>
                <div>
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea id="bio" value={data.bio} onChange={set('bio')} rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="city">City</Label>
                    <Input id="city" value={data.city} onChange={set('city')} />
                  </div>
                  <div>
                    <Label htmlFor="country">Country</Label>
                    <Input id="country" value={data.country} onChange={set('country')} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="hourly_rate">Hourly Rate (USD)</Label>
                  <Input id="hourly_rate" type="number" value={data.hourly_rate} onChange={set('hourly_rate')} />
                </div>
                <div>
                  <Label htmlFor="linkedin_url">LinkedIn URL</Label>
                  <Input id="linkedin_url" value={data.linkedin_url} onChange={set('linkedin_url')} />
                </div>
                <div>
                  <Label htmlFor="github_url">GitHub URL</Label>
                  <Input id="github_url" value={data.github_url} onChange={set('github_url')} />
                </div>
                <div>
                  <Label htmlFor="personal_website">Website</Label>
                  <Input id="personal_website" value={data.personal_website} onChange={set('personal_website')} />
                </div>
              </div>
            ) : (
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold text-muted-foreground">Company Details</h3>
                <div>
                  <Label htmlFor="company_name">Company Name</Label>
                  <Input id="company_name" value={data.company_name} onChange={set('company_name')} />
                </div>
                <div>
                  <Label htmlFor="company_website">Company Website</Label>
                  <Input id="company_website" value={data.company_website} onChange={set('company_website')} />
                </div>
                <div>
                  <Label htmlFor="industry">Industry</Label>
                  <Input id="industry" value={data.industry} onChange={set('industry')} />
                </div>
                <div>
                  <Label htmlFor="headquarters">Headquarters</Label>
                  <Input id="headquarters" value={data.headquarters} onChange={set('headquarters')} />
                </div>
              </div>
            )}

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : 'Save Changes'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
