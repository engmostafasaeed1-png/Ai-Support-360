import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TicketDetail {
  id: string;
  title: string;
  description: string | null;
  sap_module: string;
  urgency: string;
  status: string;
  preferred_language: string | null;
  preferred_session_type: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  sla_deadline: string | null;
  ai_suggested_category: string | null;
  ai_suggested_priority: string | null;
  client_id: string;
  consultant_id: string | null;
  consultant_name?: string;
  open_for_bids: boolean;
  opened_for_bids_at: string | null;
  parent_ticket_id: string | null;
}

export function useTicketDetail(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['ticket-detail', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('id', ticketId!)
        .single();
      if (error) throw error;

      let consultant_name: string | undefined;
      if (data.consultant_id) {
        const { data: c } = await supabase
          .from('consultants')
          .select('user_id')
          .eq('id', data.consultant_id)
          .single();
        if (c) {
          const { data: p } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('user_id', c.user_id)
            .single();
          consultant_name = p?.display_name || undefined;
        }
      }

      return {
        ...data,
        urgency: data.urgency || 'medium',
        status: data.status || 'new',
        consultant_name,
      } as TicketDetail;
    },
  });
}

export function useTicketSessions(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['ticket-sessions', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, session_type, status, scheduled_at, started_at, ended_at, duration_minutes, notes, ai_summary, consultant_id')
        .eq('ticket_id', ticketId!)
        .order('scheduled_at', { ascending: false });
      if (error) throw error;

      // Resolve consultant names
      const consultantIds = [...new Set((data || []).map(s => s.consultant_id))];
      const consultantUserMap: Record<string, string> = {};
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', consultantIds);
        const userIds = (consultants || []).map(c => c.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', userIds);
        const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name || 'Unknown']));
        for (const c of consultants || []) {
          consultantUserMap[c.id] = profileMap[c.user_id] || 'Unknown';
        }
      }

      return (data || []).map(s => ({
        ...s,
        consultant_name: consultantUserMap[s.consultant_id] || 'Unassigned',
      }));
    },
  });
}

export function useTicketMessages(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['ticket-messages', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      // Get sessions linked to this ticket
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('ticket_id', ticketId!);
      if (!sessions || sessions.length === 0) return [];

      const sessionIds = sessions.map(s => s.id);
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, content, message_type, sender_id, session_id, created_at, file_name, file_url')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Resolve sender names
      const senderIds = [...new Set((messages || []).map(m => m.sender_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', senderIds);
      const nameMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name || 'Unknown']));

      return (messages || []).map(m => ({
        ...m,
        sender_name: nameMap[m.sender_id] || 'Unknown',
      }));
    },
  });
}
