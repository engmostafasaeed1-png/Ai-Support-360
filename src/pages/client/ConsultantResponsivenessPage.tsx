import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Timer, Search, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useRealtimeConsultants } from '@/hooks/useRealtimeConsultants';
import { usePublicResponsiveness } from '@/hooks/useResponsiveness';
import { formatMinutes, LEVEL_LABEL, LEVEL_TONE } from '@/lib/responsivenessFormat';
import { countLevels, formatPoints, rankingEffect, rankingEffectTable, responsivenessShare } from '@/lib/responsivenessRanking';
import { LEVEL_ORDER, type RespLevel } from '../../../supabase/functions/_shared/responsiveness';

function EffectBadge({ vsNew }: { vsNew: number }) {
  const { t } = useTranslation();
  const v = Math.round(vsNew * 10) / 10;
  const Icon = v > 0 ? TrendingUp : v < 0 ? TrendingDown : Minus;
  const tone = v > 0 ? 'border-success/30 bg-success/10 text-success' : v < 0 ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums', tone)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {v === 0 ? t('client_resp.neutral') : t('client_resp.points', { points: formatPoints(v) })}
    </span>
  );
}

export default function ConsultantResponsivenessPage() {
  const { t, i18n } = useTranslation();
  const ar = !!i18n.language?.startsWith('ar');
  const navigate = useNavigate();
  const { consultants, isLoading } = useRealtimeConsultants();
  const { publicOn, byId } = usePublicResponsiveness();
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<RespLevel | 'all'>('all');

  const levelOf = (id: string): RespLevel => byId.get(id)?.level ?? 'new';
  const label = (l: RespLevel) => (ar ? LEVEL_LABEL[l][1] : LEVEL_LABEL[l][0]);
  const share = responsivenessShare();
  const table = useMemo(() => rankingEffectTable(), []);
  const counts = useMemo(() => countLevels(consultants.map((c) => c.id), levelOf), [consultants, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return consultants
      .filter((c) => level === 'all' || levelOf(c.id) === level)
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.specialty.toLowerCase().includes(needle))
      .sort((a, b) => LEVEL_ORDER.indexOf(levelOf(a.id)) - LEVEL_ORDER.indexOf(levelOf(b.id)) || a.name.localeCompare(b.name));
  }, [consultants, byId, q, level]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground md:text-2xl">
          <Timer className="h-6 w-6 text-accent" aria-hidden="true" />
          {t('client_resp.title')}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground md:text-sm">{t('client_resp.subtitle')}</p>
      </div>

      {!publicOn ? (
        <Card className="rounded-2xl">
          <CardContent className="flex items-start gap-3 p-6">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium text-foreground">{t('client_resp.off_title')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('client_resp.off_body')}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('client_resp.how_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('client_resp.how_body', { share: share.toFixed(1) })}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('client_resp.how_title')}</caption>
                  <thead>
                    <tr className="border-b border-border text-start text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pe-3 text-start font-medium">{t('client_resp.col_level')}</th>
                      <th scope="col" className="py-2 pe-3 text-start font-medium">{t('client_resp.col_meaning')}</th>
                      <th scope="col" className="py-2 text-end font-medium">{t('client_resp.col_effect')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((r) => (
                      <tr key={r.level} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pe-3">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', LEVEL_TONE[r.level])}>{label(r.level)}</span>
                        </td>
                        <td className="py-2.5 pe-3 text-muted-foreground">{t(`client_resp.meaning_${r.level}`)}</td>
                        <td className="py-2.5 text-end"><EffectBadge vsNew={r.vsNew} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{t('client_resp.how_note')}</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label={t('client_resp.filter_label')}>
            <button
              type="button"
              aria-pressed={level === 'all'}
              onClick={() => setLevel('all')}
              className={cn('rounded-2xl border p-3 text-start transition-colors', level === 'all' ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50')}
            >
              <p className="text-xs text-muted-foreground">{t('client_resp.all')}</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{consultants.length}</p>
            </button>
            {LEVEL_ORDER.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => setLevel(level === l ? 'all' : l)}
                className={cn('rounded-2xl border p-3 text-start transition-colors', level === l ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50')}
              >
                <p className="text-xs text-muted-foreground">{label(l)}</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">{counts[l]}</p>
              </button>
            ))}
          </div>

          <Card className="rounded-2xl">
            <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
              <CardTitle className="text-base">{t('client_resp.list_title')}</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('client_resp.search')} aria-label={t('client_resp.search')} className="ps-9" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
              ) : rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('client_resp.empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {rows.map((c) => {
                    const r = byId.get(c.id);
                    const lvl = levelOf(c.id);
                    const eff = rankingEffect(lvl);
                    return (
                      <li key={c.id} data-testid="resp-row" data-level={lvl} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="gradient-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-primary-foreground">{c.avatar}</div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{c.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{c.specialty}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 font-medium', LEVEL_TONE[lvl])}>{label(lvl)}</span>
                          {lvl === 'new' ? (
                            <span className="text-muted-foreground">{t('client_resp.not_enough')}</span>
                          ) : (
                            <span className="text-muted-foreground">
                              {t('client_resp.stats', { median: formatMinutes(r?.median_minutes, ar), rate: r?.response_rate ?? 0 })}
                            </span>
                          )}
                          <EffectBadge vsNew={eff.vsNew} />
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/client/consultants/${c.id}`)}>
                            {t('client_resp.view_profile')}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
