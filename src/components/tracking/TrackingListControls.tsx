import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Bookmark, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { deriveStage, needsMyAction, statusLabel, type ListFilter, type SavedFilter, type TrackingSettings, type TrackingSummary } from '@/lib/ticketTracking';
import { StageChip, WorkingStatusChip } from './TrackingChips';

interface Props {
  settings: TrackingSettings;
  filter: ListFilter;
  setFilter: (f: ListFilter) => void;
  needsCount: number;
  saved: SavedFilter[];
  saveCurrent: (name: string) => void;
  removeSaved: (name: string) => void;
  showNeedsMe?: boolean;
}

/** Filter by working status, "Needs my action" (with count), sort, and saved filters. */
export default function TrackingListControls({ settings, filter, setFilter, needsCount, saved, saveCurrent, removeSaved, showNeedsMe = true }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const [name, setName] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="tracking-list-controls">
      {showNeedsMe && (
        <Button size="sm" variant={filter.needsMe ? 'default' : 'outline'} aria-pressed={filter.needsMe} className={cn('h-8 gap-1.5 rounded-full text-xs', filter.needsMe && 'gradient-primary border-0')}
          onClick={() => setFilter({ ...filter, needsMe: !filter.needsMe })}>
          <BellRing className="h-3.5 w-3.5" /> {t('tracking.list.needsMe')}
          <span className="rounded-full bg-background/80 px-1.5 text-[10px] font-semibold text-foreground">{needsCount}</span>
        </Button>
      )}
      <Select value={filter.working} onValueChange={(v) => setFilter({ ...filter, working: v })}>
        <SelectTrigger className="h-8 w-[200px] rounded-full text-xs" aria-label={t('tracking.list.byWorking')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('tracking.list.allWorking')}</SelectItem>
          {settings.statuses.filter((s) => s.enabled).map((s) => <SelectItem key={s.key} value={s.key}>{statusLabel(settings, s.key, lang)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filter.sort} onValueChange={(v) => setFilter({ ...filter, sort: v as ListFilter['sort'] })}>
        <SelectTrigger className="h-8 w-[180px] rounded-full text-xs" aria-label={t('tracking.list.sort')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {(['default', 'waiting_me', 'working', 'changed'] as const).map((s) => <SelectItem key={s} value={s}>{t(`tracking.list.sort_${s}`)}</SelectItem>)}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full text-xs"><Bookmark className="h-3.5 w-3.5" /> {t('tracking.list.saved')}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">{t('tracking.list.saved')}</DropdownMenuLabel>
          {saved.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('tracking.list.noSaved')}</p>}
          {saved.map((s) => (
            <DropdownMenuItem key={s.name} className="flex items-center justify-between gap-2 text-xs" onSelect={() => setFilter(s.filter)}>
              <span className="truncate">{s.name}</span>
              <button type="button" aria-label={t('tracking.list.remove', { name: s.name })} className="rounded p-1 hover:bg-muted"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeSaved(s.name); }}>
                <Trash2 className="h-3 w-3" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <form className="flex gap-1 p-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { saveCurrent(name); setName(''); } }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('tracking.list.saveName')} className="h-7 text-xs"
              onKeyDown={(e) => e.stopPropagation()} aria-label={t('tracking.list.saveName')} />
            <Button type="submit" size="sm" className="h-7 text-xs">{t('tracking.list.save')}</Button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The two chips on a list row + "Needs my action". */
export function TrackingRowChips({ summary, settings }: { summary: TrackingSummary | undefined; settings: TrackingSettings | undefined }) {
  const { t } = useTranslation();
  if (!summary || !settings) return null;
  const derived = deriveStage(summary.facts);
  const mine = needsMyAction(summary, settings);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StageChip derived={derived} />
      <WorkingStatusChip working={summary.facts.working} settings={settings} />
      {mine && (
        <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-foreground">
          <BellRing className="h-3 w-3 text-accent" aria-hidden /> {t('tracking.list.needsMeBadge')}
        </span>
      )}
    </span>
  );
}
