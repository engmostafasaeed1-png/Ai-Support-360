import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { Download, Loader2, FileDown, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DateRangePicker } from '@/components/reports/DateRangePicker';
import { exportToCSV } from '@/components/reports/exportUtils';

type ProviderFilter = 'all' | 'meet' | 'jitsi' | 'zoom' | 'teams' | 'unknown';
type ReasonFilter =
  | 'all'
  | 'framed'
  | 'load_failed'
  | 'popup_blocked'
  | 'invalid_url'
  | 'none';

const PROVIDER_OPTIONS: { value: ProviderFilter; label: string }[] = [
  { value: 'all', label: 'All providers' },
  { value: 'meet', label: 'Google Meet' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'jitsi', label: 'Jitsi' },
  { value: 'unknown', label: 'Unknown' },
];

const REASON_OPTIONS: { value: ReasonFilter; label: string }[] = [
  { value: 'all', label: 'All reasons' },
  { value: 'framed', label: 'Framed (iframe-blocked)' },
  { value: 'load_failed', label: 'Load failed' },
  { value: 'popup_blocked', label: 'Popup blocked' },
  { value: 'invalid_url', label: 'Invalid URL' },
  { value: 'none', label: '— No reason —' },
];

const EXPORT_LIMIT = 10_000;

interface MeetingJoinEventRow {
  id: string;
  user_id: string;
  session_id: string | null;
  provider: string;
  event: string;
  reason: string | null;
  url_host: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function MeetingJoinEventsExportPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState<Date>(() => startOfDay(subDays(new Date(), 30)));
  const [to, setTo] = useState<Date>(() => endOfDay(new Date()));
  const [provider, setProvider] = useState<ProviderFilter>('all');
  const [reason, setReason] = useState<ReasonFilter>('all');

  const queryKey = useMemo(
    () => [
      'meeting-join-events-export',
      from.toISOString(),
      to.toISOString(),
      provider,
      reason,
    ],
    [from, to, provider, reason],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      let q = supabase
        .from('meeting_join_events')
        .select(
          'id, user_id, session_id, provider, event, reason, url_host, user_agent, metadata, created_at',
          { count: 'exact' },
        )
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: false })
        .limit(EXPORT_LIMIT);

      if (provider !== 'all') q = q.eq('provider', provider);
      if (reason === 'none') q = q.is('reason', null);
      else if (reason !== 'all') q = q.eq('reason', reason);

      const { data: rows, error: err, count } = await q;
      if (err) throw err;
      return { rows: (rows ?? []) as MeetingJoinEventRow[], count: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const totalCount = data?.count ?? 0;
  const truncated = totalCount > rows.length;

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error(
        t('mje_export.empty', {
          defaultValue: 'No events match the selected filters.',
        }),
      );
      return;
    }
    const flat = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      user_id: r.user_id,
      session_id: r.session_id ?? '',
      provider: r.provider,
      event: r.event,
      reason: r.reason ?? '',
      url_host: r.url_host ?? '',
      user_agent: r.user_agent ?? '',
      metadata: r.metadata ? JSON.stringify(r.metadata) : '',
    }));
    exportToCSV(flat, 'meeting_join_events');
    toast.success(
      t('mje_export.success', {
        defaultValue: 'Exported {{count}} events to CSV.',
        count: flat.length,
      }),
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('mje_export.title', { defaultValue: 'Meeting join events export' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('mje_export.subtitle', {
              defaultValue:
                'Filter meeting join attempts and download a CSV for reporting on framed/load_failed/popup_blocked/invalid_url fallbacks.',
            })}
          </p>
        </div>
        <Button onClick={handleExport} disabled={isLoading || rows.length === 0}>
          <Download className="w-4 h-4 mr-1.5" aria-hidden="true" />
          {t('mje_export.download', { defaultValue: 'Download CSV' })}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('mje_export.filters', { defaultValue: 'Filters' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('mje_export.date_range', { defaultValue: 'Date range' })}
            </label>
            <DateRangePicker
              from={from}
              to={to}
              onChange={(f, tEnd) => {
                setFrom(startOfDay(f));
                setTo(endOfDay(tEnd));
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('mje_export.provider', { defaultValue: 'Provider' })}
            </label>
            <Select value={provider} onValueChange={(v) => setProvider(v as ProviderFilter)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('mje_export.reason', { defaultValue: 'Fallback reason' })}
            </label>
            <Select value={reason} onValueChange={(v) => setReason(v as ReasonFilter)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            {t('mje_export.preview', { defaultValue: 'Preview' })}
          </CardTitle>
          <div className="flex items-center gap-2">
            {isFetching && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
            <Badge variant="secondary">
              {t('mje_export.row_count', {
                defaultValue: '{{shown}} of {{total}}',
                shown: rows.length,
                total: totalCount,
              })}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <FileDown className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
              {t('mje_export.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {truncated && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {t('mje_export.truncated_title', {
                  defaultValue: 'Result set is capped at {{limit}} rows',
                  limit: EXPORT_LIMIT.toLocaleString(),
                })}
              </AlertTitle>
              <AlertDescription>
                {t('mje_export.truncated_desc', {
                  defaultValue:
                    'The CSV will only contain the most recent {{limit}} matching events. Narrow the date range or filters for a complete export.',
                  limit: EXPORT_LIMIT.toLocaleString(),
                })}
              </AlertDescription>
            </Alert>
          )}

          {isError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {t('mje_export.error_title', { defaultValue: 'Could not load events' })}
              </AlertTitle>
              <AlertDescription>{(error as Error)?.message ?? 'Unknown error'}</AlertDescription>
            </Alert>
          )}

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">
                    {t('mje_export.col.created_at', { defaultValue: 'Timestamp' })}
                  </TableHead>
                  <TableHead>{t('mje_export.col.provider', { defaultValue: 'Provider' })}</TableHead>
                  <TableHead>{t('mje_export.col.event', { defaultValue: 'Event' })}</TableHead>
                  <TableHead>{t('mje_export.col.reason', { defaultValue: 'Reason' })}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('mje_export.col.url_host', { defaultValue: 'Host' })}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t('mje_export.col.session', { defaultValue: 'Session' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      {t('mje_export.no_rows', {
                        defaultValue: 'No events match the selected filters.',
                      })}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.slice(0, 100).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.provider}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.event}</TableCell>
                      <TableCell>
                        {r.reason ? (
                          <Badge variant="secondary">{r.reason}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {r.url_host ?? '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs font-mono text-muted-foreground">
                        {r.session_id ? r.session_id.slice(0, 8) : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {rows.length > 100 && (
            <p className="text-xs text-muted-foreground">
              {t('mje_export.preview_note', {
                defaultValue:
                  'Preview shows the first 100 rows. The CSV export contains all {{count}} matching rows.',
                count: rows.length,
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
