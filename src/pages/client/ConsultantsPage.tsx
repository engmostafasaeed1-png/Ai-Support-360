import FoundingBadge from '@/components/consultant/FoundingBadge';
import { useFoundingConsultants, useFoundingBoost } from '@/hooks/useFoundingConsultants';
import { foundingTieBreak } from '@/lib/foundingConsultants';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Search, Star, BadgeCheck, Zap, Heart, Filter, Map, LayoutGrid,
  Wifi, WifiOff, X, ChevronDown, ChevronUp, Clock, Globe, DollarSign,
  Users, Circle, Award, ShieldAlert, ShieldCheck, ShieldQuestion, MapPin,
} from 'lucide-react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useTranslation } from 'react-i18next';
import { useRealtimeConsultants } from '@/hooks/useRealtimeConsultants';
import ConsultantMap from '@/components/client/ConsultantMap';
import RatingStars from '@/components/client/RatingStars';
import { sapModules } from '@/data/clientMockData';
import VerificationBadge from '@/components/consultant/VerificationBadge';
import { TrustBadge } from '@/components/consultant/TrustBadge';
import CompletionBadge from '@/components/consultant/CompletionBadge';
import LinkStatus from '@/components/consultant/LinkStatus';
import { STATE_META } from '@/lib/mapMarkers';
import { compareRecommended, type ConsultantLive } from '@/lib/consultantDirectory';
import {
  DEFAULT_FILTERS, PREDICATES, countActive, directoryMatches, facetCounts, parseFilters, passes, serializeFilters, sortDirectory,
  type Bounds, type DirectoryContext, type DirectoryFilters,
} from '@/lib/directoryFilters';
import { deleteSaved, loadSaved, saveFilter, type SavedFilter } from '@/lib/savedFilters';
import DirectoryFilterPanel from '@/components/client/DirectoryFilterPanel';
import MatchWhyChips from '@/components/match/MatchWhyChips';
import { chipText } from '@/lib/matchLabels';

const badgeConfig: Record<string, { icon: typeof Star; color: string }> = {
  verified: { icon: BadgeCheck, color: 'text-accent' },
  top_rated: { icon: Star, color: 'text-yellow-500' },
  fast_responder: { icon: Zap, color: 'text-green-500' },
  credly: { icon: Award, color: 'text-orange-500' },
};

