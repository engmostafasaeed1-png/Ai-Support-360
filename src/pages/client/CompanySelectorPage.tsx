import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Building2, Plus, ArrowRight, Crown, Sparkles, ChevronRight, Briefcase } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';

const tierConfig: Record<string, { icon: typeof Sparkles; color: string; bg: string }> = {
  basic: { icon: Sparkles, color: 'text-muted-foreground', bg: 'bg-muted/50' },
  professional: { icon: Sparkles, color: 'text-blue-600', bg: 'bg-blue-500/10' },
  enterprise: { icon: Crown, color: 'text-amber-600', bg: 'bg-amber-500/10' },
};

export default function CompanySelectorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenants, switchTenant, refetch } = useTenant();
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

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
      const { data: tenantData, error } = await supabase
        .from('tenants')
        .insert({ name: newCompanyName.trim(), slug })
        .select('id')
        .single();

      if (error) throw error;
      if (tenantData) {
        await supabase.from('tenant_members').insert({
          tenant_id: tenantData.id,
          user_id: user.id,
          org_role: 'owner' as any,
        });
        await refetch();
        toast.success(`${newCompanyName} created successfully!`);
        setNewCompanyName('');
        setDialogOpen(false);
        switchTenant(tenantData.id);
        navigate('/client');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create company');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative py-8">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <div className="w-full max-w-2xl relative z-10 animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 shadow-premium">
            <Building2 className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Select a Company</h1>
          <p className="text-muted-foreground">Choose a company to manage or create a new one</p>
        </div>

        <div className="grid gap-3 mb-6">
          {tenants.map((tenant) => {
            const tier = tierConfig[tenant.subscription_tier] || tierConfig.basic;
            const TierIcon = tier.icon;
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
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </CardContent>
              </Card>
            );
          })}

          {tenants.length === 0 && (
            <Card className="border-dashed border-2 border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-8 text-center">
                <Briefcase className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No companies yet. Create your first company to get started.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full h-12 rounded-xl border-dashed border-2 gap-2 text-muted-foreground hover:text-foreground hover:border-primary/50">
              <Plus className="w-5 h-5" />
              Create New Company
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Create New Company
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input
                  value={newCompanyName}
                  onChange={e => setNewCompanyName(e.target.value)}
                  placeholder="e.g. Acme Corporation"
                  className="h-11 rounded-xl"
                />
              </div>
              <Button
                onClick={handleCreate}
                disabled={creating || !newCompanyName.trim()}
                className="w-full gradient-primary border-0 h-11"
              >
                {creating ? 'Creating...' : 'Create Company'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
