import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Building2, Plus, ArrowRight, Crown, Sparkles, Briefcase, Users, Globe } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import VideoBackground from '@/components/VideoBackground';
import CompanyInvitations from '@/components/client/CompanyInvitations';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';

const tierConfig: Record<string, { icon: typeof Sparkles; color: string; bg: string }> = {
  basic: { icon: Sparkles, color: 'text-muted-foreground', bg: 'bg-muted/50' },
  professional: { icon: Sparkles, color: 'text-blue-600', bg: 'bg-blue-500/10' },
  enterprise: { icon: Crown, color: 'text-amber-600', bg: 'bg-amber-500/10' },
};

const industries = [
  'oil_gas', 'petrochemical', 'banking', 'telecom', 'healthcare',
  'retail', 'manufacturing', 'government', 'education', 'construction',
  'logistics', 'utilities', 'technology', 'other',
];

const companySizes = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

export default function CompanySelectorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenants, memberships, switchTenant, refetch, loading: tenantsLoading } = useTenant();
  const { profile } = useUserProfile();
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyIndustry, setNewCompanyIndustry] = useState('');
  const [newCompanySize, setNewCompanySize] = useState('');
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const isFirstCompany = tenants.length === 0;

  const handleSelect = (tenantId: string) => {
    switchTenant(tenantId);
    navigate('/client');
  };

  const handleCreate = async () => {
    if (!newCompanyName.trim()) return;
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const slug = newCompanyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
      const tenantId = crypto.randomUUID();
      const { error } = await supabase
        .from('tenants')
        .insert({ id: tenantId, name: newCompanyName.trim(), slug });

      if (error) throw error;

      await supabase.from('tenant_members').insert({
        tenant_id: tenantId,
        user_id: user.id,
        org_role: 'owner' as any,
      });

      // Update client profile with company details
      await supabase.from('client_profiles' as any).upsert({
        user_id: user.id,
        company_name: newCompanyName.trim(),
        industry: newCompanyIndustry || null,
        company_size: newCompanySize || null,
      }, { onConflict: 'user_id' });

      await refetch();
      toast.success(t('company_selector.created_success', { name: newCompanyName }));
      setNewCompanyName('');
      setNewCompanyIndustry('');
      setNewCompanySize('');
      setDialogOpen(false);
      switchTenant(tenantId);
      navigate('/client');
    } catch (err: any) {
      toast.error(err.message || t('company_selector.create_error'));
    } finally {
      setCreating(false);
    }
  };

  // First-time setup — show a welcoming full-page form instead of a dialog
  if (isFirstCompany && !tenantsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative py-8">
        <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
        <div className="w-full max-w-lg relative z-10 animate-fade-in">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t('company_selector.welcome_title')}</h1>
            <p className="text-muted-foreground text-sm mt-2">{t('company_selector.welcome_subtitle')}</p>
          </div>

          <Card className="border-border/40 bg-card/95 backdrop-blur-sm">
            <CardContent className="p-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="companyName">{t('company_selector.company_name')} *</Label>
                <Input
                  id="companyName"
                  value={newCompanyName}
                  onChange={e => setNewCompanyName(e.target.value)}
                  placeholder={t('company_selector.company_name_placeholder')}
                  className="h-11 rounded-xl"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('company_selector.industry')}</Label>
                  <Select value={newCompanyIndustry} onValueChange={setNewCompanyIndustry}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder={t('company_selector.select_industry')} />
                    </SelectTrigger>
                    <SelectContent>
                      {industries.map(ind => (
                        <SelectItem key={ind} value={ind}>{t(`client_onboarding.industry_${ind}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('company_selector.company_size')}</Label>
                  <Select value={newCompanySize} onValueChange={setNewCompanySize}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder={t('company_selector.select_size')} />
                    </SelectTrigger>
                    <SelectContent>
                      {companySizes.map(s => (
                        <SelectItem key={s} value={s}>{s} {t('client_onboarding.employees')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={handleCreate}
                disabled={creating || !newCompanyName.trim()}
                className="w-full gradient-primary border-0 h-12 text-base font-semibold rounded-xl"
              >
                {creating ? t('common.loading') : t('company_selector.get_started')}
                {!creating && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative py-8">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <div className="w-full max-w-2xl relative z-10 animate-fade-in">
        {/* User Header */}
        <div className="flex items-center gap-4 mb-8">
          <Avatar className="w-14 h-14 border-2 border-primary/20 shadow-md">
            <AvatarImage src={profile?.avatarUrl || undefined} />
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">{profile?.initials || 'U'}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('company_selector.my_companies')}</h1>
            <p className="text-muted-foreground text-sm">
              {tenants.length} {tenants.length === 1 ? t('company_selector.company_single') : t('company_selector.company_plural')} · {t('company_selector.choose_prompt')}
            </p>
          </div>
        </div>

        <div className="grid gap-3 mb-6">
          {tenants.map((tenant) => {
            const tier = tierConfig[tenant.subscription_tier] || tierConfig.basic;
            const TierIcon = tier.icon;
            const mem = memberships.find(m => m.tenant_id === tenant.id);
            const roleLabel = mem?.org_role || 'member';
            return (
              <Card
                key={tenant.id}
                className="cursor-pointer hover:shadow-lg hover:scale-[1.01] transition-all border-border/40 bg-card/95 backdrop-blur-sm group"
                onClick={() => handleSelect(tenant.id)}
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    {tenant.logo_url ? (
                      <img src={tenant.logo_url} alt={tenant.name} className="w-8 h-8 rounded-lg object-contain" />
                    ) : (
                      <Building2 className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">{tenant.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${tier.bg} ${tier.color}`}>
                        <TierIcon className="w-3 h-3" />
                        {tenant.subscription_tier}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent capitalize">{roleLabel}</span>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full h-12 rounded-xl border-dashed border-2 gap-2 text-muted-foreground hover:text-foreground hover:border-primary/50">
              <Plus className="w-5 h-5" />
              {t('company_selector.add_company')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                {t('company_selector.create_company')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>{t('company_selector.company_name')} *</Label>
                <Input
                  value={newCompanyName}
                  onChange={e => setNewCompanyName(e.target.value)}
                  placeholder={t('company_selector.company_name_placeholder')}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('company_selector.industry')}</Label>
                  <Select value={newCompanyIndustry} onValueChange={setNewCompanyIndustry}>
                    <SelectTrigger><SelectValue placeholder={t('company_selector.select_industry')} /></SelectTrigger>
                    <SelectContent>
                      {industries.map(ind => (
                        <SelectItem key={ind} value={ind}>{t(`client_onboarding.industry_${ind}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('company_selector.company_size')}</Label>
                  <Select value={newCompanySize} onValueChange={setNewCompanySize}>
                    <SelectTrigger><SelectValue placeholder={t('company_selector.select_size')} /></SelectTrigger>
                    <SelectContent>
                      {companySizes.map(s => (
                        <SelectItem key={s} value={s}>{s} {t('client_onboarding.employees')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={handleCreate}
                disabled={creating || !newCompanyName.trim()}
                className="w-full gradient-primary border-0 h-11"
              >
                {creating ? t('common.loading') : t('company_selector.create_company')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