const languages = [
  { value: 'all', label: 'All Languages' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
];

type SortOption = DirectoryFilters['sort'];

export default function ConsultantsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // Every filter, the sort and the view live in the URL, so a search can be shared or bookmarked.
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const update = useCallback((patch: Partial<DirectoryFilters>) => {
    setSearchParams(prev => serializeFilters({ ...parseFilters(prev), ...patch }), { replace: true });
  }, [setSearchParams]);

  const [search, setSearch] = useState(filters.q);
  const debouncedSearch = useDebounce(search, 300);
  useEffect(() => { if (debouncedSearch !== filters.q) update({ q: debouncedSearch }); }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = filters.view === 'map' ? 'map' : 'grid';
  const [showFilters, setShowFilters] = useState(false);
  const [mapSelectedId, setMapSelectedId] = useState<string | null>(null);
  const [movedBounds, setMovedBounds] = useState<Bounds | null>(null);
  const [saved, setSaved] = useState<SavedFilter[]>(() => loadSaved());

  const { consultants, realtimeConnected } = useRealtimeConsultants();
  const { data: foundingAwards } = useFoundingConsultants();
  const { data: foundingMonths = 0 } = useFoundingBoost();
  const foundingSet = useMemo(() => new Set<string>(foundingAwards ? [...foundingAwards.keys()] : []), [foundingAwards]);
  const ctx = useMemo<DirectoryContext>(() => ({ founding: foundingSet, viewerOffset: -new Date().getTimezoneOffset() / 60 }), [foundingSet]);

  // Auto-scroll side list when a map marker is clicked
  useEffect(() => {
    if (mapSelectedId) {
      const el = document.getElementById(`map-list-${mapSelectedId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [mapSelectedId]);

  const statusCounts = useMemo(() => facetCounts(consultants, filters, 'status', ['all', 'online', 'busy', 'offline'], ctx), [consultants, filters, ctx]);

  const tieBreak = useCallback((a: ConsultantLive, b: ConsultantLive) =>
    foundingTieBreak(foundingAwards?.get(a.id), foundingAwards?.get(b.id), foundingMonths) || compareRecommended(a, b), [foundingAwards, foundingMonths]);

  // All filters except the map area (the map keeps every pin so the person can move around), then the area for the list.
  const withoutArea = useMemo(() => consultants.filter(c => passes(c, filters, ctx, 'bbox')), [consultants, filters, ctx]);
  const matches = useMemo(() => directoryMatches(withoutArea, filters, foundingSet), [withoutArea, filters, foundingSet]);
  const filtered = useMemo(
    () => sortDirectory(withoutArea.filter(c => !filters.bbox || (PREDICATES.bbox?.(c, filters, ctx) ?? true)), filters, matches, tieBreak),
    [withoutArea, filters, ctx, matches, tieBreak],
  );
  const mapMatches = useMemo(() => {
    if (!matches) return null;
    const ar = document.documentElement.lang?.startsWith('ar');
    return new Map([...matches].map(([id, m]) => [id, { score: m.score, chips: m.chips.map(ch => chipText(ch.key, ch.text, !!ar)) }]));
  }, [matches]);

  const noLocation = withoutArea.filter(c => c.lat === null || c.lng === null);
  const activeFilterCount = countActive(filters);
  const areaChanged = !!movedBounds && (!filters.bbox || movedBounds.some((v, i) => Math.abs(v - (filters.bbox as Bounds)[i]) > 0.001));

  const clearFilters = () => {
    setSearch('');
    setMovedBounds(null);
    setSearchParams(serializeFilters({ ...DEFAULT_FILTERS, view: filters.view, sort: filters.sort }), { replace: true });
  };

  const statusButtons: Array<{ key: DirectoryFilters['status']; label: string; dot?: string; cls: string }> = [
    { key: 'all', label: t('directory.status_all', 'All'), cls: 'bg-primary/10 text-primary border border-primary/20' },
    { key: 'online', label: t('directory.status_online', 'Online'), dot: 'fill-green-500 text-green-500', cls: 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
    { key: 'busy', label: t('directory.status_busy', 'Busy'), dot: 'fill-amber-500 text-amber-500', cls: 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800' },
    { key: 'offline', label: t('directory.status_offline', 'Offline'), dot: 'fill-muted-foreground/40 text-muted-foreground/40', cls: 'bg-muted text-foreground border border-border' },
  ];

  const invite = (id: string) => navigate(`/client/new-request?invite=${encodeURIComponent(id)}`);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">{t('consultants_page.title')}</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">{t('consultants_page.subtitle')}</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium ${realtimeConnected ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
          {realtimeConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {realtimeConnected ? t('consultants_page.live') : t('consultants_page.connecting')}
        </div>
      </div>

      {/* Online/Offline Status Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label={t('directory.status', 'Status')}>
        {statusButtons.map(b => (
          <button
            key={b.key}
            type="button"
            aria-pressed={filters.status === b.key}
            onClick={() => update({ status: filters.status === b.key ? 'all' : b.key })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium transition-all whitespace-nowrap ${filters.status === b.key ? b.cls : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
          >
            {b.dot ? <Circle className={`w-3 h-3 ${b.dot}`} /> : <Users className="w-3.5 h-3.5" />}
            {b.label} ({statusCounts.get(b.key) ?? 0})
          </button>
        ))}
      </div>

      {/* Search + Filter toggle + View */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t('consultants_page.search_placeholder')} aria-label={t('directory.keyword', 'Keyword search')} value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} className="ps-9 rounded-xl h-10 text-sm" />
        </div>
        <Button
          variant={showFilters ? 'default' : 'outline'}
          size="sm"
          className="gap-1 h-10"
          aria-expanded={showFilters}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('consultants_page.filters')}</span>
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-5 w-5 p-0 flex items-center justify-center text-[10px] rounded-full bg-primary text-primary-foreground">
              {activeFilterCount}
            </Badge>
          )}
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </Button>

        {/* Sort */}
        <Select value={filters.sort} onValueChange={(v) => update({ sort: v as SortOption })}>
          <SelectTrigger className="w-36 sm:w-44 rounded-xl h-10 text-xs" aria-label={t('directory.sort', 'Sort by')}>
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="best_match">{t('consultants_page.sort_best_match', 'Best Match')}</SelectItem>
            <SelectItem value="rating">{t('consultants_page.sort_rating', 'Highest Rating')}</SelectItem>
            <SelectItem value="rate_low">{t('consultants_page.sort_price_low', 'Price: Low → High')}</SelectItem>
            <SelectItem value="rate_high">{t('consultants_page.sort_price_high', 'Price: High → Low')}</SelectItem>
            <SelectItem value="experience">{t('directory.sort_experience', 'Most experience')}</SelectItem>
            <SelectItem value="availability">{t('consultants_page.sort_fastest', 'Available First')}</SelectItem>
            <SelectItem value="credly_first">{t('directory.sort_credly', 'Credly profile first')}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label={t('directory.view', 'View')}>
          <button type="button" aria-pressed={view === 'grid'} aria-label={t('directory.view_list', 'List')} onClick={() => update({ view: 'list' })} className={`flex items-center gap-1 px-2.5 py-2 text-xs transition-colors ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}>
            <LayoutGrid className="w-4 h-4" /><span className="hidden sm:inline">{t('directory.view_list', 'List')}</span>
          </button>
          <button type="button" aria-pressed={view === 'map'} aria-label={t('directory.view_map', 'Map')} onClick={() => update({ view: 'map' })} className={`flex items-center gap-1 px-2.5 py-2 text-xs transition-colors ${view === 'map' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}>
            <Map className="w-4 h-4" /><span className="hidden sm:inline">{t('directory.view_map', 'Map')}</span>
          </button>
        </div>
      </div>

      {/* Expandable Filter Panel */}
      {showFilters && (
        <DirectoryFilterPanel
          filters={filters}
          consultants={consultants}
          ctx={ctx}
          onChange={update}
          onClear={clearFilters}
          saved={saved}
          onSave={(name) => setSaved(saveFilter(name, serializeFilters({ ...filters, view: 'list', bbox: null }).toString()))}
          onApplySaved={(query) => { const next = parseFilters(new URLSearchParams(query)); setSearch(next.q); setSearchParams(serializeFilters({ ...next, view: filters.view }), { replace: true }); }}
          onDeleteSaved={(name) => setSaved(deleteSaved(name))}
        />
      )}

      {/* Active filters */}
      {(activeFilterCount > 0 || filters.q) && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.bbox && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent">
              <MapPin className="w-3 h-3" /> {t('directory.map_area', 'Map area')}
              <button type="button" aria-label={t('directory.clear_area', 'Clear map area')} onClick={() => { setMovedBounds(null); update({ bbox: null }); }} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{t('directory.active_count', '{{n}} filters active', { n: activeFilterCount })}</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}><X className="w-3 h-3 me-1" />{t('directory.clear_all', 'Clear all')}</Button>
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" role="status">
          {t('directory.found', '{{n}} consultants found', { n: filtered.length })}
        </p>
      </div>

      {/* Map View — split layout */}
      {view === 'map' && (
        <div className="flex flex-col gap-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground" data-testid="map-legend">
            {(['available', 'busy', 'offline'] as const).map(s => (
              <span key={s} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-full inline-block ${STATE_META[s].dot}`} /> {STATE_META[s].label} ({withoutArea.filter(c => c.status === s).length})</span>
            ))}
            <span className="ms-auto text-[10px]">{t('directory.city_level', 'Pins show the area of a city, never an address.')}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <div className="relative">
              <ConsultantMap
                consultants={withoutArea}
                selectedId={mapSelectedId}
                matches={mapMatches}
                onSelectConsultant={setMapSelectedId}
                onViewProfile={(id) => navigate(`/client/consultants/${id}`)}
                onOpenRequest={() => navigate('/client/new-request')}
                onInvite={invite}
                onBoundsChange={setMovedBounds}
              />
              {areaChanged && (
                <Button type="button" size="sm" className="absolute top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 z-[1000] shadow-lg gap-1" onClick={() => update({ bbox: movedBounds })}>
                  <Search className="w-3.5 h-3.5" /> {t('directory.search_area', 'Search this area')}
                </Button>
              )}
            </div>
            {/* Side list */}
            <div className="space-y-2 max-h-[300px] lg:max-h-[420px] overflow-y-auto pr-1" aria-label={t('directory.on_map', 'Consultants on the map')}>
              {filtered.filter(c => c.lat !== null && c.lng !== null).map(c => (
                <button
                  key={c.id}
                  id={`map-list-${c.id}`}
                  type="button"
                  onClick={() => { setMapSelectedId(c.id); }}
                  className={`w-full text-start p-3 rounded-xl border transition-all flex items-center gap-3 ${mapSelectedId === c.id ? 'border-accent bg-accent/5 ring-2 ring-accent/20' : 'border-border/50 hover:border-accent/40 bg-card'}`}
                >
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">{c.avatar}</div>
                    <span className={`absolute -top-0.5 -end-0.5 w-3 h-3 rounded-full border-2 border-card ${STATE_META[c.status].dot}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.specialty}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.place || t('profileRules.locationNotSet', 'Location not set')}</p>
                    <FoundingBadge consultantId={c.id} /><TrustBadge badge={c.ai_interview_badge} credits={c.credibility_credits} className="mt-1" />
                    <CompletionBadge percent={c.completion_percent ?? 0} tier={c.ai_interview_badge} className="mt-1" />
                    {matches && <MatchWhyChips why={matches.get(c.id)?.chips} score={matches.get(c.id)?.score} />}
                  </div>
                  <div className="text-end shrink-0">
                    <p className="text-sm font-bold text-foreground">${c.rate}</p>
                    <RatingStars rating={c.rating} reviews={c.reviews} size="sm" className="max-w-32 justify-end" />
                  </div>
                </button>
              ))}
            </div>
          </div>
          {noLocation.length > 0 && (
            <section aria-labelledby="no-location-title" className="space-y-2">
              <h2 id="no-location-title" className="text-sm font-semibold text-foreground">{t('directory.no_location', 'No location set')} ({noLocation.length})</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="no-location-list">
                {noLocation.map(c => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card p-3">
                    <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-xs shrink-0">{c.avatar}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{c.specialty} · ${c.rate}/hr</p>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/client/consultants/${c.id}`)}>{t('consultants_page.view_profile')}</Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Grid View */}
      {view !== 'map' && filtered.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground">No consultants found</h3>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or search criteria</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear All Filters</Button>
          </CardContent>
        </Card>
      ) : view !== 'map' ? (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((c) => (
            <Card key={c.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all group">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-lg shrink-0">
                      {c.avatar}
                    </div>
                    <span className={`absolute -top-1 -end-1 w-4 h-4 rounded-full border-2 border-card transition-colors ${STATE_META[c.status].dot}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground">{c.name}</h3>
                      <Button variant="ghost" size="icon" className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Heart className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.skills && c.skills.length > 1 ? c.skills.slice(0, 4).join(' · ') + (c.skills.length > 4 ? ` +${c.skills.length - 4}` : '') : c.specialty}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {c.place || t('profileRules.locationNotSet', 'Location not set')}
                    </p>

                    <RatingStars rating={c.rating} reviews={c.reviews} size="sm" className="mt-2" />
                    {matches && <MatchWhyChips why={matches.get(c.id)?.chips} score={matches.get(c.id)?.score} />}

                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <FoundingBadge consultantId={c.id} />
                      {c.linkedinVerified && <LinkStatus state={c.linkedin_state} label="LinkedIn" />}
                      {c.credlyVerified && <LinkStatus state={c.credly_state} label="Credly" />}
                      {c.badges.map((badge) => {
                        const config = badgeConfig[badge];
                        if (!config) return null;
                        const BIcon = config.icon;
                        return (
                          <span key={badge} className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-muted">
                            <BIcon className={`w-2.5 h-2.5 ${config.color}`} />
                            {t(`consultants.${badge}`)}
                          </span>
                        );
                      })}
                      {/* Verification Status Badge */}
                      <VerificationBadge status={c.verification_status as any} />
                      <FoundingBadge consultantId={c.id} /><TrustBadge badge={c.ai_interview_badge} credits={c.credibility_credits} />
                      <CompletionBadge percent={c.completion_percent ?? 0} tier={c.ai_interview_badge} />

                    </div>

                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="text-lg font-bold text-foreground">${c.rate}</span>
                          <span className="text-xs text-muted-foreground">/hr</span>
                        </div>
                        {!matches && c.matchScore !== undefined && (
                          <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent">
                            {c.matchScore}% {t('consultants_page.match')}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <span className={`text-xs font-medium flex items-center gap-1 ${c.status === 'available' ? 'text-green-600' : c.status === 'busy' ? 'text-amber-600' : 'text-muted-foreground'}`} data-testid={`status-${c.id}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATE_META[c.status].dot} ${c.status === 'available' ? 'animate-pulse' : ''}`} />
                          {STATE_META[c.status].label}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg bg-muted/40 px-2.5 py-2" data-testid={`hours-${c.id}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Weekly availability</p>
                      {c.hours && c.hours.length > 0 ? (
                        <ul className="space-y-0.5">{c.hours.map(h => <li key={h} className="text-xs text-foreground">{h}</li>)}</ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">No hours set yet</p>
                      )}
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">Sessions are arranged inside a request, so everything stays protected in the portal.</p>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" className="gradient-primary border-0 flex-1 text-xs" onClick={() => invite(c.id)}>Open a request</Button>
                      <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => navigate(`/client/consultants/${c.id}`)}>{t('consultants_page.view_profile')}</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

    </div>
  );
}
