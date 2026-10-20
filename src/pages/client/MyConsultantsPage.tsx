import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Heart, Search, Plus, Download, Ban, StickyNote, ArrowUp, ArrowDown, Archive, ArchiveRestore, Pencil, Trash2, X, Users, Info, UserX, Tag, FolderPlus, FolderMinus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useRealtimeConsultants } from '@/hooks/useRealtimeConsultants';
import { usePublicResponsiveness } from '@/hooks/useResponsiveness';
import { useClientFavourites } from '@/hooks/useClientFavourites';
import ResponsivenessChip from '@/components/consultant/ResponsivenessChip';
import { STATE_META } from '@/lib/mapMarkers';
import { FAMILY_OPTIONS, MODULE_OPTIONS } from '@/lib/directoryFilters';
import { LEVEL_LABEL } from '@/lib/responsivenessFormat';
import { LEVEL_ORDER, type RespLevel } from '../../../supabase/functions/_shared/responsiveness';
import {
  DEFAULT_MY_FILTERS, favouriteErrorKey, filterMyConsultants, moveGroup, myConsultantsCsv, orderedGroups, systemCategories,
  type ConsultantGroup, type MyFilters, type MyRow,
} from '@/lib/clientFavourites';
import { GroupBadge, GroupIcon } from '@/components/favourites/GroupIcon';
import GroupEditorDialog, { type GroupDraftValue } from '@/components/favourites/GroupEditorDialog';
import NoteDialog from '@/components/favourites/NoteDialog';

const ALL = '__all';

