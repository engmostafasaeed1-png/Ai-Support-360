import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Lightbulb } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useClientTickets } from '@/hooks/useClientTickets';
import { ALL_SAP_AREAS } from '@/lib/sapAreas';
import { versionChoices } from '../../../supabase/functions/_shared/sapVersions';
import { ARCH_TYPES, LIMITS, TYPE_SECTIONS, TYPE_TITLES, emptyArchContent, metaProblems, type ArchConfidentiality, type ArchType } from '../../../supabase/functions/_shared/archModel';
import { createArch } from '@/lib/architecture/api';
import { cn } from '@/lib/utils';

interface Props { open: boolean; onOpenChange: (v: boolean) => void; presetTicket?: string | null }

/** New Document: type -> details -> links and sharing. Creates the document and opens the editor. */
export default function ArchWizard({ open, onOpenChange, presetTicket }: Props) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const nav = useNavigate();
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const { data: tickets = [] } = useClientTickets();
  const { data: projects = [] } = useQuery({
    queryKey: ['arch-projects', tenant?.id ?? null],
    enabled: open,
    queryFn: async () => {
      let q = (supabase as any).from('projects').select('id, title, tenant_id').order('created_at', { ascending: false }).limit(100);
      q = tenant?.id ? q.eq('tenant_id', tenant.id) : q.is('tenant_id', null);
      const { data, error } = await q;
      return error ? [] : (data ?? []) as Array<{ id: string; title: string }>;
    },
  });
  const [step, setStep] = useState(0);
  const [type, setType] = useState<ArchType>('hld');
  const [title, setTitle] = useState('');
  const [area, setArea] = useState('');
  const [mod, setMod] = useState('');
  const [ver, setVer] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<'draft' | 'in_review'>('draft');
  const [conf, setConf] = useState<ArchConfidentiality>('private');
  const [lang, setLang] = useState<'en' | 'ar'>(ar ? 'ar' : 'en');
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setStep(0); setTicketIds(presetTicket ? [presetTicket] : []); setProjectIds([]); }
  }, [open, presetTicket]);

  const versions = useMemo(() => (area ? versionChoices(area) : []), [area]);
  const problems = metaProblems({ title, owner_name: owner });
  const toggle = (list: string[], id: string, set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : list.length >= LIMITS.links ? list : [...list, id]);

  const create = async () => {
    setBusy(true);
    const r = await createArch(tenant?.id ?? null, {
      type, title: title.trim(), sap_area: area, sap_module: mod.trim(), sap_version: ver, owner_name: owner.trim(), status,
      confidentiality: conf, language: lang, tickets: ticketIds, projects: projectIds, content: emptyArchContent(type, lang),
    });
    setBusy(false);
    if (r.error || !r.data) { toast.error(r.error?.message ?? t('arch.common.failed')); return; }
    toast.success(t('arch.wizard.created'));
    void qc.invalidateQueries({ queryKey: ['arch-list'] });
    onOpenChange(false);
    nav(`/client/solution-architecture/${r.data}`);
  };

  const steps = [t('arch.wizard.stepType'), t('arch.wizard.stepDetails'), t('arch.wizard.stepLinks')];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('arch.newDocument')}</DialogTitle>
          <DialogDescription>{t('arch.wizard.subtitle')}</DialogDescription>
        </DialogHeader>
        <ol className="flex gap-2 text-xs" aria-label={t('arch.wizard.progress')}>
          {steps.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined}
              className={cn('flex-1 rounded-full px-3 py-1 text-center border', i === step ? 'border-primary bg-primary/10 text-primary font-medium' : i < step ? 'border-border bg-muted' : 'border-border text-muted-foreground')}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <RadioGroup value={type} onValueChange={(v) => setType(v as ArchType)} className="grid gap-2 sm:grid-cols-2" aria-label={t('arch.fields.type')}>
            {ARCH_TYPES.map((x) => (
              <Label key={x} htmlFor={`arch-type-${x}`} className={cn('flex items-start gap-2 rounded-xl border p-3 cursor-pointer', type === x ? 'border-primary bg-primary/5' : 'border-border')}>
                <RadioGroupItem id={`arch-type-${x}`} value={x} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">{TYPE_TITLES[x][ar ? 'ar' : 'en']}</span>
                  <span className="block text-xs text-muted-foreground font-normal">{t('arch.wizard.sections', { count: TYPE_SECTIONS[x].length })}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}

        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="arch-title">{t('arch.fields.title')} *</Label>
              <Input id="arch-title" value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} aria-invalid={problems.includes('title')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="arch-area">{t('arch.fields.area')}</Label>
              <Select value={area} onValueChange={(v) => { setArea(v); setVer(''); }}>
                <SelectTrigger id="arch-area"><SelectValue placeholder={t('arch.fields.choose')} /></SelectTrigger>
                <SelectContent className="max-h-72">{ALL_SAP_AREAS.map((a) => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="arch-module">{t('arch.fields.module')}</Label>
              <Input id="arch-module" value={mod} maxLength={LIMITS.sapField} onChange={(e) => setMod(e.target.value)} placeholder={t('arch.fields.modulePh')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="arch-version">{t('arch.fields.release')}</Label>
              <Select value={ver} onValueChange={setVer} disabled={!area}>
                <SelectTrigger id="arch-version"><SelectValue placeholder={t('arch.fields.choose')} /></SelectTrigger>
                <SelectContent>{versions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="arch-owner">{t('arch.fields.owner')}</Label>
              <Input id="arch-owner" value={owner} maxLength={LIMITS.owner} onChange={(e) => setOwner(e.target.value)} placeholder={t('arch.fields.ownerPh')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="arch-status">{t('arch.fields.status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'draft' | 'in_review')}>
                <SelectTrigger id="arch-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{t('arch.status.draft')}</SelectItem>
                  <SelectItem value="in_review">{t('arch.status.in_review')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t('arch.wizard.statusHint')}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="arch-lang">{t('arch.fields.language')}</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as 'en' | 'ar')}>
                <SelectTrigger id="arch-lang"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('arch.fields.conf')}</legend>
              <RadioGroup value={conf} onValueChange={(v) => setConf(v as ArchConfidentiality)} className="space-y-2">
                {(['private', 'shared'] as const).map((c) => (
                  <Label key={c} htmlFor={`arch-conf-${c}`} className={cn('flex items-start gap-2 rounded-xl border p-3 cursor-pointer font-normal', conf === c ? 'border-primary bg-primary/5' : 'border-border')}>
                    <RadioGroupItem id={`arch-conf-${c}`} value={c} className="mt-0.5" />
                    <span><span className="block text-sm font-medium">{t(`arch.conf.${c}`)}</span><span className="block text-xs text-muted-foreground">{t(`arch.conf.${c}Hint`)}</span></span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t('arch.fields.tickets')} <span className="text-muted-foreground font-normal">({t('arch.common.optional')})</span></legend>
              {tickets.length === 0 ? <p className="text-xs text-muted-foreground">{t('arch.wizard.noTickets')}</p> : (
                <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {tickets.map((tk) => (
                    <label key={tk.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
                      <Checkbox checked={ticketIds.includes(tk.id)} onCheckedChange={() => toggle(ticketIds, tk.id, setTicketIds)} />
                      <span className="truncate">{tk.title}</span><span className="ms-auto text-xs text-muted-foreground">{tk.sap_module}</span>
                    </label>
                  ))}
                </div>
              )}
              {conf === 'shared' && ticketIds.length === 0 && <p className="text-xs text-muted-foreground">{t('arch.wizard.sharedNeedsTicket')}</p>}
            </fieldset>
            {projects.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">{t('arch.fields.projects')} <span className="text-muted-foreground font-normal">({t('arch.common.optional')})</span></legend>
                <div className="max-h-32 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
                      <Checkbox checked={projectIds.includes(p.id)} onCheckedChange={() => toggle(projectIds, p.id, setProjectIds)} />
                      <span className="truncate">{p.title}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs"><Lightbulb className="h-4 w-4 shrink-0 text-primary" aria-hidden />{t('arch.wizard.brdHint')}</p>
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))} className="gap-1">
            {step > 0 && <ArrowLeft className="h-4 w-4 rtl:rotate-180" />}{step === 0 ? t('common.cancel', 'Cancel') : t('arch.common.back')}
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && problems.length > 0} className="gap-1">
              {t('arch.common.next')}<ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button onClick={create} disabled={busy || problems.length > 0} className="gap-1"><Check className="h-4 w-4" />{t('arch.wizard.create')}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
