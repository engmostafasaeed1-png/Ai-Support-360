import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Search, Star, Brain, Send, CheckCircle2 } from 'lucide-react';

interface Props {
  ticketId: string;
  sapModule: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SendMatchRequestDialog({ ticketId, sapModule, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState<string | null>(null);

  // Fetch verified consultants with relevant skills
  const { data: consultants, isLoading } = useQuery({
    queryKey: ['available-consultants', sapModule, search],
    enabled: open,
    queryFn: async () => {
      // Get consultants with matching skills
      let query = supabase
        .from('consultants')
        .select(`id, user_id, hourly_rate, currency, rating, total_reviews, ai_skills_score, availability_status, languages,
          consultant_skills (sap_module, proficiency_level)`)
        .in('verification_status', ['verified', 'pending'] as any[])
        .limit(20);

      const { data, error } = await query;
      if (error) throw error;

      // Get profiles for display names
      const userIds = (data || []).map(c => c.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      // Get existing match requests for this ticket
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
            modules,
            hasModule,
            alreadySent: sentIds.has(c.id),
          };
        })
        .filter((c: any) => {
          if (search) {
            return c.name.toLowerCase().includes(search.toLowerCase()) ||
              c.modules.some((m: string) => m.toLowerCase().includes(search.toLowerCase()));
          }
          return true;
        })
        .sort((a: any, b: any) => {
          // Prioritize: relevant module > rating > ai_score
          if (a.hasModule !== b.hasModule) return a.hasModule ? -1 : 1;
          return (b.rating || 0) - (a.rating || 0);
        });
    },
  });

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Send Match Request</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Search and invite consultants to work on your ticket
          </p>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
          {/* Search */}
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or SAP module..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="ps-9"
            />
          </div>

          {/* Message for all requests */}
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
            ) : !consultants?.length ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No consultants found
              </div>
            ) : (
              consultants.map((c: any) => (
                <Card key={c.id} className={`rounded-xl border-border/50 ${c.hasModule ? 'ring-1 ring-accent/30' : ''}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                        {c.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground text-sm">{c.name}</p>
                          {c.hasModule && (
                            <Badge variant="secondary" className="text-[9px] bg-accent/10 text-accent">Relevant</Badge>
                          )}
                          {c.availability === 'available' && (
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> {c.rating}</span>
                          <span className="flex items-center gap-1"><Brain className="w-3 h-3 text-accent" /> {c.ai_score}</span>
                          <span>${c.hourly_rate}/hr</span>
                        </div>
                        {c.modules.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.modules.slice(0, 4).map((m: string) => (
                              <Badge key={m} variant="secondary" className="text-[9px]">{m}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        {c.alreadySent ? (
                          <Badge variant="secondary" className="gap-1 text-xs bg-green-100 text-green-700">
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
                            Send Request
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
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
