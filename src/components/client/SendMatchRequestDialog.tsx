import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Search, Star, Brain, Send, CheckCircle2, Sparkles, Wifi, WifiOff, Clock, Filter, SlidersHorizontal, ArrowUpDown, X } from 'lucide-react';

interface Props {
  ticketId: string;
  ticketTitle?: string;
  ticketDescription?: string;
  ticketUrgency?: string;
  sapModule: string;
  preferredLanguage?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AvailabilityFilter = 'all' | 'available' | 'busy' | 'offline';

interface AIRecommendation {
  consultant_id: string;
  match_score: number;
  match_reason: string;
  strengths: string[];
}

type SortBy = 'relevance' | 'rating' | 'rate_low' | 'rate_high' | 'ai_score' | 'experience';

const SAP_MODULES = [
  'SAP FI', 'SAP CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP PM', 'SAP QM',
  'SAP WM', 'SAP HR/HCM', 'SAP PS', 'SAP ABAP', 'SAP BASIS', 'SAP BW',
  'SAP HANA', 'SAP S/4HANA', 'SAP SuccessFactors', 'SAP Ariba', 'SAP CRM',
  'SAP EWM', 'SAP TM', 'SAP GRC', 'SAP MDG', 'SAP Fiori',
];

export default function SendMatchRequestDialog({ ticketId, ticketTitle, ticketDescription, ticketUrgency, sapModule, preferredLanguage, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [minRating, setMinRating] = useState<string>('all');
  const [maxRate, setMaxRate] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortBy>('relevance');
  const [showFilters, setShowFilters] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<AIRecommendation[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const activeFilterCount = [availabilityFilter !== 'all', moduleFilter !== 'all', minRating !== 'all', maxRate !== 'all'].filter(Boolean).length;

  // Fetch all consultants
  const { data: consultants, isLoading } = useQuery({
    queryKey: ['available-consultants', sapModule, search, availabilityFilter, moduleFilter],
    enabled: open,
    queryFn: async () => {
      let query = supabase
        .from('consultants')
        .select(`id, user_id, hourly_rate, currency, rating, total_reviews, ai_skills_score, availability_status, languages, response_time_minutes,
          consultant_skills (sap_module, proficiency_level, years_experience)`)
        .eq('verification_status', 'verified')
        .limit(50);

      if (availabilityFilter !== 'all') {
        query = query.eq('availability_status', availabilityFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const userIds = (data || []).map(c => c.user_id);
      const { data: profiles } = await supabase
        .from('profile_directory')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      const { data: existingRequests } = await supabase
        .from('ticket_match_requests')
        .select('consultant_id')
        .eq('ticket_id', ticketId);
      const sentIds = new Set((existingRequests || []).map(r => r.consultant_id));

      return (data || [])
        .map((c: any) => {
          const profile = profileMap.get(c.user_id);
          const modules = (c.consultant_skills || []).map((s: any) => s.sap_module);
          const hasModule = modules.some((m: string) => m.toLowerCase().includes(sapModule.toLowerCase()));
          const totalYears = (c.consultant_skills || []).reduce((sum: number, s: any) => sum + (s.years_experience || 0), 0);
          return {
            id: c.id,
            name: profile?.display_name || 'Unknown',
            avatar_url: profile?.avatar_url,
            hourly_rate: c.hourly_rate || 0,
            currency: c.currency || 'USD',
            rating: c.rating || 0,
            total_reviews: c.total_reviews || 0,
            ai_score: c.ai_skills_score || 0,
            availability: c.availability_status || 'offline',
            response_time: c.response_time_minutes || 0,
            modules,
            totalYears,
            hasModule,
            alreadySent: sentIds.has(c.id),
          };
        })
        .filter((c: any) => {
          const matchesSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.modules.some((m: string) => m.toLowerCase().includes(search.toLowerCase()));
          const matchesModule = moduleFilter === 'all' || c.modules.some((m: string) => m.toLowerCase().includes(moduleFilter.toLowerCase()));
          const matchesRating = minRating === 'all' || c.rating >= Number(minRating);
          const matchesRate = maxRate === 'all' || c.hourly_rate <= Number(maxRate);
          return matchesSearch && matchesModule && matchesRating && matchesRate;
        })
        .sort((a: any, b: any) => {
          if (a.hasModule !== b.hasModule) return a.hasModule ? -1 : 1;
          return (b.rating || 0) - (a.rating || 0);
        });
    },
  });

  const handleAiRecommend = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: {
          action: 'match_consultants',
          title: ticketTitle || 'Untitled',
          description: ticketDescription || '',
          sap_module: sapModule,
          urgency: ticketUrgency || 'medium',
          preferred_language: preferredLanguage || 'en',
        },
      });
      if (error) throw error;
      const recs = data?.result?.recommendations || [];
      setAiRecommendations(recs);
      if (recs.length === 0) {
        toast.info('No AI recommendations available');
      } else {
        toast.success(`AI recommended ${recs.length} consultants`);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to get AI recommendations');
    } finally {
      setAiLoading(false);
    }
  };

  const getAiRec = (consultantId: string) => aiRecommendations?.find(r => r.consultant_id === consultantId);

  const handleSend = async (consultantId: string, name: string) => {
    setSending(consultantId);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not authenticated'); setSending(null); return; }

    const { error } = await supabase
      .from('ticket_match_requests')
      .insert({
        ticket_id: ticketId,
        consultant_id: consultantId,
        sent_by: user.id,
        message: message.trim() || null,
      } as any);

    setSending(null);
    if (error) {
      if (error.code === '23505') {
        toast.info('Request already sent to this consultant');
      } else {
        toast.error('Failed to send request');
      }
    } else {
      toast.success(`Match request sent to ${name}!`);
      queryClient.invalidateQueries({ queryKey: ['available-consultants'] });
      queryClient.invalidateQueries({ queryKey: ['client-match-acceptors', ticketId] });
    }
  };

  const availabilityBadge = (status: string) => {
    switch (status) {
      case 'available':
        return <Badge variant="secondary" className="text-[9px] gap-1 bg-green-500/15 text-green-600 border-green-500/20"><Wifi className="w-2.5 h-2.5" />Online</Badge>;
      case 'busy':
        return <Badge variant="secondary" className="text-[9px] gap-1 bg-amber-500/15 text-amber-600 border-amber-500/20"><Clock className="w-2.5 h-2.5" />Busy</Badge>;
      default:
        return <Badge variant="secondary" className="text-[9px] gap-1 bg-muted text-muted-foreground"><WifiOff className="w-2.5 h-2.5" />Offline</Badge>;
    }
  };

  // Sort: if AI recommendations exist, put recommended ones first
  const sortedConsultants = consultants ? [...consultants].sort((a, b) => {
    // AI recommendations take priority
    if (aiRecommendations) {
      const aRec = getAiRec(a.id);
      const bRec = getAiRec(b.id);
      if (aRec && !bRec) return -1;
      if (!aRec && bRec) return 1;
      if (aRec && bRec) return (bRec.match_score || 0) - (aRec.match_score || 0);
    }
    // Then apply selected sort
    switch (sortBy) {
      case 'rating': return (b.rating || 0) - (a.rating || 0);
      case 'rate_low': return (a.hourly_rate || 0) - (b.hourly_rate || 0);
      case 'rate_high': return (b.hourly_rate || 0) - (a.hourly_rate || 0);
      case 'ai_score': return (b.ai_score || 0) - (a.ai_score || 0);
      case 'experience': return (b.totalYears || 0) - (a.totalYears || 0);
      default: return 0;
    }
  }) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Send Match Request</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Filter, search, or let AI recommend the best consultants for your ticket
          </p>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
        <div className="space-y-2">
          {/* Top row: Search + Filter toggle + Sort + AI */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or SAP module..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="ps-9 h-9"
              />
            </div>
            <Button
              variant={showFilters ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5 h-9 text-xs relative"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-accent text-[9px] text-accent-foreground flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <Select value={sortBy} onValueChange={v => setSortBy(v as SortBy)}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <ArrowUpDown className="w-3 h-3 me-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relevance">Relevance</SelectItem>
                <SelectItem value="rating">Highest Rating</SelectItem>
                <SelectItem value="ai_score">AI Score</SelectItem>
                <SelectItem value="rate_low">Rate: Low → High</SelectItem>
                <SelectItem value="rate_high">Rate: High → Low</SelectItem>
                <SelectItem value="experience">Most Experience</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 text-xs border-accent/30 text-accent hover:bg-accent/10"
              onClick={handleAiRecommend}
              disabled={aiLoading}
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              AI Recommend
            </Button>
          </div>

          {/* Expandable filter row */}
          {showFilters && (
            <div className="flex items-end gap-2 flex-wrap bg-muted/30 rounded-lg p-2.5 border border-border/50">
              <div className="space-y-1 min-w-[120px]">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Availability</Label>
                <Select value={availabilityFilter} onValueChange={v => setAvailabilityFilter(v as AvailabilityFilter)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="available">🟢 Online</SelectItem>
                    <SelectItem value="busy">🟡 Busy</SelectItem>
                    <SelectItem value="offline">⚫ Offline</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-[140px]">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">SAP Module</Label>
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Modules</SelectItem>
                    {SAP_MODULES.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-[110px]">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Min Rating</Label>
                <Select value={minRating} onValueChange={setMinRating}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="3">⭐ 3+</SelectItem>
                    <SelectItem value="4">⭐ 4+</SelectItem>
                    <SelectItem value="4.5">⭐ 4.5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-[110px]">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Max Rate</Label>
                <Select value={maxRate} onValueChange={setMaxRate}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="50">≤ $50/hr</SelectItem>
                    <SelectItem value="100">≤ $100/hr</SelectItem>
                    <SelectItem value="150">≤ $150/hr</SelectItem>
                    <SelectItem value="200">≤ $200/hr</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs gap-1 text-destructive hover:text-destructive"
                  onClick={() => {
                    setAvailabilityFilter('all');
                    setModuleFilter('all');
                    setMinRating('all');
                    setMaxRate('all');
                  }}
                >
                  <X className="w-3 h-3" /> Clear
                </Button>
              )}
            </div>
          )}
        </div>

          {/* AI Recommendation banner */}
          {aiRecommendations && aiRecommendations.length > 0 && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent shrink-0" />
              <p className="text-xs text-accent">
                AI ranked <strong>{aiRecommendations.length}</strong> best matches for this ticket. Recommended consultants are highlighted.
              </p>
              <Button variant="ghost" size="sm" className="ms-auto text-xs h-6 px-2" onClick={() => setAiRecommendations(null)}>Clear</Button>
            </div>
          )}

          {/* Optional message */}
          <div className="space-y-1.5">
            <Label className="text-xs">Message to consultant (optional)</Label>
            <Textarea
              placeholder="Describe what you need help with..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>

          {/* Consultant list */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {isLoading ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
            ) : !sortedConsultants?.length ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No consultants found{availabilityFilter !== 'all' ? ` with "${availabilityFilter}" status` : ''}
              </div>
            ) : (
              sortedConsultants.map((c: any) => {
                const rec = getAiRec(c.id);
                return (
                  <Card key={c.id} className={`rounded-xl border-border/50 transition-all ${rec ? 'ring-1 ring-accent/40 bg-accent/[0.02]' : ''} ${c.hasModule ? 'border-accent/20' : ''}`}>
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0 relative">
                          {c.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                          {c.availability === 'available' && (
                            <span className="absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-background" />
                          )}
                          {c.availability === 'busy' && (
                            <span className="absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full bg-amber-500 border-2 border-background" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-foreground text-sm">{c.name}</p>
                            {availabilityBadge(c.availability)}
                            {c.hasModule && (
                              <Badge variant="secondary" className="text-[9px] bg-accent/10 text-accent">Relevant</Badge>
                            )}
                            {rec && (
                              <Badge variant="secondary" className="text-[9px] gap-1 bg-accent/15 text-accent border-accent/25">
                                <Sparkles className="w-2.5 h-2.5" /> {rec.match_score}% match
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> {c.rating}</span>
                            <span className="flex items-center gap-1"><Brain className="w-3 h-3 text-accent" /> {c.ai_score}</span>
                            <span>${c.hourly_rate}/hr</span>
                            {c.totalYears > 0 && <span>{c.totalYears}y exp</span>}
                            {c.response_time > 0 && <span className="flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{c.response_time}m</span>}
                          </div>
                          {c.modules.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {c.modules.slice(0, 4).map((m: string) => (
                                <Badge key={m} variant="secondary" className="text-[9px]">{m}</Badge>
                              ))}
                              {c.modules.length > 4 && <Badge variant="secondary" className="text-[9px]">+{c.modules.length - 4}</Badge>}
                            </div>
                          )}
                          {rec && (
                            <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2 italic">
                              {rec.match_reason}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 pt-1">
                          {c.alreadySent ? (
                            <Badge variant="secondary" className="gap-1 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle2 className="w-3 h-3" /> Sent
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              className="gradient-primary border-0 text-xs h-8 gap-1"
                              onClick={() => handleSend(c.id, c.name)}
                              disabled={sending === c.id}
                            >
                              {sending === c.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              Send
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
