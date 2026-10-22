import { useTranslation } from 'react-i18next';
import { Grid3x3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCoverage } from '@/hooks/useInterviewKnowledge';
import { coverageState } from '@/lib/interviewKnowledge';

export default function KnowledgeCoveragePanel({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const coverage = useCoverage(ready);
  const rows = coverage.data ?? [];
  const label = (m: string, v: string | null) => `${m}${v ? ` ${v}` : ''}`;
  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Grid3x3 className="h-4 w-4 text-primary" />{t('ik.coverage.title', 'Coverage (module × version)')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('ik.coverage.subtitle', 'Modules and versions that consultants declare or documents cover. Questions and scores are from the last 30 days.')}</p>
      </CardHeader>
      <CardContent>
        {coverage.isLoading && <Skeleton className="h-32" />}
        {coverage.error && <p role="alert" className="text-sm text-destructive">{(coverage.error as Error).message}</p>}
        {ready && !coverage.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('ik.coverage.empty', 'Nothing to show yet.')}</p>}
        {rows.length > 0 && (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">{t('ik.coverage.title', 'Coverage (module × version)')}</caption>
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/60">
                  <th scope="col" className="text-start font-medium px-2 py-2">{t('ik.coverage.module', 'Module')}</th>
                  <th scope="col" className="text-start font-medium px-2 py-2">{t('ik.coverage.version', 'Version')}</th>
                  <th scope="col" className="text-end font-medium px-2 py-2">{t('ik.coverage.documents', 'Documents')}</th>
                  <th scope="col" className="text-end font-medium px-2 py-2">{t('ik.coverage.consultants', 'Consultants')}</th>
                  <th scope="col" className="text-end font-medium px-2 py-2">{t('ik.coverage.asked', 'Questions asked')}</th>
                  <th scope="col" className="text-end font-medium px-2 py-2">{t('ik.coverage.score', 'Average score')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const state = coverageState(r);
                  return (
                    <tr key={`${r.sap_module}|${r.sap_version ?? ''}`} className="border-b border-border/30 align-top">
                      <td className="px-2 py-2 text-foreground">{r.sap_module}</td>
                      <td className="px-2 py-2 text-muted-foreground">{r.sap_version ?? t('ik.coverage.any_version', 'any / not given')}</td>
                      <td className="px-2 py-2 text-end">
                        <span className="tabular-nums">{r.documents}</span>
                        {state !== 'covered' && (
                          <Badge variant="secondary" className={`ms-2 text-[10px] ${state === 'none' ? 'bg-destructive/10 text-destructive' : ''}`}>
                            {state === 'none'
                              ? t('ik.coverage.none', { what: label(r.sap_module, r.sap_version), defaultValue: 'No documents for {{what}}' })
                              : t('ik.coverage.general_only', 'Only release-independent documents')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums">{r.consultants}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{r.questions_asked}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{r.avg_score ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
