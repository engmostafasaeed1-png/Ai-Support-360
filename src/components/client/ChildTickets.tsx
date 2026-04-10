import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, GitBranch, ChevronRight, AlertCircle, Loader2,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface ChildTicket {
  id: string;
  title: string;
  status: string;
  urgency: string;
  sap_module: string;
  created_at: string;
  child_count: number;
}

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  under_review: 'bg-indigo-100 text-indigo-700',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_for_client: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
};

function useChildTickets(parentId: string) {
  return useQuery({
    queryKey: ['child-tickets', parentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('id, title, status, urgency, sap_module, created_at')
        .eq('parent_ticket_id', parentId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Count grandchildren for each child
      const results: ChildTicket[] = [];
      for (const ticket of data || []) {
        const { count } = await supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('parent_ticket_id', ticket.id);
        results.push({
          ...ticket,
          urgency: ticket.urgency || 'medium',
          status: ticket.status || 'new',
          child_count: count || 0,
        });
      }
      return results;
    },
  });
}

function useTicketAncestors(ticketId: string) {
  return useQuery({
    queryKey: ['ticket-ancestors', ticketId],
    queryFn: async () => {
      const ancestors: { id: string; title: string }[] = [];
      let currentId: string | null = ticketId;

      // Walk up the tree (max 10 levels to prevent infinite loops)
      for (let i = 0; i < 10 && currentId; i++) {
        const { data } = await supabase
          .from('tickets')
          .select('id, title, parent_ticket_id')
          .eq('id', currentId)
          .single();
        if (!data) break;
        if (data.id !== ticketId) {
          ancestors.unshift({ id: data.id, title: data.title });
        }
        currentId = (data as any).parent_ticket_id || null;
      }
      return ancestors;
    },
  });
}

interface ChildTicketsProps {
  ticketId: string;
  ticketSapModule: string;
  ticketClientId: string;
  tenantId?: string | null;
}

export default function ChildTickets({ ticketId, ticketSapModule, ticketClientId, tenantId }: ChildTicketsProps) {
  const { data: children, isLoading } = useChildTickets(ticketId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Sub-Tickets</span>
          {children && children.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{children.length}</Badge>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3 h-3" /> Add Sub-Ticket
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : children && children.length > 0 ? (
        <div className="space-y-2">
          {children.map(child => (
            <ChildTicketRow key={child.id} ticket={child} />
          ))}
        </div>
      ) : (
        <Card className="rounded-xl border-border/30">
          <CardContent className="py-6 text-center">
            <GitBranch className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No sub-tickets yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Break this ticket into smaller tasks</p>
          </CardContent>
        </Card>
      )}

      <CreateChildTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        parentTicketId={ticketId}
        sapModule={ticketSapModule}
        clientId={ticketClientId}
        tenantId={tenantId}
      />
    </div>
  );
}

export function TicketBreadcrumbs({ ticketId }: { ticketId: string }) {
  const { data: ancestors } = useTicketAncestors(ticketId);
  const location = useLocation();
  const basePath = location.pathname.startsWith('/admin')
    ? '/admin/tickets'
    : location.pathname.startsWith('/consultant')
    ? '/consultant/tickets'
    : '/client/tickets';

  if (!ancestors || ancestors.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground mb-2">
      {ancestors.map((a, i) => (
        <span key={a.id} className="flex items-center gap-1">
          <Link
            to={`${basePath}/${a.id}`}
            className="hover:text-primary transition-colors truncate max-w-[150px]"
            title={a.title}
          >
            {a.title}
          </Link>
          <ChevronRight className="w-3 h-3 shrink-0" />
        </span>
      ))}
      <span className="text-foreground font-medium">Current</span>
    </div>
  );
}

function ChildTicketRow({ ticket }: { ticket: ChildTicket }) {
  const location = useLocation();
  const basePath = location.pathname.startsWith('/admin')
    ? '/admin/tickets'
    : location.pathname.startsWith('/consultant')
    ? '/consultant/tickets'
    : '/client/tickets';

  return (
    <Link to={`${basePath}/${ticket.id}`}>
      <Card className="rounded-xl border-border/30 hover:shadow-sm hover:border-primary/20 transition-all cursor-pointer">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <GitBranch className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{ticket.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${urgencyColors[ticket.urgency]}`}>
                {ticket.urgency}
              </Badge>
              <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${statusColors[ticket.status]}`}>
                {ticket.status.replace(/_/g, ' ')}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ticket.child_count > 0 && (
              <Badge variant="outline" className="text-[9px] gap-0.5">
                <GitBranch className="w-2.5 h-2.5" /> {ticket.child_count}
              </Badge>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

const urgencyOptions = ['low', 'medium', 'high', 'critical'];

function CreateChildTicketDialog({
  open, onOpenChange, parentTicketId, sapModule, clientId, tenantId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parentTicketId: string;
  sapModule: string;
  clientId: string;
  tenantId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    urgency: 'medium',
  });

  const handleCreate = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('tickets').insert({
        parent_ticket_id: parentTicketId,
        client_id: clientId,
        tenant_id: tenantId || null,
        sap_module: sapModule,
        title: form.title.trim(),
        description: form.description.trim() || null,
        urgency: form.urgency as any,
      });
      if (error) throw error;
      toast.success('Sub-ticket created');
      queryClient.invalidateQueries({ queryKey: ['child-tickets', parentTicketId] });
      setForm({ title: '', description: '', urgency: 'medium' });
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to create sub-ticket');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" /> Create Sub-Ticket
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Sub-ticket title..."
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the sub-task..."
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="space-y-2">
            <Label>Urgency</Label>
            <Select value={form.urgency} onValueChange={v => setForm(f => ({ ...f, urgency: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {urgencyOptions.map(u => (
                  <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Inherits SAP module ({sapModule}) from parent ticket. Sub-tickets can have their own sub-tickets.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving} className="gradient-primary border-0">
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            Create Sub-Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
