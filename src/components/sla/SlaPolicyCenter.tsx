import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FilePlus2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenant } from '@/contexts/TenantContext';
import { useInvalidatePolicies, useMyPolicies, useSlaSettings } from '@/hooks/useSla';
import * as api from '@/lib/sla/api';
import { formatTarget, hoursPerDay, normalizeBody, SEVERITY_KEYS } from '@/lib/sla/policy';
import SlaPolicyEditor from './SlaPolicyEditor';
import { coverageText, fmtAt, langOf, slaErrorText } from './slaUi';

/** Client "SLA policy" area: own company's policies, the platform default and templates to start from. */
export default function SlaPolicyCenter() {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const { data, isLoading, error } = useMyPolicies(tenantId);
  const settings = useSlaSettings().data;
  const invalidate = useInvalidatePolicies();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (open) return <SlaPolicyEditor policyId={open} tenantId={tenantId} onClose={() => setOpen(null)} />;
  if (isLoading) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (error || !data) return <p className="text-sm text-muted-foreground">{t('sla.center.unavailable')}</p>;

  const start = async (sourceId: string, name: string) => {
    setBusy(true);
    try {
      const r = await api.duplicatePolicy(sourceId, tenantId, name);
      invalidate(); setOpen(r.id);
    } catch (e) { toast.error(slaErrorText(t, e)); } finally { setBusy(false); }
  };
  const def = data.platform_default;
  const defBody = def?.body ? normalizeBody(def.body) : null;

  return (
    <div className="space-y-4" data-testid="sla-center">
      <p className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="me-1 inline h-3.5 w-3.5" aria-hidden />{t('sla.disclaimer')}</p>

      {data.policies.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="space-y-3 py-8 text-center">
            <FilePlus2 className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <p className="font-medium">{t('sla.center.emptyTitle')}</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">{t('sla.center.emptyText')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.policies.map((p) => (
            <Card key={p.id} className="rounded-2xl">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{p.name}</p>
                  <Badge variant={p.status === 'active' ? 'default' : 'outline'}>{t(`sla.status.${p.status}`)}</Badge>
                  <Badge variant="secondary">v{p.current_version}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(`sla.applies.${p.applies_to.kind}`)}{p.applies_to.values.length ? `: ${p.applies_to.values.join(', ')}` : ''}
                  {p.effective_from ? ` · ${t('sla.center.effective', { at: fmtAt(p.effective_from, undefined, lang) })}` : ''}
                </p>
                <Button size="sm" variant="outline" onClick={() => setOpen(p.id)}>{p.can_manage ? t('sla.center.edit') : t('sla.center.view')}</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data.can_manage && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.center.startFrom')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(settings?.templates ?? []).map((tp) => (
              <Button key={tp.id} variant="outline" size="sm" busy={busy} onClick={() => start(tp.id, tp.name)} title={tp.description}>{t(`sla.templateName.${tp.key}`, { defaultValue: tp.name })}</Button>
            ))}
            {def && <Button variant="ghost" size="sm" busy={busy} onClick={() => start(def.id, t('sla.center.myPolicy'))}>{t('sla.center.fromDefault')}</Button>}
          </CardContent>
        </Card>
      )}

      {def && defBody && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.center.defaultTitle')}</CardTitle>
            <p className="text-xs text-muted-foreground">{t('sla.center.defaultText')} · {coverageText(t, { ...defBody.coverage, tz: 'UTC' })}</p></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs"><thead><tr className="text-muted-foreground"><th className="text-start">{t('sla.editor.severity')}</th><th className="text-start">{t('sla.clock.response')}</th><th className="text-start">{t('sla.clock.resolution')}</th></tr></thead>
              <tbody>{SEVERITY_KEYS.map((k) => (
                <tr key={k} className="border-t border-border/50"><td className="py-1.5">{k}</td>
                  <td>{formatTarget(defBody.severities[k].response_min, defBody.coverage.mode, hoursPerDay(defBody.coverage), lang)}</td>
                  <td>{formatTarget(defBody.severities[k].resolution_min, defBody.coverage.mode, hoursPerDay(defBody.coverage), lang)}</td></tr>
              ))}</tbody></table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
