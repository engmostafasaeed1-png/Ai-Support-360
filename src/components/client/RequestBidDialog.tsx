import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useHiddenConsultantIds, withoutHidden } from '@/hooks/useHiddenConsultants';
import ConsultantLocation from '@/components/consultant/ConsultantLocation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Gavel, Globe, ShieldCheck, Clock, AlertTriangle, CheckCircle2, Users, Sparkles, Search, UserCheck, Pencil, ArrowLeft, Send } from 'lucide-react';
import { useTicketBids } from '@/hooks/useClientBids';
import { deadlineFromOption, deadlineOptions, type DeadlineOption } from '@/lib/clientBidding';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import MatchWhyChips from '@/components/match/MatchWhyChips';
import TaskProgressPanel from '@/components/progress/TaskProgressPanel';
import { matchSteps, understoodSummary, type MatchPhase } from '@/lib/matchProgress';
import { invokeWithTimeout } from '@/lib/invokeWithTimeout';

type BidMode = 'select' | 'open' | 'manual' | 'ai';

interface Props {
  ticketId: string;
  ticketTitle: string;
  ticketModule?: string;
  isOpenForBids: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useVerifiedConsultants(sapModule?: string) {
  return useQuery({
    queryKey: ['verified-consultants', sapModule],
    queryFn: async () => {
      const query = supabase
        .from('consultants')
        .select('id, hourly_rate, rating, total_reviews, city, country, user_id, verification_status')
        .eq('verification_status', 'verified')
        .order('rating', { ascending: false })
        .limit(50);

      const { data: consultants, error } = await query;
      if (error) throw error;
      if (!consultants?.length) return [];

      const userIds = consultants.map(c => c.user_id);
      const { data: profiles } = await supabase
        .from('profile_directory')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);
      const pMap = new Map((profiles || []).map(p => [p.user_id, p]));

      // Get skills for module matching
      const consultantIds = consultants.map(c => c.id);
      const { data: skills } = await supabase
        .from('consultant_skills')
        .select('consultant_id, sap_module, proficiency_level')
        .in('consultant_id', consultantIds);
      const skillMap = new Map<string, any[]>();
      (skills || []).forEach(s => {
        const arr = skillMap.get(s.consultant_id) || [];
        arr.push(s);
        skillMap.set(s.consultant_id, arr);
      });

      return consultants.map(c => {
        const profile = pMap.get(c.user_id);
        const cSkills = skillMap.get(c.id) || [];
        const hasModule = sapModule ? cSkills.some(s => s.sap_module === sapModule) : false;
        return {
          id: c.id,
          name: profile?.display_name || 'Unknown',
          avatar_url: profile?.avatar_url,
          hourly_rate: c.hourly_rate,
          rating: c.rating || 0,
          total_reviews: c.total_reviews || 0,
          city: c.city,
          country: c.country,
          skills: cSkills.map((s: any) => s.sap_module),
          hasModule,
        };
      });
    },
  });
}

