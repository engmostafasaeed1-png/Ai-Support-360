import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Link2, GitMerge, Ban, Copy, ArrowRight, Plus, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const LINK_TYPES = [
  { value: 'related', label: 'Related to', icon: Link2, color: 'bg-blue-100 text-blue-700' },
  { value: 'blocks', label: 'Blocks', icon: Ban, color: 'bg-red-100 text-red-700' },
  { value: 'blocked_by', label: 'Blocked by', icon: Ban, color: 'bg-orange-100 text-orange-700' },
  { value: 'duplicate', label: 'Duplicate of', icon: Copy, color: 'bg-purple-100 text-purple-700' },
];

interface Props {
  ticketId: string;
  isReadOnly?: boolean;
}

export default function TicketLinks({ ticketId, isReadOnly = false }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ['ticket-links', ticketId],
    queryFn: async () => {
      // Get links where this ticket is source or target
      const { data: sourceLinks } = await supabase
        .from('ticket_links')
        .select('*')
        .eq('source_ticket_id', ticketId);
      const { data: targetLinks } = await supabase
        .from('ticket_links')
        .select('*')
        .eq('target_ticket_id', ticketId);

      const allLinks = [
        ...(sourceLinks || []).map((l: any) => ({ ...l, direction: 'outgoing', linkedTicketId: l.target_ticket_id })),
        ...(targetLinks || []).map((l: any) => ({ ...l, direction: 'incoming', linkedTicketId: l.source_ticket_id })),
      ];

      // Fetch linked ticket titles
      const linkedIds = allLinks.map(l => l.linkedTicketId);
      if (linkedIds.length === 0) return [];
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, title, status, urgency')
        .in('id', linkedIds);
      const ticketMap = Object.fromEntries((tickets || []).map((t: any) => [t.id, t]));

      return allLinks.map(l => ({
        ...l,
        linkedTicket: ticketMap[l.linkedTicketId],
      }));
    },
  });

  const handleDelete = async (linkId: string) => {
    const { error } = await supabase.from('ticket_links').delete().eq('id', linkId);
    if (error) { toast.error('Failed'); return; }
    toast.success('Link removed');
    queryClient.invalidateQueries({ queryKey: ['ticket-links', ticketId] });
  };

  if (isLoading) return <Skeleton className="h-20 rounded-2xl" />;

  return (
    <div className="space-y-2">
      {!isReadOnly && (
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => setAddOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> Link Ticket
        </Button>
      )}

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No linked tickets</p>
      ) : (
        <div className="space-y-1.5">
          {links.map((link: any) => {
            const typeConfig = LINK_TYPES.find(t => t.value === link.link_type) || LINK_TYPES[0];
            const ticket = link.linkedTicket;
            return (
              <Card key={link.id} className="rounded-xl border-border/30">
                <CardContent className="p-2.5 flex items-center gap-2.5">
                  <Badge variant="secondary" className={`text-[10px] shrink-0 ${typeConfig.color}`}>
                    {typeConfig.label}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{ticket?.title || 'Unknown'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {ticket?.status && (
                        <Badge variant="secondary" className="text-[9px]">{ticket.status.replace(/_/g, ' ')}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link to={`/client/tickets/${link.linkedTicketId}`}>
                      <Button size="icon" variant="ghost" className="h-7 w-7">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </Link>
                    {!isReadOnly && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(link.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AddLinkDialog ticketId={ticketId} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function AddLinkDialog({ ticketId, open, onOpenChange }: { ticketId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [linkType, setLinkType] = useState('related');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: searchResults = [] } = useQuery({
    queryKey: ['ticket-search', search],
    enabled: search.length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from('tickets')
        .select('id, title, status, sap_module')
        .neq('id', ticketId)
        .ilike('title', `%${search}%`)
        .limit(5);
      return data || [];
    },
  });

  const handleAdd = async () => {
    if (!selectedId) { toast.error('Select a ticket'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('ticket_links').insert({
        source_ticket_id: ticketId,
        target_ticket_id: selectedId,
        link_type: linkType,
        created_by: user?.id,
      } as any);
      if (error) {
        if (error.code === '23505') toast.error('Link already exists');
        else throw error;
        return;
      }
      toast.success('Ticket linked');
      onOpenChange(false);
      setSearch('');
      setSelectedId('');
      queryClient.invalidateQueries({ queryKey: ['ticket-links', ticketId] });
    } catch {
      toast.error('Failed to link');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" /> Link Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Link Type</label>
            <Select value={linkType} onValueChange={setLinkType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LINK_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Search Ticket</label>
            <Input value={search} onChange={e => { setSearch(e.target.value); setSelectedId(''); }} placeholder="Type to search..." />
            {searchResults.length > 0 && (
              <div className="space-y-1 mt-1.5 max-h-40 overflow-y-auto">
                {searchResults.map((t: any) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedId(t.id); setSearch(t.title); }}
                    className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${
                      selectedId === t.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/30'
                    }`}
                  >
                    <p className="font-medium text-foreground truncate">{t.title}</p>
                    <div className="flex gap-1.5 mt-0.5">
                      <Badge variant="secondary" className="text-[9px]">{t.sap_module}</Badge>
                      <Badge variant="secondary" className="text-[9px]">{t.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={saving || !selectedId} className="gradient-primary border-0 gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
