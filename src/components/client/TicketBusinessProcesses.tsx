import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Network, Plus, Trash2, Loader2 } from 'lucide-react';

interface Props {
  ticketId: string;
  isReadOnly?: boolean;
}

export default function TicketBusinessProcesses({ ticketId, isReadOnly = false }: Props) {
  const queryClient = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);

  const { data: linked = [], isLoading } = useQuery({
    queryKey: ['ticket-business-processes', ticketId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ticket_business_processes')
        .select('*')
        .eq('ticket_id', ticketId);
      if (!data || data.length === 0) return [];
      const bpIds = data.map((d: any) => d.business_process_id);
      const { data: bps } = await supabase
        .from('business_processes')
        .select('*')
        .in('id', bpIds);
      const bpMap = Object.fromEntries((bps || []).map((b: any) => [b.id, b]));
      return data.map((d: any) => ({ ...d, process: bpMap[d.business_process_id] }));
    },
  });

  const handleUnlink = async (id: string) => {
    const { error } = await supabase.from('ticket_business_processes').delete().eq('id', id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Unlinked');
    queryClient.invalidateQueries({ queryKey: ['ticket-business-processes', ticketId] });
  };

  if (isLoading) return <Skeleton className="h-16 rounded-xl" />;

  return (
    <div className="space-y-2">
      {!isReadOnly && (
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => setLinkOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> Link Business Process
        </Button>
      )}
      {linked.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-3">No linked business processes</p>
      ) : (
        <div className="space-y-1.5">
          {linked.map((item: any) => (
            <Card key={item.id} className="rounded-xl border-border/30">
              <CardContent className="p-2.5 flex items-center gap-2.5">
                <Network className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.process?.name || 'Unknown'}</p>
                  <div className="flex gap-1.5 mt-0.5">
                    {item.process?.category && <Badge variant="secondary" className="text-[9px]">{item.process.category}</Badge>}
                    {item.process?.sap_module && <Badge variant="outline" className="text-[9px]">{item.process.sap_module}</Badge>}
                  </div>
                </div>
                {!isReadOnly && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleUnlink(item.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <LinkProcessDialog ticketId={ticketId} open={linkOpen} onOpenChange={setLinkOpen} existingIds={linked.map((l: any) => l.business_process_id)} />
    </div>
  );
}

function LinkProcessDialog({ ticketId, open, onOpenChange, existingIds }: { ticketId: string; open: boolean; onOpenChange: (v: boolean) => void; existingIds: string[] }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: processes = [] } = useQuery({
    queryKey: ['business-processes-for-link'],
    enabled: open,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('business_processes')
        .select('id, name, category, sap_module')
        .eq('client_id', user.id)
        .order('name');
      return (data || []).filter((p: any) => !existingIds.includes(p.id));
    },
  });

  const handleLink = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('ticket_business_processes').insert({
        ticket_id: ticketId,
        business_process_id: selectedId,
        linked_by: user?.id,
      } as any);
      if (error) throw error;
      toast.success('Business process linked');
      queryClient.invalidateQueries({ queryKey: ['ticket-business-processes', ticketId] });
      onOpenChange(false);
      setSelectedId('');
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
          <DialogTitle className="flex items-center gap-2"><Network className="w-4 h-4 text-primary" /> Link Business Process</DialogTitle>
        </DialogHeader>
        <div className="py-3">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger><SelectValue placeholder="Select a business process..." /></SelectTrigger>
            <SelectContent>
              {processes.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name} {p.sap_module ? `(${p.sap_module})` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {processes.length === 0 && <p className="text-xs text-muted-foreground mt-2">No processes available. Add them in Business Processes page first.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleLink} disabled={saving || !selectedId} className="gradient-primary border-0 gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />} Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
