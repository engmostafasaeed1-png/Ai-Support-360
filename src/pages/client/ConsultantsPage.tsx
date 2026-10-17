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
import { useState, useMemo, useEffect, useRef } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useTranslation } from 'react-i18next';
import { useRealtimeConsultants } from '@/hooks/useRealtimeConsultants';
import ConsultantMap from '@/components/client/ConsultantMap';
import RatingStars from '@/components/client/RatingStars';
import { sapModules } from '@/data/clientMockData';
import VerificationBadge from '@/components/consultant/VerificationBadge';
import { TrustBadge } from '@/components/consultant/TrustBadge';
import LinkStatus from '@/components/consultant/LinkStatus';
import { STATE_META } from '@/lib/mapMarkers';
import { compareRecommended, hasModule, skillMatchesText, matchesExperienceFilters } from '@/lib/consultantDirectory';
import TaxonomySelect from '@/components/profile/TaxonomySelect';
import { INDUSTRY_EXPERIENCE, CUSTOMER_SEGMENTS, LOCALIZATION_COUNTRIES, VERTICAL_SOLUTIONS } from '@/lib/profileTaxonomy';

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

type SortOption = 'best_match' | 'rating' | 'price_low' | 'price_high' | 'fastest' | 'credly_first';

export default function ConsultantsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const industryFilter = searchParams.get('industry');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [showFilters, setShowFilters] = useState(false);

  // Filter states
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'online' | 'busy' | 'offline'>('all');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [minRating, setMinRating] = useState(0);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 500]);
  const [languageFilter, setLanguageFilter] = useState('all');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [verticalFilter, setVerticalFilter] = useState('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [credlyOnly, setCredlyOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('best_match');
  const [mapSelectedId, setMapSelectedId] = useState<string | null>(null);

  const { consultants, realtimeConnected } = useRealtimeConsultants();
  const { data: foundingAwards } = useFoundingConsultants();
  const { data: foundingMonths = 0 } = useFoundingBoost();

  // Auto-scroll side list when a map marker is clicked
  useEffect(() => {
    if (mapSelectedId) {
      const el = document.getElementById(`map-list-${mapSelectedId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [mapSelectedId]);

  const onlineCount = consultants.filter(c => c.status === 'available').length;
  const busyCount = consultants.filter(c => c.status === 'busy').length;
  const offlineCount = consultants.filter(c => c.status === 'offline').length;
  const credlyCount = consultants.filter(c => c.credlyVerified).length;

  const filtered = useMemo(() => {
    const result = consultants.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        skillMatchesText(c, debouncedSearch) ||
        c.place.toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchesIndustry = !industryFilter || c.industries?.includes(industryFilter);
      const matchesAvailability =
        availabilityFilter === 'all' ||
        (availabilityFilter === 'online' && c.status === 'available') ||
        (availabilityFilter === 'busy' && c.status === 'busy') ||
        (availabilityFilter === 'offline' && c.status === 'offline');
      const matchesModule = moduleFilter === 'all' || hasModule(c, moduleFilter);
      const matchesLanguage = languageFilter === 'all' || (c.languages || []).includes(languageFilter);
      const matchesRating = c.rating >= minRating;
      const matchesPrice = c.rate >= priceRange[0] && c.rate <= priceRange[1];
      const matchesVerified = !verifiedOnly || c.badges.includes('verified');
      const matchesCredly = !credlyOnly || c.credlyVerified;
      const matchesExperience = matchesExperienceFilters(c, { segment: segmentFilter, country: countryFilter, vertical: verticalFilter });

      return matchesExperience && matchesSearch && matchesIndustry && matchesAvailability && matchesModule && matchesLanguage && matchesRating && matchesPrice && matchesVerified && matchesCredly;
    });

    // Sort
    switch (sortBy) {
      case 'rating':
        result.sort((a, b) => b.rating - a.rating);
        break;
      case 'price_low':
        result.sort((a, b) => a.rate - b.rate);
        break;
      case 'price_high':
        result.sort((a, b) => b.rate - a.rate);
        break;
      case 'fastest':
        result.sort((a, b) => STATE_META[a.status].order - STATE_META[b.status].order || b.rating - a.rating);
        break;
      case 'credly_first':
        result.sort((a, b) => {
          const aCredly = a.credlyVerified ? 1 : 0;
          const bCredly = b.credlyVerified ? 1 : 0;
          return bCredly - aCredly || b.rating - a.rating;
        });
        break;
      default:
        result.sort((a, b) => {
          const primary = STATE_META[a.status].order - STATE_META[b.status].order || b.rating - a.rating || b.reviews - a.reviews;
          return primary || foundingTieBreak(foundingAwards?.get(a.id), foundingAwards?.get(b.id), foundingMonths) || compareRecommended(a, b);
        });
    }

    return result;
  }, [foundingAwards, foundingMonths, consultants, debouncedSearch, industryFilter, availabilityFilter, moduleFilter, minRating, priceRange, languageFilter, verifiedOnly, credlyOnly, sortBy, segmentFilter, countryFilter, verticalFilter]);

  const notOnMapCount = filtered.filter(c => c.lat === null || c.lng === null).length;

  const activeFilterCount = [
    availabilityFilter !== 'all',
    moduleFilter !== 'all',
    minRating > 0,
    priceRange[0] > 0 || priceRange[1] < 500,
    languageFilter !== 'all',
    segmentFilter !== 'all',
    countryFilter !== 'all',
    verticalFilter !== 'all',
    verifiedOnly,
    credlyOnly,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setAvailabilityFilter('all');
    setModuleFilter('all');
    setMinRating(0);
    setPriceRange([0, 500]);
    setLanguageFilter('all');
    setSegmentFilter('all');
    setCountryFilter('all');
    setVerticalFilter('all');
    setVerifiedOnly(false);
    setCredlyOnly(false);
    setSearchParams({});
  };

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
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setAvailabilityFilter(availabilityFilter === 'all' ? 'all' : 'all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium transition-all whitespace-nowrap ${availabilityFilter === 'all' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
        >
          <Users className="w-3.5 h-3.5" />
          All ({consultants.length})
        </button>
        <button
          onClick={() => setAvailabilityFilter(availabilityFilter === 'online' ? 'all' : 'online')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium transition-all whitespace-nowrap ${availabilityFilter === 'online' ? 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
        >
          <Circle className="w-3 h-3 fill-green-500 text-green-500" />
          Online ({onlineCount})
        </button>
        <button
          onClick={() => setAvailabilityFilter(availabilityFilter === 'busy' ? 'all' : 'busy')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium transition-all whitespace-nowrap ${availabilityFilter === 'busy' ? 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
        >
          <Circle className="w-3 h-3 fill-amber-500 text-amber-500" />
          Busy ({busyCount})
        </button>
        <button
          onClick={() => setAvailabilityFilter(availabilityFilter === 'offline' ? 'all' : 'offline')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium transition-all whitespace-nowrap ${availabilityFilter === 'offline' ? 'bg-muted text-foreground border border-border' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
        >
          <Circle className="w-3 h-3 fill-muted-foreground/40 text-muted-foreground/40" />
          Offline ({offlineCount})
        </button>
      </div>

      {/* Search + Filter toggle + View */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t('consultants_page.search_placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 rounded-xl h-10 text-sm" />
        </div>
        <Button
          variant={showFilters ? 'default' : 'outline'}
          size="sm"
          className="gap-1 h-10"
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
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
          <SelectTrigger className="w-32 sm:w-44 rounded-xl h-10 text-xs">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="best_match">{t('consultants_page.sort_best_match', 'Best Match')}</SelectItem>
            <SelectItem value="rating">{t('consultants_page.sort_rating', 'Highest Rating')}</SelectItem>
            <SelectItem value="price_low">{t('consultants_page.sort_price_low', 'Price: Low → High')}</SelectItem>
            <SelectItem value="price_high">{t('consultants_page.sort_price_high', 'Price: High → Low')}</SelectItem>
            <SelectItem value="fastest">{t('consultants_page.sort_fastest', 'Available First')}</SelectItem>
            <SelectItem value="credly_first">Credly profile first</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setView('grid')} className={`p-2 transition-colors ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => setView('map')} className={`p-2 transition-colors ${view === 'map' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}>
            <Map className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expandable Filter Panel */}
      {showFilters && (
        <Card className="rounded-2xl border-border/50 animate-fade-in">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* SAP Module */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> SAP Module
                </Label>
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                  <SelectTrigger className="rounded-xl h-9 text-xs">
                    <SelectValue placeholder="All Modules" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('consultants_page.all_modules', 'All Modules')}</SelectItem>
                    {sapModules.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Language */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Language
                </Label>
                <Select value={languageFilter} onValueChange={setLanguageFilter}>
                  <SelectTrigger className="rounded-xl h-9 text-xs">
                    <SelectValue placeholder="All Languages" />
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map(l => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Industry (old keys from links still work; the list uses the new labels) */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Industry</Label>
                <TaxonomySelect groups={INDUSTRY_EXPERIENCE} value={industryFilter ?? ''} noneLabel="Any" ariaLabel="Industry" className="rounded-xl h-9 text-xs"
                  onChange={v => setSearchParams(v ? { industry: v } : {})} />
              </div>

              {/* Customer segment */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Customer segment</Label>
                <TaxonomySelect groups={CUSTOMER_SEGMENTS} value={segmentFilter === 'all' ? '' : segmentFilter} noneLabel="Any" ariaLabel="Customer segment" className="rounded-xl h-9 text-xs"
                  onChange={v => setSegmentFilter(v || 'all')} />
              </div>

              {/* Localization country */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Localization country</Label>
                <TaxonomySelect groups={LOCALIZATION_COUNTRIES} value={countryFilter === 'all' ? '' : countryFilter} noneLabel="Any" ariaLabel="Localization country" className="rounded-xl h-9 text-xs"
                  onChange={v => setCountryFilter(v || 'all')} />
              </div>

              {/* Vertical solution */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Vertical solution</Label>
                <TaxonomySelect groups={VERTICAL_SOLUTIONS} value={verticalFilter === 'all' ? '' : verticalFilter} noneLabel="Any" ariaLabel="Vertical solution" className="rounded-xl h-9 text-xs"
                  onChange={v => setVerticalFilter(v || 'all')} />
              </div>

              {/* Min Rating */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5" /> Min Rating: {minRating > 0 ? `${minRating}+` : 'Any'}
                </Label>
                <div className="flex items-center gap-1.5 pt-1">
                  {[0, 3, 3.5, 4, 4.5].map(r => (
                    <button
                      key={r}
                      onClick={() => setMinRating(r)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${minRating === r ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
                    >
                      {r === 0 ? 'Any' : `${r}+`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" /> Price: ${priceRange[0]} – ${priceRange[1]}/hr
                </Label>
                <Slider
                  value={priceRange}
                  onValueChange={(v) => setPriceRange(v as [number, number])}
                  min={0}
                  max={500}
                  step={10}
                  className="pt-2"
                />
              </div>
            </div>

            {/* Extra toggles */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/50">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch id="verified-only" checked={verifiedOnly} onCheckedChange={setVerifiedOnly} />
                  <Label htmlFor="verified-only" className="text-xs cursor-pointer">{t('consultants_page.verified_only', 'Verified Only')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="credly-only" checked={credlyOnly} onCheckedChange={setCredlyOnly} />
                  <Label htmlFor="credly-only" className="text-xs cursor-pointer flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-orange-500" />
                    Credly profile only
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">{credlyCount}</span>
                  </Label>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={clearFilters}>
                <X className="w-3 h-3 me-1" /> Clear All Filters
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active filter chips */}
      {(industryFilter || activeFilterCount > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {industryFilter && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent">
              Industry: {t(`industries.${industryFilter}`, industryFilter)}
              <button onClick={() => setSearchParams({})} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
            </Badge>
          )}
          {moduleFilter !== 'all' && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent">
              {moduleFilter}
              <button onClick={() => setModuleFilter('all')} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
            </Badge>
          )}
          {minRating > 0 && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent">
              Rating: {minRating}+
              <button onClick={() => setMinRating(0)} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
            </Badge>
          )}
          {verifiedOnly && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent">
              {t('consultants_page.verified_only', 'Verified Only')}
              <button onClick={() => setVerifiedOnly(false)} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
            </Badge>
          )}
          {credlyOnly && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
              <Award className="w-3 h-3" />
              Credly profile only
              <button onClick={() => setCredlyOnly(false)} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
            </Badge>
          )}
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filtered.length} consultant{filtered.length !== 1 ? 's' : ''} found
        </p>
      </div>

      {/* Map View — split layout */}
      {view === 'map' && (
        <div className="flex flex-col gap-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground" data-testid="map-legend">
            {(['available', 'busy', 'offline'] as const).map(s => (
              <span key={s} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-full inline-block ${STATE_META[s].dot}`} /> {STATE_META[s].label} ({filtered.filter(c => c.status === s).length})</span>
            ))}
            <span className="ms-auto text-[10px]">
              Pins show the area of a city, never an address.
              {notOnMapCount > 0 && ` ${notOnMapCount} consultant${notOnMapCount !== 1 ? 's have' : ' has'} not chosen a city and ${notOnMapCount !== 1 ? 'are' : 'is'} not on the map.`}
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <ConsultantMap
              consultants={filtered}
              selectedId={mapSelectedId}
              onSelectConsultant={setMapSelectedId}
              onViewProfile={(id) => navigate(`/client/consultants/${id}`)}
              onOpenRequest={() => navigate('/client/new-request')}
            />
            {/* Side list */}
            <div className="space-y-2 max-h-[300px] lg:max-h-[420px] overflow-y-auto pr-1">
              {filtered.map(c => (
                <button
                  key={c.id}
                  id={`map-list-${c.id}`}
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
                  </div>
                  <div className="text-end shrink-0">
                    <p className="text-sm font-bold text-foreground">${c.rate}</p>
                    <RatingStars rating={c.rating} reviews={c.reviews} size="sm" className="max-w-32 justify-end" />
                  </div>
                </button>
              ))}
            </div>
          </div>
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

                    </div>

                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="text-lg font-bold text-foreground">${c.rate}</span>
                          <span className="text-xs text-muted-foreground">/hr</span>
                        </div>
                        {c.matchScore !== undefined && (
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
                      <Button size="sm" className="gradient-primary border-0 flex-1 text-xs" onClick={() => navigate('/client/new-request')}>Open a request</Button>
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