export default function RequestBidDialog({ ticketId, ticketTitle, ticketModule, isOpenForBids, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<BidMode>('select');
  const [selectedConsultants, setSelectedConsultants] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [bidMessage, setBidMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [deadline, setDeadline] = useState<DeadlineOption>('72');
  const { data: bids } = useTicketBids(ticketId);
  const proposals = bids?.bids.map(r => r.bid);
  const { data: allConsultants, isLoading: loadingConsultants } = useVerifiedConsultants(ticketModule);
  const hiddenIds = useHiddenConsultantIds(open);
  const consultants = allConsultants ? withoutHidden(allConsultants, hiddenIds) : allConsultants;

  const pendingBids = (proposals || []).filter((p: any) => p.status === 'pending').length;
  const totalBids = (proposals || []).length;

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      if (isOpenForBids) {
        setMode('select'); // Show status
      } else {
        setMode('select');
      }
      setSelectedConsultants([]);
      setSearchQuery('');
      setBidMessage('');
      setIsEditing(false);
      setDeadline('72');
    }
  }, [open, isOpenForBids]);

  // Recommended: the same explainable ranking used on the ticket page (full request, hard filters, why-chips).
  const { data: matchResult, isLoading: loadingMatches, isFetching: fetchingMatches, isError: matchFailed, refetch: refetchMatches } = useQuery({
    queryKey: ['bid-matches', ticketId],
    enabled: open && mode === 'ai',
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeWithTimeout('ai-ticket', {
        body: { action: 'match_consultants', ticket_id: ticketId, title: ticketTitle || 'Untitled', sap_module: ticketModule },
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return (data?.result?.recommendations ?? []) as any[];
    },
  });
  const [matchStartedAt, setMatchStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (fetchingMatches) setMatchStartedAt(Date.now());
  }, [fetchingMatches]);
  const matchPhase: MatchPhase | null = matchFailed && !fetchingMatches ? 'error' : loadingMatches || (fetchingMatches && !matchResult) ? 'ranking' : null;
  // Cancel only stops waiting and goes back to the choices; nothing is sent by a match run.
  const cancelMatches = () => {
    void queryClient.cancelQueries({ queryKey: ['bid-matches', ticketId] });
    setMode('select');
  };
  const byId = new Map((consultants || []).map(c => [c.id, c]));
  const aiRecommended = (matchResult ?? [])
    .filter(r => withoutHidden([{ id: r.consultant_id }], hiddenIds).length > 0)
    .map(r => {
      const base = byId.get(r.consultant_id);
      return { id: r.consultant_id, name: base?.name || r.name || 'Consultant', hourly_rate: base?.hourly_rate ?? r.hourly_rate, rating: Number(base?.rating ?? r.rating) || 0,
        city: base?.city, country: base?.country, skills: base?.skills ?? r.top_skills ?? [], hasModule: false, match: r };
    });

  const filteredConsultants = (consultants || []).filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.skills.some((s: string) => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const toggleConsultant = (id: string) => {
    setSelectedConsultants(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleOpenForBids = async () => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from('tickets')
      .update({
        open_for_bids: true,
        bid_deadline: deadlineFromOption(deadline),
        opened_for_bids_at: new Date().toISOString(),
      } as any)
      .eq('id', ticketId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Ticket is now open for public bids!');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['client-tickets'] });
      onOpenChange(false);
    }
  };

  const handleSendPrivateBids = async () => {
    if (!selectedConsultants.length) {
      toast.error('Please select at least one consultant');
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      toast.error('Not authenticated');
      return;
    }
    // A private invitation is a match request: only the invited consultants can see and answer the ticket.
    // The ticket is NOT opened to everybody.
    let sent = 0;
    let already = 0;
    for (const consultantId of selectedConsultants) {
      const { error } = await supabase.from('ticket_match_requests').insert({
        ticket_id: ticketId,
        consultant_id: consultantId,
        sent_by: user.id,
        message: `Private bid invitation${bidMessage.trim() ? ': ' + bidMessage.trim() : ''}`,
      } as any);
      if (!error) sent += 1;
      else if (error.code === '23505') already += 1;
    }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['client-match-acceptors', ticketId] });
    queryClient.invalidateQueries({ queryKey: ['available-consultants'] });
    if (sent > 0) {
      toast.success(`Private bid invitations sent to ${sent} consultant(s)!${already > 0 ? ` (${already} had already been invited.)` : ''}`);
      onOpenChange(false);
    } else if (already > 0) {
      toast.info('These consultants have already been invited.');
    } else {
      toast.error('Could not send the invitations. Please try again.');
    }
  };

  const handleCloseBids = async () => {
    setClosing(true);
    const { error } = await supabase
      .from('tickets')
      .update({ open_for_bids: false } as any)
      .eq('id', ticketId);
    setClosing(false);
    if (error) {
      toast.error('Failed to close bidding');
    } else {
      toast.success('Bidding closed for this ticket.');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticketId] });
      onOpenChange(false);
    }
  };

  const ConsultantCard = ({ c, selectable = true }: { c: any; selectable?: boolean }) => (
    <div
      key={c.id}
      className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
        selectedConsultants.includes(c.id)
          ? 'border-accent bg-accent/5 shadow-sm'
          : 'border-border/50 hover:border-border'
      }`}
      onClick={() => selectable && toggleConsultant(c.id)}
    >
      {selectable && (
        <Checkbox
          checked={selectedConsultants.includes(c.id)}
          onCheckedChange={() => toggleConsultant(c.id)}
          className="shrink-0"
        />
      )}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent/60 flex items-center justify-center text-[10px] font-bold text-primary-foreground shrink-0">
        {c.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{c.name}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>⭐ {c.rating.toFixed(1)}</span>
          {c.hourly_rate && <span>${c.hourly_rate}/hr</span>}
          <ConsultantLocation audience="client" city={c.city} country={c.country} icon={false} />
        </div>
      </div>
      {c.hasModule && (
        <Badge variant="secondary" className="text-[9px] bg-green-500/15 text-green-600 shrink-0">Match</Badge>
      )}
    </div>
  );
  const MatchedCard = ({ c }: { c: any }) => (
    <div>
      <ConsultantCard c={c} />
      <div className="ps-9 pb-1"><MatchWhyChips why={c.match?.why} score={c.match?.match_score} /></div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode !== 'select' && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setMode('select')}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <Gavel className="w-5 h-5 text-accent" />
            {mode === 'select' ? 'Request Bids' : mode === 'open' ? 'Public bids' : mode === 'manual' ? 'Select Consultants' : 'Recommended'}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {mode === 'select' && 'Choose how you want to invite consultants to bid'}
            {mode === 'open' && 'Open your ticket for all verified consultants'}
            {mode === 'manual' && 'Search and select consultants to invite privately'}
            {mode === 'ai' && 'Best-matching consultants for this request, with the reasons for each match'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Ticket info badge */}
          <Card className="rounded-xl border-border/50 bg-muted/30">
            <CardContent className="p-3">
              <p className="text-sm font-semibold text-foreground line-clamp-1">{ticketTitle}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant="secondary" className={`text-[9px] ${isOpenForBids ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                  {isOpenForBids ? '🟢 Open for Bids' : '⚫ Closed'}
                </Badge>
                {ticketModule && <Badge variant="secondary" className="text-[9px]">{ticketModule}</Badge>}
                {totalBids > 0 && <Badge variant="secondary" className="text-[9px]">{totalBids} bid{totalBids !== 1 ? 's' : ''}</Badge>}
                {pendingBids > 0 && <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-600">{pendingBids} pending</Badge>}
              </div>
            </CardContent>
          </Card>

          {/* ─── Mode: Select ─── */}
          {mode === 'select' && !isOpenForBids && (
            <div className="space-y-2.5">
              <ModeOption
                icon={<Globe className="w-5 h-5 text-accent" />}
                title="Public bids"
                description="All verified consultants can see and submit proposals"
                onClick={() => setMode('open')}
              />
              <ModeOption
                icon={<Users className="w-5 h-5 text-accent" />}
                title="Private Bid — Manual"
                description="Search and hand-pick consultants to invite"
                onClick={() => setMode('manual')}
              />
              <ModeOption
                icon={<Sparkles className="w-5 h-5 text-accent" />}
                title="Private Bid — Recommended"
                description="Best-matching consultants for your request, with the reasons"
                onClick={() => setMode('ai')}
              />
            </div>
          )}

          {/* ─── Mode: Select (already open) ─── */}
          {mode === 'select' && isOpenForBids && !isEditing && (
            <>
              <Card className="rounded-xl border-accent/20 bg-accent/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-accent" />
                    <p className="text-sm font-semibold text-accent">Bidding is Active</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Consultants can view this ticket and submit proposals. Review incoming bids in the "Bids" tab.
                  </p>
                </CardContent>
              </Card>

              {pendingBids > 0 && (
                <div className="flex items-start gap-2 bg-amber-500/10 rounded-lg p-2.5 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {pendingBids} pending bid{pendingBids !== 1 ? 's' : ''} to review.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2 text-xs" onClick={() => setIsEditing(true)}>
                  <Pencil className="w-3.5 h-3.5" /> Edit / Invite More
                </Button>
                <Button variant="outline" className="flex-1 gap-2 text-xs" onClick={handleCloseBids} disabled={closing}>
                  {closing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gavel className="w-3.5 h-3.5" />}
                  Close Bidding
                </Button>
              </div>
            </>
          )}

          {/* ─── Edit mode when already open ─── */}
          {mode === 'select' && isOpenForBids && isEditing && (
            <div className="space-y-2.5">
              <p className="text-xs text-muted-foreground">Invite additional consultants while bidding is open:</p>
              <ModeOption
                icon={<Users className="w-5 h-5 text-accent" />}
                title="Invite Manually"
                description="Select more consultants to send private invitations"
                onClick={() => setMode('manual')}
              />
              <ModeOption
                icon={<Sparkles className="w-5 h-5 text-accent" />}
                title="Recommendations"
                description="Best-matching consultants for your request"
                onClick={() => setMode('ai')}
              />
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setIsEditing(false)}>
                <ArrowLeft className="w-3.5 h-3.5 me-1" /> Back
              </Button>
            </div>
          )}

          {/* ─── Mode: Open Bid ─── */}
          {mode === 'open' && (
            <>
              <div className="space-y-2">
                {[
                  { icon: Globe, text: 'Visible to all verified consultants' },
                  { icon: Gavel, text: 'Consultants submit proposals with rate & timeline' },
                  { icon: ShieldCheck, text: 'No obligation — you choose the best bid' },
                  { icon: Clock, text: 'Close bidding anytime' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-start gap-2.5">
                    <Icon className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">{text}</p>
                  </div>
                ))}
              </div>
              <Label>Bidding deadline</Label>
              <Select value={deadline} onValueChange={v => setDeadline(v as DeadlineOption)}><SelectTrigger aria-label="Bidding deadline"><SelectValue /></SelectTrigger><SelectContent>{deadlineOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
              <p className="text-xs text-muted-foreground">Matching consultants are notified. You review the bids in the 'Bids' tab.</p>
              <Button className="w-full gradient-primary border-0 gap-2" onClick={handleOpenForBids} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                Open for Public Bids
              </Button>
            </>
          )}

          {/* ─── Mode: Manual Selection ─── */}
          {mode === 'manual' && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or SAP module..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {loadingConsultants ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
                ) : filteredConsultants.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No consultants found</p>
                ) : (
                  filteredConsultants.map(c => <ConsultantCard key={c.id} c={c} />)
                )}
              </div>

              {selectedConsultants.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-accent" />
                    <span className="text-xs font-medium text-foreground">{selectedConsultants.length} selected</span>
                  </div>
                  <Textarea
                    placeholder="Add a message to your invitation (optional)..."
                    value={bidMessage}
                    onChange={e => setBidMessage(e.target.value)}
                    className="min-h-[60px] text-xs"
                  />
                  <Button className="w-full gradient-primary border-0 gap-2" onClick={handleSendPrivateBids} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send Private Bid Invitations
                  </Button>
                </>
              )}
            </>
          )}

          {/* ─── Mode: AI Recommended ─── */}
          {mode === 'ai' && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-xs font-medium text-foreground">
                  Top matches for {ticketModule || 'your ticket'}
                </span>
              </div>

              {matchPhase ? (
                <TaskProgressPanel
                  title="Finding the best experts"
                  steps={matchSteps(matchPhase, understoodSummary({ title: ticketTitle, sap_module: ticketModule }))}
                  startedAt={matchStartedAt}
                  error={matchPhase === 'error' ? 'We could not load the matches. Nothing was sent to any consultant.' : null}
                  onRetry={() => void refetchMatches()}
                  cancel={{ label: 'Cancel', onClick: cancelMatches }}
                  errorAction={{ label: 'Choose consultants myself', onClick: () => setMode('manual') }}
                  skeletonCount={3}
                  className="shadow-none"
                />
              ) : loadingConsultants ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
              ) : aiRecommended.length === 0 ? (
                <Card className="rounded-xl border-border/50">
                  <CardContent className="py-6 text-center">
                    <p className="text-xs text-muted-foreground">No matching consultants found for this request. Try manual selection.</p>
                    <Button variant="link" size="sm" className="text-xs mt-1" onClick={() => setMode('manual')}>
                      Browse All Consultants
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {aiRecommended.map(c => <MatchedCard key={c.id} c={c} />)}
                </div>
              )}

              {selectedConsultants.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-accent" />
                    <span className="text-xs font-medium text-foreground">{selectedConsultants.length} selected</span>
                  </div>
                  <Textarea
                    placeholder="Add a message to your invitation (optional)..."
                    value={bidMessage}
                    onChange={e => setBidMessage(e.target.value)}
                    className="min-h-[60px] text-xs"
                  />
                  <Button className="w-full gradient-primary border-0 gap-2" onClick={handleSendPrivateBids} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send Private Bid Invitations
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <Card
      className="rounded-xl border-border/50 hover:border-accent/40 hover:shadow-sm transition-all cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-3 flex items-center gap-3">
        <div className="shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
        <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180 shrink-0" />
      </CardContent>
    </Card>
  );
}
