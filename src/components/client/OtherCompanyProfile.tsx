import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Info, Loader2, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { COMPANY_INDUSTRIES, COMPANY_SIZES, withCurrentOption } from '@/lib/companyOptions';
import { toast } from 'sonner';

const NONE = '__none__';

/**
 * The company page of every company except the first one. Each company has its own name, industry and size.
 * The SAP landscape, the key contacts and the NDA are kept once for the account, on the page of the first company.
 */
export default function OtherCompanyProfile() {
  const { t } = useTranslation();
  const { tenant, tenants, mainTenantId, isOwnerOrAdmin, refetch, switchTenant } = useTenant();
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [size, setSize] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(tenant?.name ?? '');
    setIndustry(tenant?.industry ?? '');
    setSize(tenant?.company_size ?? '');
  }, [tenant?.id, tenant?.name, tenant?.industry, tenant?.company_size]);

  if (!tenant) return null;

  const main = tenants.find(x => x.id === mainTenantId);
  const changed = name.trim() !== tenant.name || (industry || null) !== (tenant.industry ?? null) || (size || null) !== (tenant.company_size ?? null);

  const save = async () => {
    if (!name.trim()) { toast.error('Please enter the company name'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('tenants')
      .update({ name: name.trim(), industry: industry || null, company_size: size || null })
      .eq('id', tenant.id);
    setSaving(false);
    if (error) { toast.error('Update failed', { description: error.message }); return; }
    await refetch();
    toast.success('Company details saved');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" /> {tenant.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">The details of this company</p>
      </div>

      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-4 flex items-start gap-3 text-sm text-muted-foreground">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <p>
            This company has its own name, industry and size. The SAP landscape, the key contacts and the NDA are kept once for your account
            {main ? <> on the page of <button type="button" className="text-primary underline underline-offset-2" onClick={() => switchTenant(main.id)}>{main.name}</button></> : null}.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" /> Company Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="other-company-name">{t('company_profile_page.company_name', 'Company Name')}</Label>
            <Input id="other-company-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} disabled={!isOwnerOrAdmin} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('company_profile_page.industry', 'Industry')}</Label>
              <Select value={industry || NONE} onValueChange={v => setIndustry(v === NONE ? '' : v)} disabled={!isOwnerOrAdmin}>
                <SelectTrigger><SelectValue placeholder="Select industry..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('company_profile_page.not_set', 'Not set')}</SelectItem>
                  {withCurrentOption(COMPANY_INDUSTRIES, industry).map(i => (
                    <SelectItem key={i} value={i}>{t(`client_onboarding.industry_${i}`, { defaultValue: i })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('company_profile_page.company_size', 'Company Size')}</Label>
              <Select value={size || NONE} onValueChange={v => setSize(v === NONE ? '' : v)} disabled={!isOwnerOrAdmin}>
                <SelectTrigger><SelectValue placeholder="Select size..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('company_profile_page.not_set', 'Not set')}</SelectItem>
                  {withCurrentOption(COMPANY_SIZES, size).map(s => (
                    <SelectItem key={s} value={s}>{s} employees</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!isOwnerOrAdmin && (
            <p className="text-xs text-muted-foreground">Only an owner or an administrator of the company can change these details.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !isOwnerOrAdmin || !changed || !name.trim()} className="gradient-primary border-0 gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save company details
        </Button>
      </div>
    </div>
  );
}