function usePastWorkIds(enabled: boolean) {
  return useQuery({
    queryKey: ['client-past-work-consultants'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Set<string>> => {
      // Tickets the client (or their company) may see under the existing rules, with the consultant who worked on them.
      const { data, error } = await supabase.from('tickets').select('consultant_id').not('consultant_id', 'is', null).limit(1000);
      if (error) return new Set();
      return new Set((data ?? []).map((r: { consultant_id: string | null }) => r.consultant_id).filter(Boolean) as string[]);
    },
  });
}

export default function MyConsultantsPage() {
  const { t, i18n } = useTranslation();
  const ar = !!i18n.language?.startsWith('ar');
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const fav = useClientFavourites();
  const { consultants, isLoading: consultantsLoading } = useRealtimeConsultants();
  const { byId: respById } = usePublicResponsiveness();
  const pastWork = usePastWorkIds(fav.ready);

  const [filters, setFilters] = useState<MyFilters>(DEFAULT_MY_FILTERS);
  const set = (patch: Partial<MyFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkGroup, setBulkGroup] = useState('');
  const [bulkTag, setBulkTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState<MyRow | null>(null);
  const [editing, setEditing] = useState<ConsultantGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ConsultantGroup | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Only consultants the client may see today (verified, not hidden, visible): everything else is "no longer available".
  const visible = useMemo(() => new Map(consultants.filter((c) => c.verification_status === 'verified').map((c) => [c.id, c])), [consultants]);
  const groups = useMemo(() => orderedGroups(fav.groups), [fav.groups]);
  const groupName = (id: string) => fav.groups.find((g) => g.id === id)?.name ?? '';
  const rows: MyRow[] = useMemo(() => [...fav.favourites.values()].map((f) => ({
    consultantId: f.consultant_id,
    consultant: visible.get(f.consultant_id) ?? null,
    addedAt: f.created_at,
    tags: f.tags,
    groups: fav.groups.filter((g) => g.members.includes(f.consultant_id)).map((g) => g.id),
    note: fav.notes.get(f.consultant_id) ?? null,
    pastWork: pastWork.data?.has(f.consultant_id) ?? false,
    level: respById.get(f.consultant_id)?.level ?? 'new',
  })), [fav.favourites, fav.groups, fav.notes, visible, pastWork.data, respById]);
  const shown = useMemo(() => filterMyConsultants(rows, filters), [rows, filters]);
  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort(), [rows]);
  const countries = useMemo(() => [...new Set(rows.map((r) => r.consultant?.country).filter(Boolean) as string[])].sort(), [rows]);
  const badges = useMemo(() => [...new Set(rows.flatMap((r) => (r.consultant ? systemCategories(r.consultant).badges : [])))].sort(), [rows]);
  const selectedIds = [...selected].filter((id) => fav.favourites.has(id));

  const act = async (job: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await job();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(t(`fav.err.${favouriteErrorKey((err as Error).message)}`));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const list = selectedIds.length ? shown.filter((r) => selected.has(r.consultantId)) : shown;
    const csv = myConsultantsCsv(list, groupName, {
      name: t('fav.csv.name'), groups: t('fav.csv.groups'), tags: t('fav.csv.tags'), status: t('fav.csv.status'),
      available: t('fav.csv.available'), unavailable: t('fav.unavailable_name'),
    });
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-consultants.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveGroup = (v: GroupDraftValue) => act(async () => {
    if (editing === 'new') await fav.createGroup(v);
    else if (editing) await fav.updateGroup(editing.id, v);
    setEditing(null);
  }, t('fav.group_saved'));

  const onDrop = (groupId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData('text/consultant-id');
    if (!id) return;
    const ids = selected.has(id) ? selectedIds : [id];
    void act(() => fav.addToGroup(groupId, ids), t('fav.added_to_group', { count: ids.length, group: groupName(groupId) }));
  };

  const levelLabel = (l: RespLevel) => (ar ? LEVEL_LABEL[l][1] : LEVEL_LABEL[l][0]);
  const activeGroups = groups.filter((g) => !g.archived_at);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground md:text-2xl">
            <Heart className="h-6 w-6 text-destructive" aria-hidden="true" />
            {t('fav.page_title')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground md:text-sm">{t('fav.page_subtitle')}</p>
          {fav.ready && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              {fav.isOrganisation
                ? (fav.canEdit ? t('fav.scope_org_edit', { org: tenant?.name ?? '' }) : t('fav.scope_org_read', { org: tenant?.name ?? '' }))
                : t('fav.scope_personal')}
            </p>
          )}
        </div>
        {fav.ready && fav.canEdit && (
          <Button size="sm" className="gap-1.5" onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden="true" />{t('fav.new_group')}</Button>
        )}
      </div>

      {fav.loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : !fav.ready ? (
        <Card className="rounded-2xl"><CardContent className="flex items-start gap-3 p-6">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div><p className="font-medium text-foreground">{t('fav.not_ready_title')}</p><p className="mt-1 text-sm text-muted-foreground">{t('fav.not_ready_body')}</p></div>
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="consultants" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="consultants">{t('fav.tab_consultants')} ({fav.favourites.size})</TabsTrigger>
            <TabsTrigger value="groups">{t('fav.tab_groups')} ({activeGroups.length})</TabsTrigger>
            <TabsTrigger value="blocked">{t('fav.tab_blocked')} ({fav.blocked.size})</TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------------- consultants */}
          <TabsContent value="consultants" className="space-y-3">
            {activeGroups.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label={t('fav.filter_group')}>
                <button type="button" aria-pressed={!filters.group} onClick={() => set({ group: '' })}
                  className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', !filters.group ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                  {t('fav.all_groups')}
                </button>
                {activeGroups.map((g) => (
                  <button key={g.id} type="button" aria-pressed={filters.group === g.id} onClick={() => set({ group: filters.group === g.id ? '' : g.id })}
                    onDragOver={fav.canEdit ? (e) => { e.preventDefault(); setDropTarget(g.id); } : undefined}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={fav.canEdit ? (e) => onDrop(g.id, e) : undefined}
                    className={cn('rounded-full transition-shadow', filters.group === g.id && 'ring-2 ring-primary ring-offset-1', dropTarget === g.id && 'ring-2 ring-accent ring-offset-2')}>
                    <GroupBadge group={g} count={g.members.length} />
                  </button>
                ))}
              </div>
            )}
            {fav.canEdit && activeGroups.length > 0 && <p className="hidden text-xs text-muted-foreground md:block">{t('fav.drag_hint')}</p>}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative sm:col-span-2">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('fav.search')} aria-label={t('fav.search')} className="ps-9" />
              </div>
              <FilterSelect label={t('fav.filter_area')} value={filters.area} onChange={(v) => set({ area: v, module: '' })}
                options={FAMILY_OPTIONS.map((f) => ({ value: f.value, label: ar ? f.label[1] : f.label[0] }))} />
              <FilterSelect label={t('fav.filter_module')} value={filters.module} onChange={(v) => set({ module: v })}
                options={MODULE_OPTIONS.filter((m) => !filters.area || m.family === filters.area).map((m) => ({ value: m.value, label: m.label }))} />
              <FilterSelect label={t('fav.filter_tag')} value={filters.tag} onChange={(v) => set({ tag: v })} options={allTags.map((x) => ({ value: x, label: x }))} />
              <FilterSelect label={t('fav.filter_country')} value={filters.country} onChange={(v) => set({ country: v })} options={countries.map((x) => ({ value: x, label: x }))} />
              <FilterSelect label={t('fav.filter_badge')} value={filters.badge} onChange={(v) => set({ badge: v })} options={badges.map((x) => ({ value: x, label: t(`fav.badge.${x}`, x) }))} />
              <FilterSelect label={t('fav.filter_availability')} value={filters.availability === 'all' ? '' : filters.availability} onChange={(v) => set({ availability: (v || 'all') as MyFilters['availability'] })}
                options={(['available', 'busy', 'offline'] as const).map((s) => ({ value: s, label: t(`directory.status_${s === 'available' ? 'online' : s}`, STATE_META[s].label) }))} />
              <FilterSelect label={t('fav.filter_rating')} value={filters.minRating ? String(filters.minRating) : ''} onChange={(v) => set({ minRating: Number(v) || 0 })}
                options={['3', '4', '4.5'].map((x) => ({ value: x, label: `${x}+` }))} />
              <FilterSelect label={t('fav.filter_responsiveness')} value={filters.level === 'all' ? '' : filters.level} onChange={(v) => set({ level: (v || 'all') as MyFilters['level'] })}
                options={LEVEL_ORDER.map((l) => ({ value: l, label: levelLabel(l) }))} />
              <FilterSelect label={t('fav.sort')} value={filters.sort} allowAll={false} onChange={(v) => set({ sort: (v || 'recent') as MyFilters['sort'] })}
                options={(['recent', 'name', 'rating', 'responsiveness', 'availability'] as const).map((s) => ({ value: s, label: t(`fav.sort_${s}`) }))} />
              <label className="flex items-center gap-2 rounded-md border border-input px-3 text-sm">
                <Checkbox checked={filters.pastWork} onCheckedChange={(v) => set({ pastWork: !!v })} />
                {t('fav.filter_past_work')}
              </label>
              <Button variant="ghost" size="sm" className="justify-start gap-1" onClick={() => setFilters(DEFAULT_MY_FILTERS)}><X className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.clear_filters')}</Button>
            </div>

            {/* bulk actions */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-2" role="toolbar" aria-label={t('fav.bulk')}>
              <span className="px-1 text-xs text-muted-foreground" aria-live="polite">{t('fav.selected', { count: selectedIds.length })}</span>
              {fav.canEdit && (
                <>
                  <Select value={bulkGroup} onValueChange={setBulkGroup}>
                    <SelectTrigger className="h-8 w-44 text-xs" aria-label={t('fav.choose_group')}><SelectValue placeholder={t('fav.choose_group')} /></SelectTrigger>
                    <SelectContent>{activeGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!bulkGroup || !selectedIds.length || busy}
                    onClick={() => act(() => fav.addToGroup(bulkGroup, selectedIds), t('fav.added_to_group', { count: selectedIds.length, group: groupName(bulkGroup) }))}>
                    <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.add_to_group')}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!bulkGroup || !selectedIds.length || busy}
                    onClick={() => act(() => fav.removeFromGroup(bulkGroup, selectedIds), t('fav.removed_from_group', { group: groupName(bulkGroup) }))}>
                    <FolderMinus className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.remove_from_group')}
                  </Button>
                  <Input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder={t('fav.tag_ph')} aria-label={t('fav.tag_ph')} className="h-8 w-32 text-xs" maxLength={30} />
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!bulkTag.trim() || !selectedIds.length || busy}
                    onClick={() => act(async () => { await fav.tagMany(selectedIds, bulkTag); setBulkTag(''); }, t('fav.tagged'))}>
                    <Tag className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.tag')}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-xs text-destructive" disabled={!selectedIds.length || busy} onClick={() => setConfirmRemove(selectedIds)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.remove')}
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" className="ms-auto h-8 gap-1 text-xs" onClick={exportCsv} disabled={shown.length === 0}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />{selectedIds.length ? t('fav.export_selected') : t('fav.export')}
              </Button>
            </div>

            {consultantsLoading ? (
              <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
            ) : fav.favourites.size === 0 ? (
              <Card className="rounded-2xl"><CardContent className="space-y-2 p-8 text-center">
                <Heart className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t('fav.empty')}</p>
                <Button asChild size="sm" variant="outline"><Link to="/client/consultants">{t('fav.browse')}</Link></Button>
              </CardContent></Card>
            ) : shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('fav.no_match')}</p>
            ) : (
              <ul className="space-y-2" aria-label={t('fav.tab_consultants')}>
                <li className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
                  <Checkbox
                    checked={shown.length > 0 && shown.every((r) => selected.has(r.consultantId))}
                    onCheckedChange={(v) => setSelected(v ? new Set(shown.map((r) => r.consultantId)) : new Set())}
                    aria-label={t('fav.select_all')}
                  />
                  {t('fav.select_all')}
                </li>
                {shown.map((r) => {
                  const c = r.consultant;
                  return (
                    <li key={r.consultantId}
                      draggable={fav.canEdit && !!c}
                      onDragStart={(e) => e.dataTransfer.setData('text/consultant-id', r.consultantId)}
                      data-testid="my-consultant-row" data-available={!!c}
                      className={cn('flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center', c ? 'border-border bg-card' : 'border-dashed border-border bg-muted/30')}>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Checkbox checked={selected.has(r.consultantId)} aria-label={c?.name ?? t('fav.unavailable_name')}
                          onCheckedChange={(v) => setSelected((prev) => { const next = new Set(prev); if (v) next.add(r.consultantId); else next.delete(r.consultantId); return next; })} />
                        {c ? (
                          <>
                            <div className="relative shrink-0">
                              <div className="gradient-primary flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-primary-foreground">{c.avatar}</div>
                              <span className={cn('absolute -end-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card', STATE_META[c.status].dot)} aria-hidden="true" />
                            </div>
                            <div className="min-w-0 space-y-1">
                              <p className="truncate font-medium text-foreground">{c.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{c.specialty}{c.place ? ` · ${c.place}` : ''}</p>
                              <div className="flex flex-wrap items-center gap-1">
                                {r.groups.map((gid) => { const g = fav.groups.find((x) => x.id === gid); return g ? <GroupBadge key={gid} group={g} /> : null; })}
                                {r.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>)}
                                <ResponsivenessChip consultantId={c.id} />
                                {r.pastWork && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{t('fav.past_work_chip')}</span>}
                              </div>
                              {r.note && <p className="line-clamp-1 text-xs italic text-muted-foreground">{r.note}</p>}
                            </div>
                          </>
                        ) : (
                          <div className="flex min-w-0 items-center gap-3 text-muted-foreground">
                            <UserX className="h-10 w-10 shrink-0 rounded-xl bg-muted p-2" aria-hidden="true" />
                            <div><p className="font-medium">{t('fav.unavailable_name')}</p><p className="text-xs">{t('fav.unavailable_body')}</p></div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c && (
                          <>
                            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setNoteFor(r)}>
                              <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />{r.note || r.tags.length ? t('fav.note_edit') : t('fav.note_add')}
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate(`/client/consultants/${c.id}`)}>{t('consultants_page.view_profile', 'View profile')}</Button>
                          </>
                        )}
                        {fav.canEdit && c && (
                          <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-muted-foreground" onClick={() => act(() => fav.block(r.consultantId), t('fav.blocked_done'))}>
                            <Ban className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.block')}
                          </Button>
                        )}
                        {fav.canEdit && (
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" aria-label={t('fav.remove_label', { name: c?.name ?? t('fav.unavailable_name') })}
                            onClick={() => setConfirmRemove([r.consultantId])}>
                            <Heart className="h-4 w-4 fill-current" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          {/* ---------------------------------------------------------- groups */}
          <TabsContent value="groups" className="space-y-2">
            {groups.length === 0 ? (
              <Card className="rounded-2xl"><CardContent className="space-y-2 p-8 text-center">
                <Users className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t('fav.no_groups_yet')}</p>
                {fav.canEdit && <Button size="sm" onClick={() => setEditing('new')}>{t('fav.new_group')}</Button>}
              </CardContent></Card>
            ) : (
              <ul className="space-y-2">
                {groups.map((g, i) => (
                  <li key={g.id} data-testid="group-row" className={cn('flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center', g.archived_at ? 'border-dashed bg-muted/30' : 'border-border bg-card')}>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <GroupBadge group={g} count={g.members.length} />
                        {g.archived_at && <span className="text-xs text-muted-foreground">{t('fav.archived')}</span>}
                      </div>
                      {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                      {g.preferred_areas.length > 0 && <p className="text-xs text-muted-foreground">{t('fav.preferred_for', { areas: g.preferred_areas.join(', ') })}</p>}
                    </div>
                    {fav.canEdit && (
                      <div className="flex flex-wrap items-center gap-1">
                        {!g.archived_at && (
                          <>
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('fav.move_up', { name: g.name })} disabled={i === 0 || busy}
                              onClick={() => act(() => fav.reorderGroups(moveGroup(fav.groups, g.id, -1)))}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('fav.move_down', { name: g.name })} disabled={i === activeGroups.length - 1 || busy}
                              onClick={() => act(() => fav.reorderGroups(moveGroup(fav.groups, g.id, 1)))}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setEditing(g)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.edit')}</Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" disabled={busy}
                          onClick={() => act(() => fav.updateGroup(g.id, { archived_at: g.archived_at ? null : new Date().toISOString() }), g.archived_at ? t('fav.unarchived') : t('fav.archived_done'))}>
                          {g.archived_at ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                          {g.archived_at ? t('fav.unarchive') : t('fav.archive')}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-destructive" onClick={() => setDeleting(g)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('fav.delete')}</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* ---------------------------------------------------------- do not suggest */}
          <TabsContent value="blocked" className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('fav.blocked_hint')}</p>
            {fav.blocked.size === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('fav.blocked_empty')}</p>
            ) : (
              <ul className="space-y-2">
                {[...fav.blocked].map((id) => {
                  const c = visible.get(id);
                  return (
                    <li key={id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                      <Ban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm">{c?.name ?? t('fav.unavailable_name')}</span>
                      {fav.canEdit && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => act(() => fav.unblock(id), t('fav.unblocked'))}>{t('fav.unblock')}</Button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      )}

      <GroupEditorDialog
        open={editing !== null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        group={editing && editing !== 'new' ? editing : null}
        otherNames={fav.groups.filter((g) => editing === 'new' || !editing || g.id !== editing.id).map((g) => g.name)}
        onSave={saveGroup}
        saving={busy}
      />
      {noteFor && (
        <NoteDialog
          open
          onOpenChange={(v) => { if (!v) setNoteFor(null); }}
          name={noteFor.consultant?.name ?? ''}
          note={noteFor.note ?? ''}
          tags={noteFor.tags}
          readOnly={!fav.canEdit}
          saving={busy}
          onSave={(note, tags) => act(async () => {
            await fav.saveNote(noteFor.consultantId, note);
            await fav.setTags(noteFor.consultantId, tags);
            setNoteFor(null);
          }, t('fav.note_saved'))}
        />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fav.delete_group_title', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('fav.delete_group_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const g = deleting; setDeleting(null); if (g) void act(() => fav.deleteGroup(g.id), t('fav.group_deleted')); }}>{t('fav.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!confirmRemove} onOpenChange={(v) => { if (!v) setConfirmRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fav.remove_title', { count: confirmRemove?.length ?? 0 })}</AlertDialogTitle>
            <AlertDialogDescription>{t('fav.remove_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const ids = confirmRemove ?? [];
              setConfirmRemove(null);
              void act(async () => { await fav.removeFavourites(ids); setSelected(new Set()); }, t('fav.removed_many', { count: ids.length }));
            }}>{t('fav.remove')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, allowAll = true }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; allowAll?: boolean }) {
  const { t } = useTranslation();
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger aria-label={label} className="text-sm"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>{label}: {t('fav.any')}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{allowAll ? o.label : `${label}: ${o.label}`}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
