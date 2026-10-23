import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, Mail, MousePointerClick, RefreshCw, Send, Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { INVITE_CLICK_CHANNELS, parseEffectiveness, rate, type InviteClickChannel, type InviteEffectiveness } from '@/lib/inviteTracking';

const ICON: Record<InviteClickChannel, typeof Bell> = { in_app: Bell, push: Smartphone, telegram: Send, email: Mail };

/** Administrators only: how many consultants the invitation reached, read it in the bell and clicked through to Refer & earn. */
export default function InviteEffectivenessCard() {
  const { t, i18n } = useTranslation();
  const [version, setVersion] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['rinv', 'effectiveness', version],
    retry: false,
    queryFn: async (): Promise<InviteEffectiveness> => {
      const r = await safeRpc('admin_referral_invite_effectiveness', version ? { _version: version } : {});
      if (r.error) {
        if (isMissingRpc(r.error)) return { ...parseEffectiveness({}), available: false };
        throw new Error(r.error.message);
      }
      return parseEffectiveness(r.data);
    },
  });
  const ar = i18n.language?.startsWith('ar');
  const fmt = (v: number) => v.toLocaleString(ar ? 'ar' : 'en-GB');
  const pct = (v: number | null) => (v === null ? '–' : `${fmt(v)} %`);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(ar ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
  const label = (c: InviteClickChannel) => t(`rinvx.ch_${c}`, { in_app: 'In-app (bell)', push: 'Push', telegram: 'Telegram', email: 'E-mail' }[c]);

  const e = q.data;
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MousePointerClick className="h-4 w-4 text-primary" aria-hidden />
            {t('rinvx.title', 'Invitation effectiveness')}
          </CardTitle>
          <div className="flex items-center gap-2">
            {e && e.versions.length > 1 && (
              <Select value={String(version ?? e.version)} onValueChange={(v) => setVersion(Number(v))}>
                <SelectTrigger className="h-8 w-28 rounded-xl" aria-label={t('rinvx.version', 'Invitation version')}><SelectValue /></SelectTrigger>
                <SelectContent>{e.versions.map((v) => <SelectItem key={v} value={String(v)}>v{v}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => q.refetch()} aria-label={t('rinvx.refresh', 'Refresh')}>
              <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading ? <Skeleton className="h-32 w-full rounded-xl" />
          : q.isError ? <p role="alert" className="text-destructive">{(q.error as Error).message}</p>
          : !e?.available ? (
            <p role="status" className="text-muted-foreground">
              {t('rinvx.pending', 'Click counting turns on after the prepared database update (invitation tracking) is applied. Until then no clicks are recorded.')}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  [t('rinvx.reached', 'Consultants reached'), fmt(e.reached)],
                  [t('rinvx.read', 'Read in the bell'), `${fmt(e.read_in_app)} · ${pct(rate(e.read_in_app, e.delivered.in_app))}`],
                  [t('rinvx.clickers', 'Opened Refer & earn'), fmt(e.clickers)],
                  [t('rinvx.click_rate', 'Click rate'), pct(rate(e.clickers, e.reached))],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">{l}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <Table aria-label={t('rinvx.by_channel', 'Invitation results by channel')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('rinvx.channel', 'Channel')}</TableHead>
                      <TableHead className="text-end">{t('rinvx.delivered', 'Delivered')}</TableHead>
                      <TableHead className="text-end">{t('rinvx.clicked', 'Clicked')}</TableHead>
                      <TableHead className="text-end">{t('rinvx.rate', 'Rate')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {INVITE_CLICK_CHANNELS.map((c) => {
                      const Icon = ICON[c];
                      return (
                        <TableRow key={c}>
                          <TableCell><span className="inline-flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" aria-hidden />{label(c)}</span></TableCell>
                          <TableCell className="text-end tabular-nums">{c === 'email' ? t('rinvx.not_sent', 'not sent') : fmt(e.delivered[c])}</TableCell>
                          <TableCell className="text-end tabular-nums">{fmt(e.clicked[c])}</TableCell>
                          <TableCell className="text-end tabular-nums">{c === 'email' ? '–' : pct(rate(e.clicked[c], e.delivered[c]))}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                {t('rinvx.span', 'Version v{{v}} · first click {{first}} · latest click {{last}} · your own test clicks (not counted): {{tests}}', {
                  v: e.version, first: when(e.first_click_at), last: when(e.last_click_at), tests: fmt(e.test_clicks),
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('rinvx.how', 'Each consultant counts once per channel when they open Refer & earn from the invitation while signed in. Links carry no personal data and there are no hidden tracking images, so e-mail opens are not measured.')}
              </p>
            </>
          )}
      </CardContent>
    </Card>
  );
}
