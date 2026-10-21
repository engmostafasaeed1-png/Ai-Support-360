import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Columns3, Filter, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { APP_ROLES, DEFAULT_FILTERS, USER_STATUSES, activeFilterCount, filtersToParams, parseFilters, type UserFilters } from '@/lib/userAdmin';
import { deleteView, saveView, useSavedViews } from '@/hooks/useUserAdmin';
import { roleLabel, statusLabel, verificationLabel } from './labels';

export const ALL_COLUMNS = ['roles', 'status', 'company', 'country', 'verification', 'completion', 'open_tickets', 'providers', 'tags', 'created_at', 'last_active_at'] as const;
export type Column = typeof ALL_COLUMNS[number];
export const DEFAULT_COLUMNS: Column[] = ['roles', 'status', 'company', 'verification', 'created_at', 'last_active_at'];

export function columnLabel(t: (k: string, d: string) => string, c: Column) {
  return ({
    roles: t('um.roles', 'Roles'), status: t('um.status', 'Status'), company: t('um.company', 'Company'), country: t('um.country', 'Country'),
    verification: t('um.verification', 'Verification'), completion: t('um.profile_pct', 'Profile %'), open_tickets: t('um.open_tickets', 'Open tickets'),
    providers: t('um.sign_in_with', 'Signs in with'), tags: t('um.tags', 'Tags'), created_at: t('um.joined', 'Joined'), last_active_at: t('um.last_active', 'Last active'),
  } as Record<Column, string>)[c];
}

const VERIF = ['pending', 'under_review', 'on_hold', 'verified', 'rejected', 'suspended'];
const BADGES = ['Gold', 'Silver', 'Bronze', 'Verified', 'none'];

