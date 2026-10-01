import { supabase } from '@/integrations/supabase/client';

export type RsvpAnswer = 'accepted' | 'declined' | 'reschedule_requested';

export const RSVP_LABEL: Record<string, string> = {
  pending: 'Not answered yet',
  accepted: 'Accepted',
  declined: 'Declined',
  reschedule_requested: 'Asked for another time',
};

/** What the reply page needs; returned by the interview-rsvp edge function. */
export interface RsvpDetails {
  role: string;
  myStatus: string;
  organizerName: string;
  candidateName: string | null;
  others: { name: string; role: string }[];
  scheduledAt: string | null;
  durationMinutes: number;
  meetingUrl: string;
  finished: boolean;
  roomPath: string;
}

/** Calls one of the interview e-mail edge functions and turns any failure into a readable message. */
export async function callInterviewFunction<T = any>(
  name: 'interview-rsvp' | 'send-interview-invitations',
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message || 'Something went wrong';
    try {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === 'function') {
        const payload = await response.json();
        if (payload && typeof payload.error === 'string') message = payload.error;
      }
    } catch {
      // keep the generic message
    }
    return { data: null, error: message };
  }
  if (data && typeof (data as { error?: unknown }).error === 'string') {
    return { data: null, error: (data as { error: string }).error };
  }
  return { data: data as T, error: null };
}
