import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { mockRecommendedConsultants } from '@/data/clientMockData';
import { Search, Star, BadgeCheck, Zap, Heart, Filter } from 'lucide-react';
import { useState } from 'react';

const badgeConfig: Record<string, { icon: typeof Star; color: string }> = {
  verified: { icon: BadgeCheck, color: 'text-accent' },
  top_rated: { icon: Star, color: 'text-yellow-500' },
  fast_responder: { icon: Zap, color: 'text-green-500' },
};

export default function ConsultantsPage() {
  const [search, setSearch] = useState('');
  const filtered = mockRecommendedConsultants.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.specialty.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Consultant Marketplace</h1>
        <p className="text-sm text-muted-foreground mt-1">Find and book the best SAP experts for your needs.</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name, skill, or module..." value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 rounded-xl h-10" />
        </div>
        <Button variant="outline" size="sm" className="gap-1.5"><Filter className="w-3.5 h-3.5" /> Filters</Button>
      </div>

      {/* Match tabs */}
      <div className="flex gap-2">
        {['Best Match', 'Fastest Available', 'Budget Fit'].map((tab, i) => (
          <Button key={tab} size="sm" variant={i === 0 ? 'default' : 'outline'} className={`text-xs rounded-full ${i === 0 ? 'gradient-primary border-0' : ''}`}>
            {tab}
          </Button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {filtered.map((c) => (
          <Card key={c.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-lg shrink-0">
                  {c.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-foreground">{c.name}</h3>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <Heart className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">{c.specialty}</p>

                  <div className="flex items-center gap-2 mt-2">
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-semibold text-foreground">{c.rating}</span>
                    <span className="text-xs text-muted-foreground">({c.reviews} reviews)</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {c.badges.map((badge) => {
                      const config = badgeConfig[badge];
                      if (!config) return null;
                      const BIcon = config.icon;
                      return (
                        <span key={badge} className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-muted">
                          <BIcon className={`w-2.5 h-2.5 ${config.color}`} />
                          {badge.replace('_', ' ')}
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
                        {c.matchScore}% match
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      {c.available && (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          Available
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button size="sm" className="gradient-primary border-0 flex-1 text-xs">Book Session</Button>
                    <Button size="sm" variant="outline" className="flex-1 text-xs">View Profile</Button>
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