export default function UsersToolbar({ filters, onChange, installed, searchRef, columns, onColumns }: {
  filters: UserFilters; onChange: (f: UserFilters) => void; installed: boolean; searchRef: RefObject<HTMLInputElement>;
  columns: Column[]; onColumns: (c: Column[]) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState(filters.q);
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [viewName, setViewName] = useState('');
  const views = useSavedViews(installed);
  useEffect(() => { setQ(filters.q); }, [filters.q]);
  useEffect(() => {
    if (q === filters.q) return;
    const h = setTimeout(() => onChange({ ...filters, q, page: 1 }), 250);
    return () => clearTimeout(h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (more) setDraft(filters); }, [more, filters]);

  const tenants = useQuery({
    queryKey: ['um', 'tenants'], enabled: more && installed,
    queryFn: async () => (await supabase.from('tenants').select('id, name').order('name').limit(500)).data ?? [],
  });

  const toggle = (key: 'roles' | 'status', v: string) => {
    const list = filters[key].includes(v) ? filters[key].filter((x) => x !== v) : [...filters[key], v];
    onChange({ ...filters, [key]: list, page: 1 });
  };
  const n = activeFilterCount(filters);
  const set = <K extends keyof UserFilters>(k: K, v: UserFilters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const tri = (k: keyof UserFilters, label: string, yes = t('um.yes', 'Yes'), no = t('um.no', 'No')) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={(draft[k] as string) || 'any'} onValueChange={(v) => set(k, (v === 'any' ? '' : v) as never)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="any">{t('um.any', 'Any')}</SelectItem><SelectItem value="true">{yes}</SelectItem><SelectItem value="false">{no}</SelectItem></SelectContent>
      </Select>
    </div>
  );
  const multi = (k: 'verification' | 'badge', values: string[], label: (v: string) => string, title: string) => (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <label key={v} className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={draft[k].includes(v)} onCheckedChange={(c) => set(k, c ? [...draft[k], v] : draft[k].filter((x) => x !== v))} />{label(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const dateRange = (from: 'active_from' | 'created_from', to: 'active_to' | 'created_to', label: string) => (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex gap-2">
        <Input type="date" aria-label={`${label} ${t('um.from', 'from')}`} value={draft[from]} onChange={(e) => set(from, e.target.value)} />
        <Input type="date" aria-label={`${label} ${t('um.to', 'to')}`} value={draft[to]} onChange={(e) => set(to, e.target.value)} />
      </div>
    </fieldset>
  );

  const currentParams = () => Object.fromEntries(filtersToParams({ ...filters, page: 1 }).entries());

  return (
    <div className="sticky top-0 z-20 -mx-1 space-y-2 rounded-2xl border border-border/60 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Label htmlFor="um-search" className="sr-only">{t('um.search', 'Search people')}</Label>
          <Input id="um-search" ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} className="ps-9 pe-16"
            placeholder={t('um.search_placeholder', 'Search name, e-mail, company, phone or ID…')} />
          <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:block">/</kbd>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setMore(true)} aria-label={t('um.more_filters', 'More filters')}>
            <Filter className="me-1 h-4 w-4" />{t('um.filters', 'Filters')}{n > 0 && <Badge className="ms-1 h-5 px-1.5">{n}</Badge>}
          </Button>
          <Select value={`${filters.sort}:${filters.dir}`} onValueChange={(v) => { const [sort, dir] = v.split(':'); onChange({ ...filters, sort, dir: dir as 'asc' | 'desc', page: 1 }); }}>
            <SelectTrigger className="h-9 w-44" aria-label={t('um.sort', 'Sort')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at:desc">{t('um.sort_newest', 'Newest first')}</SelectItem>
              <SelectItem value="created_at:asc">{t('um.sort_oldest', 'Oldest first')}</SelectItem>
              <SelectItem value="last_active_at:desc">{t('um.sort_active', 'Recently active')}</SelectItem>
              <SelectItem value="last_active_at:asc">{t('um.sort_inactive', 'Least active')}</SelectItem>
              <SelectItem value="name:asc">{t('um.sort_name', 'Name A–Z')}</SelectItem>
              <SelectItem value="email:asc">{t('um.sort_email', 'E-mail A–Z')}</SelectItem>
              {installed && <SelectItem value="completion:asc">{t('um.sort_completion', 'Least complete profile')}</SelectItem>}
              {installed && <SelectItem value="open_tickets:desc">{t('um.sort_tickets', 'Most open tickets')}</SelectItem>}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" aria-label={t('um.columns', 'Columns')}><Columns3 className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('um.columns', 'Columns')}</DropdownMenuLabel>
              {ALL_COLUMNS.map((c) => (
                <DropdownMenuCheckboxItem key={c} checked={columns.includes(c)} onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) => onColumns(v ? ALL_COLUMNS.filter((x) => x === c || columns.includes(x)) : columns.filter((x) => x !== c))}>
                  {columnLabel(t, c)}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator /><DropdownMenuItem onClick={() => onColumns(DEFAULT_COLUMNS)}>{t('um.reset', 'Reset')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {installed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Bookmark className="me-1 h-4 w-4" />{t('um.views', 'Views')}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>{t('um.saved_views', 'My saved views')}</DropdownMenuLabel>
                {(views.data ?? []).map((v) => (
                  <DropdownMenuItem key={v.id} className="justify-between" onClick={() => onChange(parseFilters(new URLSearchParams(v.params)))}>
                    <span className="truncate">{v.name}</span>
                    <button type="button" aria-label={t('um.delete_view', 'Delete view {{name}}', { name: v.name })} className="text-muted-foreground hover:text-destructive"
                      onClick={async (e) => { e.stopPropagation(); await deleteView(v.id); qc.invalidateQueries({ queryKey: ['um', 'views'] }); }}><Trash2 className="h-3.5 w-3.5" /></button>
                  </DropdownMenuItem>
                ))}
                {!views.data?.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('um.no_views', 'No saved views yet')}</p>}
                <DropdownMenuSeparator />
                <form className="flex gap-1 p-1" onSubmit={async (e) => { e.preventDefault(); try { await saveView(viewName, currentParams()); setViewName(''); qc.invalidateQueries({ queryKey: ['um', 'views'] }); toast.success(t('um.view_saved', 'View saved')); } catch (err) { toast.error((err as Error).message); } }}
                  onKeyDown={(e) => e.stopPropagation()}>
                  <Input value={viewName} maxLength={60} onChange={(e) => setViewName(e.target.value)} placeholder={t('um.view_name', 'Name this view')} className="h-8" aria-label={t('um.view_name', 'Name this view')} />
                  <Button type="submit" size="sm" className="h-8" disabled={!viewName.trim()}>{t('common.save', 'Save')}</Button>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('um.quick_filters', 'Quick filters')}>
        {APP_ROLES.map((r) => (
          <Button key={r} size="sm" variant={filters.roles.includes(r) ? 'default' : 'outline'} className="h-7 rounded-full px-3 text-xs" aria-pressed={filters.roles.includes(r)} onClick={() => toggle('roles', r)}>{roleLabel(t, r)}</Button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {USER_STATUSES.filter((s) => installed || s !== 'deleted').map((s) => (
          <Button key={s} size="sm" variant={filters.status.includes(s) ? 'default' : 'outline'} className="h-7 rounded-full px-3 text-xs" aria-pressed={filters.status.includes(s)} onClick={() => toggle('status', s)}>{statusLabel(t, s)}</Button>
        ))}
        {(n > 0 || filters.roles.length > 0 || filters.status.length > 0 || filters.q) && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir, page_size: filters.page_size })}><X className="me-1 h-3 w-3" />{t('um.clear', 'Clear')}</Button>
        )}
      </div>

      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-md">
          <SheetHeader><SheetTitle>{t('um.more_filters', 'More filters')}</SheetTitle>
            <SheetDescription>{installed ? t('um.filters_desc', 'Combine any filters. The address updates so you can share the view.') : t('um.filters_legacy', 'Some filters work only after the prepared database update is applied.')}</SheetDescription></SheetHeader>
          <div className="flex-1 space-y-4 overflow-auto py-4 pe-1">
            <div className="space-y-1.5">
              <Label>{t('um.sign_in_with', 'Signs in with')}</Label>
              <Select value={draft.provider || 'any'} onValueChange={(v) => set('provider', v === 'any' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">{t('um.any', 'Any')}</SelectItem><SelectItem value="email">{t('um.email_password', 'E-mail')}</SelectItem><SelectItem value="google">Google</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {tri('email_verified', t('um.email_verified', 'E-mail verified'))}
              {tri('mfa', t('um.two_step_title', 'Two-step sign-in'), t('um.on', 'On'), t('um.off', 'Off'))}
            </div>
            <div className="space-y-1.5"><Label htmlFor="um-f-country">{t('um.country', 'Country')}</Label><Input id="um-f-country" value={draft.country} onChange={(e) => set('country', e.target.value)} /></div>
            {installed && (
              <div className="space-y-1.5">
                <Label>{t('um.organisation', 'Organisation')}</Label>
                <Select value={draft.org || 'any'} onValueChange={(v) => set('org', v === 'any' ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="any">{t('um.any', 'Any')}</SelectItem>{(tenants.data ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {multi('verification', VERIF, (v) => verificationLabel(t, v), t('um.verification', 'Consultant verification'))}
            {multi('badge', BADGES, (v) => v === 'none' ? t('um.no_badge', 'No badge') : v, t('um.badge', 'Interview badge'))}
            {installed && (
              <div className="grid grid-cols-2 gap-3">
                {tri('founding', t('um.founding', 'Founding consultant'))}
                {tri('policy', t('um.policy', 'Policy confirmed'))}
                {tri('open_tickets', t('um.has_open_tickets', 'Has open tickets'))}
                {tri('payout_ready', t('um.payout_ready', 'Payout details ready'))}
              </div>
            )}
            {installed && (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t('um.completion_range', 'Profile completion (%)')}</legend>
                <div className="flex gap-2">
                  <Input type="number" min={0} max={100} aria-label={t('um.min', 'Minimum')} value={draft.completion_min} onChange={(e) => set('completion_min', e.target.value)} />
                  <Input type="number" min={0} max={100} aria-label={t('um.max', 'Maximum')} value={draft.completion_max} onChange={(e) => set('completion_max', e.target.value)} />
                </div>
              </fieldset>
            )}
            {dateRange('active_from', 'active_to', t('um.last_active', 'Last active'))}
            {dateRange('created_from', 'created_to', t('um.joined', 'Joined'))}
            <div className="space-y-1.5">
              <Label>{t('um.inactive_for', 'Inactive for')}</Label>
              <Select value={draft.inactive_days || 'any'} onValueChange={(v) => set('inactive_days', v === 'any' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">{t('um.any', 'Any')}</SelectItem>{['30', '60', '90', '180', '365'].map((d) => <SelectItem key={d} value={d}>{t('um.days_plus', '{{n}}+ days', { n: d })}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {installed && (
              <div className="space-y-1.5">
                <Label htmlFor="um-f-tags">{t('um.tags', 'Tags')}</Label>
                <Input id="um-f-tags" value={draft.tags.join(', ')} placeholder="vip, archived" onChange={(e) => set('tags', e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))} />
              </div>
            )}
          </div>
          <SheetFooter className="gap-2">
            <Button variant="outline" onClick={() => setDraft({ ...DEFAULT_FILTERS, q: filters.q, roles: filters.roles, status: filters.status })}>{t('um.reset', 'Reset')}</Button>
            <Button onClick={() => { onChange({ ...draft, page: 1 }); setMore(false); }}>{t('um.apply', 'Apply')}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
