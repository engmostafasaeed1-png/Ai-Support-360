import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Star, BadgeCheck, Zap, Heart, Filter, Map, LayoutGrid, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRealtimeConsultants } from '@/hooks/useRealtimeConsultants';
import ConsultantMap from '@/components/client/ConsultantMap';

const badgeConfig: Record<string, { icon: typeof Star; color: string }> = {
  verified: { icon: BadgeCheck, color: 'text-accent' },
  top_rated: { icon: Star, color: 'text-yellow-500' },
  fast_responder: { icon: Zap, color: 'text-green-500' },
};

export default function ConsultantsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const { consultants, realtimeConnected } = useRealtimeConsultants();

  const filtered = consultants.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.specialty.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('consultants_page.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('consultants_page.subtitle')}</p>
        </div>
        {/* Realtime indicator */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium ${realtimeConnected ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
          {realtimeConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {realtimeConnected ? t('consultants_page.live') : t('consultants_page.connecting')}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t('consultants_page.search_placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 rounded-xl h-10" />
        </div>
        <Button variant="outline" size="sm" className="gap-1.5"><Filter className="w-3.5 h-3.5" /> {t('consultants_page.filters')}</Button>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setView('grid')} className={`p-2 transition-colors ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => setView('map')} className={`p-2 transition-colors ${view === 'map' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}>
            <Map className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab filters */}
      <div className="flex gap-2">
        {['best_match', 'fastest_available', 'budget_fit'].map((tab, i) => (
          <Button key={tab} size="sm" variant={i === 0 ? 'default' : 'outline'} className={`text-xs rounded-full ${i === 0 ? 'gradient-primary border-0' : ''}`}>
            {t(`consultants_page.${tab}`)}
          </Button>
        ))}
      </div>

      {/* Map View */}
      {view === 'map' && (
        <Suspense fallback={<div className="h-[420px] rounded-2xl bg-muted animate-pulse" />}>
          <ConsultantMap consultants={filtered} />
        </Suspense>
      )}

      {/* Grid View */}
      <div className={`grid md:grid-cols-2 gap-4 ${view === 'map' ? 'mt-4' : ''}`}>
        {filtered.map((c) => (
          <Card key={c.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-lg shrink-0">
                    {c.avatar}
                  </div>
                  {/* Live status dot on avatar */}
                  <span className={`absolute -top-1 -end-1 w-4 h-4 rounded-full border-2 border-card ${c.available ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-foreground">{c.name}</h3>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <Heart className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">{c.specialty}</p>
                  {'city' in c && <p className="text-xs text-muted-foreground">{c.city}</p>}

                  <div className="flex items-center gap-2 mt-2">
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-semibold text-foreground">{c.rating}</span>
                    <span className="text-xs text-muted-foreground">({c.reviews} {t('consultants_page.reviews')})</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-2">
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
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-lg font-bold text-foreground">${c.rate}</span>
                        <span className="text-xs text-muted-foreground">/hr</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent">
                        {c.matchScore}% {t('consultants_page.match')}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      {c.available ? (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          {t('consultants.available')}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">
                          {t('consultants.offline')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button size="sm" className="gradient-primary border-0 flex-1 text-xs">{t('consultants_page.book_session')}</Button>
                    <Button size="sm" variant="outline" className="flex-1 text-xs">{t('consultants_page.view_profile')}</Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
