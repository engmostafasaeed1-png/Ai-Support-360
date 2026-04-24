import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TimelineTicket {
  id: string;
  title: string;
  status: string | null;
  urgency: string | null;
  sap_module: string;
  created_at: string;
  resolved_at: string | null;
  consultant_id: string | null;
  consultant_name?: string | null;
  match_requests: {
    id: string;
    status: string;
    created_at: string;
    responded_at: string | null;
    consultant_name?: string | null;
  }[];
  interview?: {
    id: string;
    status: string;
    scheduled_at: string | null;
    started_at: string | null;
    ended_at: string | null;
  } | null;
  sessions: {
    id: string;
    session_type: string | null;
    status: string | null;
    scheduled_at: string | null;
    started_at: string | null;
    ended_at: string | null;
    duration_minutes: number | null;
    meeting_url: string | null;
  }[];
}

export function useClientTimeline() {
  return useQuery({
    queryKey: ['client-timeline'],
    queryFn: async (): Promise<TimelineTicket[]> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return [];

      const { data: tickets, error: tErr } = await supabase
        .from('tickets')
        .select('id, title, status, urgency, sap_module, created_at, resolved_at, consultant_id')
        .eq('client_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);
      if (tErr) throw tErr;
      if (!tickets || tickets.length === 0) return [];

      const ticketIds = tickets.map(t => t.id);
      const consultantIds = Array.from(
        new Set(tickets.map(t => t.consultant_id).filter((x): x is string => !!x))
      );

      const [matchesRes, interviewsRes, sessionsRes] = await Promise.all([
        supabase
          .from('ticket_match_requests')
          .select('id, ticket_id, consultant_id, status, created_at, responded_at')
          .in('ticket_id', ticketIds),
        supabase
          .from('ticket_interviews')
          .select('id, ticket_id, status, scheduled_at, started_at, ended_at')
          .in('ticket_id', ticketIds),
        supabase
          .from('sessions')
          .select('id, ticket_id, session_type, status, scheduled_at, started_at, ended_at, duration_minutes, meeting_url')
          .in('ticket_id', ticketIds),
      ]);

      const matchConsultantIds = (matchesRes.data || [])
        .map(m => m.consultant_id)
        .filter((x): x is string => !!x);
      const allConsultantIds = Array.from(new Set([...consultantIds, ...matchConsultantIds]));

      const consultantNames = new Map<string, string>();
      if (allConsultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', allConsultantIds);
        const userIds = (consultants || []).map(c => c.user_id);
        const profiles = userIds.length
          ? (await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds)).data || []
          : [];
        const profileMap = new Map(profiles.map(p => [p.user_id, p.display_name]));
        (consultants || []).forEach(c => {
          consultantNames.set(c.id, profileMap.get(c.user_id) || 'Consultant');
        });
      }

      return tickets.map(t => ({
        ...t,
        consultant_name: t.consultant_id ? consultantNames.get(t.consultant_id) ?? null : null,
        match_requests: (matchesRes.data || [])
          .filter(m => m.ticket_id === t.id)
          .map(m => ({
            id: m.id,
            status: m.status,
            created_at: m.created_at,
            responded_at: m.responded_at,
            consultant_name: consultantNames.get(m.consultant_id) ?? 'Consultant',
          })),
        interview: (interviewsRes.data || []).find(i => i.ticket_id === t.id) || null,
        sessions: (sessionsRes.data || [])
          .filter(s => s.ticket_id === t.id)
          .sort((a, b) => {
            const ta = new Date(a.scheduled_at || a.started_at || 0).getTime();
            const tb = new Date(b.scheduled_at || b.started_at || 0).getTime();
            return ta - tb;
          }),
      }));
    },
  });
}
