import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';

export interface PMTicket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  urgency: string;
  sap_module: string;
  ticket_type: string;
  consultant_id: string | null;
  consultant_name?: string;
  planned_hours: number | null;
  planned_cost: number | null;
  cost_currency: string | null;
  sla_deadline: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export function useProjectManagementTickets() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('pm-tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pm-tickets'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [queryClient]);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['pm-tickets', tenant?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      let query = supabase
        .from('tickets')
        .select('id, title, description, status, urgency, sap_module, ticket_type, consultant_id, planned_hours, planned_cost, cost_currency, sla_deadline, created_at, updated_at, resolved_at, resolution_notes')
        .eq('client_id', user.id)
        .eq('ticket_type', 'project')
        .order('created_at', { ascending: false });

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Resolve consultant names
      const consultantIds = [...new Set((data || []).map(t => t.consultant_id).filter(Boolean))];
      const consultantMap: Record<string, string> = {};
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', consultantIds as string[]);
        if (consultants?.length) {
          const userIds = consultants.map(c => c.user_id);
          const { data: profiles } = await supabase
            .from('profile_directory')
            .select('user_id, display_name')
            .in('user_id', userIds);
          const profileMap: Record<string, string> = {};
          (profiles || []).forEach(p => { if (p.user_id) profileMap[p.user_id] = p.display_name || 'Consultant'; });
          consultants.forEach(c => { consultantMap[c.id] = profileMap[c.user_id] || 'Consultant'; });
        }
      }

      return (data || []).map((t: any) => ({
        ...t,
        urgency: t.urgency || 'medium',
        status: t.status || 'new',
        consultant_name: t.consultant_id ? (consultantMap[t.consultant_id] || 'Assigned') : undefined,
      })) as PMTicket[];
    },
  });

  const createTicket = useMutation({
    mutationFn: async (ticket: { title: string; description?: string; sap_module: string; urgency?: string; planned_hours?: number; planned_cost?: number; cost_currency?: string; sla_deadline?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('tickets').insert({
        title: ticket.title,
        description: ticket.description || null,
        sap_module: ticket.sap_module,
        urgency: (ticket.urgency as any) || 'medium',
        ticket_type: 'project',
        client_id: user.id,
        planned_hours: ticket.planned_hours || null,
        planned_cost: ticket.planned_cost || null,
        cost_currency: ticket.cost_currency || 'USD',
        sla_deadline: ticket.sla_deadline || null,
        tenant_id: tenant?.id || null,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pm-tickets'] });
      toast({ title: 'Ticket created successfully' });
    },
    onError: (e: Error) => toast({ title: 'Error creating ticket', description: e.message, variant: 'destructive' }),
  });

  const updateTicket = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PMTicket> & { id: string }) => {
      const { error } = await supabase.from('tickets').update({ ...updates, updated_at: new Date().toISOString() } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pm-tickets'] });
      toast({ title: 'Ticket updated' });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteTicket = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tickets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pm-tickets'] });
      toast({ title: 'Ticket deleted' });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // Computed stats
  const stats = {
    total: tickets.length,
    inProgress: tickets.filter(t => t.status === 'in_progress').length,
    resolved: tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length,
    critical: tickets.filter(t => t.urgency === 'critical').length,
    totalPlannedHours: tickets.reduce((sum, t) => sum + (t.planned_hours || 0), 0),
    newTickets: tickets.filter(t => t.status === 'new').length,
  };

  return { tickets, isLoading, createTicket, updateTicket, deleteTicket, stats };
}
