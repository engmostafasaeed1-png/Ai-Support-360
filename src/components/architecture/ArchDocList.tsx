import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, LayoutGrid, List, MessageSquare, Plus, Ticket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ARCH_STATUSES, ARCH_TYPES, BLUEPRINT_TYPES, TYPE_TITLES } from '../../../supabase/functions/_shared/archModel';
import { DEFAULT_FILTERS, filterDocs, inGroup, moduleOptions, type ArchFilters, type ArchGroup, type ArchSort } from '@/lib/architecture/listing';
import type { ArchListRow } from '@/lib/architecture/api';
import ArchStatusBadge from './ArchStatusBadge';

interface Props {
  group: ArchGroup;
  rows: ArchListRow[] | undefined;
  loading: boolean;
  error: string | null;
  search: string;
  canCreate: boolean;
  onCreate: () => void;
  onRetry: () => void;
}

/** Blueprints / Design documents tab: the company's own documents with filters, search, sort, cards or table. */
export default function ArchDocList({ group, rows, loading, error, search, canCreate, onCreate, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const [f, setF] = useState<ArchFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const all = rows ?? [];
  const mine = all.filter((r) => inGroup(r, group));
  const list = useMemo(() => filterDocs(all, group, { ...f, search }), [all, group, f, search]);
  const modules = moduleOptions(mine);
  const tickets = Array.from(new Map(mine.flatMap((r) => r.links).map((l) => [l.ticket_id, l])).values());
  const types = ARCH_TYPES.filter((x) => (group === 'blueprints' ? BLUEPRINT_TYPES.includes(x) : !BLUEPRINT_TYPES.includes(x)));
  const date = (s: string) => new Date(s).toLocaleDateString(ar ? 'ar' : 'en-GB', { dateStyle: 'medium' });
  const href = (id: string) => `/client/solution-architecture/${id}`;

  if (loading) return <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>;
  if (error) {
    return (
      <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
        <p className="text-sm text-destructive" role="alert">{t('arch.list.error')}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>{t('arch.common.retry')}</Button>
      </CardContent></Card>
    );
  }
  if (mine.length === 0) {
    return (
      <Card className="rounded-2xl border-dashed"><CardContent className="p-8 text-center space-y-3">
        <FileText className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden />
        <p className="font-medium">{t(group === 'blueprints' ? 'arch.list.emptyBlueprints' : 'arch.list.emptyDesign')}</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('arch.list.startFromBrd')}</p>
        {canCreate && <Button onClick={onCreate} className="gap-1.5"><Plus className="h-4 w-4" /> {t('arch.newDocument')}</Button>}
      </CardContent></Card>
    );
  }

  const set = <K extends keyof ArchFilters>(k: K, v: ArchFilters[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('arch.list.filters')}>
        {types.length > 1 && (
          <Select value={f.type} onValueChange={(v) => set('type', v as ArchFilters['type'])}>
            <SelectTrigger className="h-8 w-48" aria-label={t('arch.fields.type')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('arch.list.allTypes')}</SelectItem>
              {types.map((x) => <SelectItem key={x} value={x}>{TYPE_TITLES[x][ar ? 'ar' : 'en']}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={f.status} onValueChange={(v) => set('status', v as ArchFilters['status'])}>
          <SelectTrigger className="h-8 w-40" aria-label={t('arch.fields.status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('arch.list.allStatuses')}</SelectItem>
            {ARCH_STATUSES.filter((s) => s !== 'archived').map((s) => <SelectItem key={s} value={s}>{t(`arch.status.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        {modules.length > 0 && (
          <Select value={f.module} onValueChange={(v) => set('module', v)}>
            <SelectTrigger className="h-8 w-40" aria-label={t('arch.fields.module')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('arch.list.allModules')}</SelectItem>
              {modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {tickets.length > 0 && (
          <Select value={f.ticket} onValueChange={(v) => set('ticket', v)}>
            <SelectTrigger className="h-8 w-48" aria-label={t('arch.fields.tickets')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('arch.list.allTickets')}</SelectItem>
              {tickets.map((l) => <SelectItem key={l.ticket_id} value={l.ticket_id}>{l.ref} · {l.title.slice(0, 40)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={f.sort} onValueChange={(v) => set('sort', v as ArchSort)}>
          <SelectTrigger className="h-8 w-44" aria-label={t('arch.list.sort')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['updated', 'created', 'title', 'status'] as const).map((s) => <SelectItem key={s} value={s}>{t(`arch.list.sort_${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ms-auto flex gap-1">
          <Button size="icon" variant={view === 'cards' ? 'secondary' : 'ghost'} className="h-8 w-8" aria-label={t('arch.list.cards')} aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid className="h-4 w-4" /></Button>
          <Button size="icon" variant={view === 'table' ? 'secondary' : 'ghost'} className="h-8 w-8" aria-label={t('arch.list.table')} aria-pressed={view === 'table'} onClick={() => setView('table')}><List className="h-4 w-4" /></Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">{t('arch.list.count', { count: list.length })}</p>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{t('arch.list.noMatch')}</p>
      ) : view === 'cards' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => (
            <Link key={r.id} to={href(r.id)} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="rounded-2xl h-full transition-shadow group-hover:shadow-md">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">{TYPE_TITLES[r.type][ar ? 'ar' : 'en']}</Badge>
                    <ArchStatusBadge status={r.status} />
                  </div>
                  <p className="font-semibold leading-snug line-clamp-2">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{[r.sap_area, r.sap_module, r.sap_version].filter(Boolean).join(' · ') || '—'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{r.latest_version ? `v${r.latest_version}` : t('arch.list.noVersion')}</span>
                    <span>{t('arch.list.updated', { date: date(r.updated_at) })}</span>
                    {r.links.length > 0 && <span className="inline-flex items-center gap-1"><Ticket className="h-3 w-3" aria-hidden />{r.links.length}</span>}
                    {r.open_comments > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" aria-hidden />{r.open_comments}</span>}
                    {r.confidentiality === 'shared' && <Badge variant="secondary" className="text-[10px]">{t('arch.conf.sharedShort')}</Badge>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{t(group === 'blueprints' ? 'arch.tabs.blueprints' : 'arch.tabs.design')}</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-start p-2">{t('arch.fields.title')}</th><th className="text-start p-2">{t('arch.fields.type')}</th>
                <th className="text-start p-2">{t('arch.fields.module')}</th><th className="text-start p-2">{t('arch.fields.status')}</th>
                <th className="text-start p-2">{t('arch.versions.version')}</th><th className="text-start p-2">{t('arch.fields.tickets')}</th>
                <th className="text-start p-2">{t('arch.list.sort_updated')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-2"><Link to={href(r.id)} className="font-medium text-primary hover:underline">{r.title}</Link></td>
                  <td className="p-2">{TYPE_TITLES[r.type].short}</td>
                  <td className="p-2">{r.sap_module || r.sap_area || '—'}</td>
                  <td className="p-2"><ArchStatusBadge status={r.status} /></td>
                  <td className="p-2">{r.latest_version ? `v${r.latest_version}` : '—'}</td>
                  <td className="p-2">{r.links.map((l) => l.ref).join(', ') || '—'}</td>
                  <td className="p-2 whitespace-nowrap">{date(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
