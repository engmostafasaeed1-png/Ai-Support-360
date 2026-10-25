import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenant } from '@/contexts/TenantContext';
import { useSlaEnabled, useSlaReport } from '@/hooks/useSla';
import { formatMinutes, SEVERITY_KEYS } from '@/lib/sla/policy';
import type { SlaReport } from '@/lib/sla/api';
import { fmtAt, langOf } from './slaUi';

export function ComplianceView({ report, linkBase }: { report: SlaReport; linkBase: string }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="space-y-1 p-4"><p className="text-xs text-muted-foreground">{t('sla.report.compliance')}</p><p className="text-2xl font-bold">{report.pct === null ? '—' : `${report.pct} %`}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="space-y-1 p-4"><p className="text-xs text-muted-foreground">{t('sla.report.breachedOpen')}</p><p className="text-2xl font-bold">{report.breached_open}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="space-y-1 p-4"><p className="text-xs text-muted-foreground">{t('sla.report.atRisk')}</p><p className="text-2xl font-bold">{report.at_risk.length}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="space-y-1 p-4"><p className="text-xs text-muted-foreground">{t('sla.report.measured')}</p><p className="text-2xl font-bold">{Object.values(report.by_severity).reduce((n, s) => n + s.measured, 0)}</p></CardContent></Card>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground"><tr><th className="px-3 py-2 text-start">{t('sla.editor.severity')}</th><th className="text-start">{t('sla.report.compliance')}</th><th className="text-start">{t('sla.report.avgResponse')}</th><th className="text-start">{t('sla.report.avgResolution')}</th><th className="text-start">{t('sla.report.measured')}</th></tr></thead>
          <tbody>{SEVERITY_KEYS.map((k) => {
            const s = report.by_severity[k];
            return (
              <tr key={k} className="border-t border-border/50"><td className="px-3 py-2 font-medium">{k}</td><td>{s?.pct ?? '—'}{s?.pct != null ? ' %' : ''}</td>
                <td>{s?.avg_response_min != null ? formatMinutes(s.avg_response_min, lang) : '—'}</td><td>{s?.avg_resolution_min != null ? formatMinutes(s.avg_resolution_min, lang) : '—'}</td><td>{s?.measured ?? 0}</td></tr>
            );
          })}</tbody>
        </table>
      </div>
      {report.at_risk.length > 0 && (
        <ul className="space-y-1.5">
          {report.at_risk.slice(0, 10).map((r) => (
            <li key={`${r.ticket_id}-${r.kind}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs">
              <AlertTriangle className={r.breached_at ? 'h-3.5 w-3.5 text-destructive' : 'h-3.5 w-3.5 text-warning'} aria-hidden />
              <Link to={`${linkBase}${r.ticket_id}`} className="flex-1 font-medium hover:text-primary">{r.title}</Link>
              <span className="text-muted-foreground">{r.severity} · {t(`sla.clock.${r.kind}`)} · {r.breached_at ? t('sla.state.breached') : t('sla.chip.due', { at: fmtAt(r.due_at, undefined, lang) })}{r.paused ? ` · ${t('sla.state.paused')}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Client dashboard / SLA page cards (own company). Nothing while the feature is off. */
export default function SlaComplianceCards({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const on = useSlaEnabled();
  const { tenant } = useTenant();
  const [days, setDays] = useState(30);
  const { data, isLoading } = useSlaReport('client', days, tenant?.id ?? null);
  if (!on) return null;
  return (
    <Card className="rounded-2xl border-border/50" data-testid="sla-compliance">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 pb-2">
        <CardTitle className="flex flex-1 items-center gap-2 text-sm"><Gauge className="h-4 w-4 text-primary" aria-hidden /> {t('sla.report.title')}</CardTitle>
        {[30, 90].map((d) => <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setDays(d)}>{t('sla.report.days', { count: d })}</Button>)}
        {compact && <Link to="/client/sla" className="text-xs text-primary hover:underline">{t('sla.report.open')}</Link>}
      </CardHeader>
      <CardContent>{isLoading || !data ? <Skeleton className="h-24 w-full" /> : <ComplianceView report={data} linkBase="/client/tickets/" />}</CardContent>
    </Card>
  );
}

/** Consultant dashboard: "My SLA at risk" + own compliance (separate from responsiveness, which counts assignment replies). */
export function ConsultantSlaCard() {
  const { t } = useTranslation();
  const on = useSlaEnabled();
  const { data, isLoading } = useSlaReport('consultant', 30);
  if (!on) return null;
  return (
    <Card className="rounded-2xl border-border/50" data-testid="sla-consultant">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Gauge className="h-4 w-4 text-primary" aria-hidden /> {t('sla.report.mine')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('sla.report.mineHint')}</p></CardHeader>
      <CardContent>{isLoading || !data ? <Skeleton className="h-24 w-full" /> : <ComplianceView report={data} linkBase="/consultant/cases/" />}</CardContent>
    </Card>
  );
}
