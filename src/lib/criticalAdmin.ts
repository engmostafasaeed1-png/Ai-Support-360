import { msLeft } from '@/lib/criticalService';

/** One critical request as the administrator sees it: the ticket, its reply window and how many consultants were alerted and replied. */
export type AdminCriticalRequest = {
  id: string;
  title: string;
  ticket_status: string;
  critical_status: 'waiting' | 'answered' | 'missed';
  due_at: string;
  surcharge_percent: number;
  extensions: number;
  consultant_assigned: boolean;
  created_at: string;
  alerted: number;
  replied: number;
};

export type AdminCriticalState = 'waiting' | 'answered' | 'ended';

const FINISHED = ['resolved', 'closed', 'cancelled'];

/** waiting = the window is open and nobody replied in time yet; answered = somebody replied in time; ended = the window is over without a reply. */
export function adminCriticalState(r: Pick<AdminCriticalRequest, 'critical_status' | 'due_at'>, now: number = Date.now()): AdminCriticalState {
  if (r.critical_status === 'answered') return 'answered';
  return r.critical_status === 'waiting' && msLeft(r.due_at, now) > 0 ? 'waiting' : 'ended';
}

/** True while a consultant could still be found for the request: no consultant is assigned and the ticket is not finished. */
export function isStillOpen(r: Pick<AdminCriticalRequest, 'ticket_status' | 'consultant_assigned'>): boolean {
  return !r.consultant_assigned && !FINISHED.includes(r.ticket_status);
}

/** What the administrator should act on, in one sentence (null when nothing is wrong). */
export function adminAttention(r: AdminCriticalRequest, now: number = Date.now()): string | null {
  if (!isStillOpen(r)) return null;
  const state = adminCriticalState(r, now);
  if (state === 'answered') return null;
  if (r.alerted === 0) return 'Nobody could be alerted: contact a consultant yourself';
  if (state === 'ended' && r.replied === 0) return 'Nobody replied in time: contact a consultant, or ask the client to give more time';
  return null;
}

/** The numbers for the notice on top of the list. */
export function adminCriticalSummary(rows: AdminCriticalRequest[] | null | undefined, now: number = Date.now()): { waiting: number; needAttention: number } {
  const list = rows ?? [];
  return {
    waiting: list.filter((r) => isStillOpen(r) && adminCriticalState(r, now) === 'waiting').length,
    needAttention: list.filter((r) => adminAttention(r, now) !== null).length,
  };
}

/** The part of the database client that the loader uses (the generated types do not know the critical-service columns yet). */
export type AdminCriticalClient = { from: (table: string) => any };

const TICKET_COLUMNS = 'id, title, status, created_at, consultant_id, critical_status, critical_due_at, critical_surcharge_percent, critical_extensions';
const OPEN_REQUEST_DAYS = 14;
const OPEN_REQUEST_LIMIT = 20;

/**
 * The latest critical requests, plus every request of the last 14 days that has no consultant and no reply in time yet (so a request that needs a
 * person does not drop out of the list when newer requests arrive), each with the exact number of alerted consultants and of replies.
 * A failed query throws: it must never turn into "nobody was alerted".
 */
export async function fetchAdminCriticalRequests(client: AdminCriticalClient, limit: number = 12, now: number = Date.now()): Promise<AdminCriticalRequest[]> {
  const since = new Date(now - OPEN_REQUEST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [latest, unanswered] = await Promise.all([
    client.from('tickets').select(TICKET_COLUMNS).eq('critical_response', true).order('created_at', { ascending: false }).limit(limit),
    client
      .from('tickets')
      .select(TICKET_COLUMNS)
      .eq('critical_response', true)
      .is('consultant_id', null)
      .in('critical_status', ['waiting', 'missed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(OPEN_REQUEST_LIMIT),
  ]);
  if (latest.error) throw new Error(latest.error.message);
  if (unanswered.error) throw new Error(unanswered.error.message);

  const byId = new Map<string, any>();
  [...(latest.data ?? []), ...(unanswered.data ?? [])].forEach((t: any) => byId.set(t.id as string, t));
  const tickets: any[] = Array.from(byId.values()).sort((a, b) => Date.parse(b.created_at as string) - Date.parse(a.created_at as string));
  if (tickets.length === 0) return [];

  // exact counts per ticket: a head request returns only the number, so the row limit of the server can never cut it
  const countRows = async (table: 'critical_alerts' | 'critical_replies', ticketId: string): Promise<number> => {
    const { count, error } = await client.from(table).select('id', { count: 'exact', head: true }).eq('ticket_id', ticketId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [alerted, replied] = await Promise.all([
    Promise.all(tickets.map((t) => countRows('critical_alerts', t.id as string))),
    Promise.all(tickets.map((t) => countRows('critical_replies', t.id as string))),
  ]);

  return tickets.map((t, i) => ({
    id: t.id as string,
    title: (t.title as string) || 'Untitled request',
    ticket_status: (t.status as string) || 'new',
    critical_status: t.critical_status as AdminCriticalRequest['critical_status'],
    due_at: t.critical_due_at as string,
    surcharge_percent: Number(t.critical_surcharge_percent ?? 0),
    extensions: Number(t.critical_extensions ?? 0),
    consultant_assigned: !!t.consultant_id,
    created_at: t.created_at as string,
    alerted: alerted[i] ?? 0,
    replied: replied[i] ?? 0,
  }));
}
