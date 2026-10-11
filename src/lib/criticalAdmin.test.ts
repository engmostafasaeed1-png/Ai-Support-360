import { describe, it, expect } from 'vitest';
import { adminAttention, adminCriticalState, adminCriticalSummary, fetchAdminCriticalRequests, isStillOpen, type AdminCriticalRequest } from './criticalAdmin';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const row = (over: Partial<AdminCriticalRequest> = {}): AdminCriticalRequest => ({
  id: 't1', title: 'Posting fails', ticket_status: 'new', critical_status: 'waiting', due_at: at(20), surcharge_percent: 30, extensions: 0,
  consultant_assigned: false, created_at: at(-10), alerted: 5, replied: 0, ...over,
});

describe('adminCriticalState', () => {
  it('is waiting while the window is open and nobody replied in time', () => {
    expect(adminCriticalState(row(), NOW)).toBe('waiting');
  });

  it('is answered once somebody replied in time, also after the window', () => {
    expect(adminCriticalState(row({ critical_status: 'answered' }), NOW)).toBe('answered');
    expect(adminCriticalState(row({ critical_status: 'answered', due_at: at(-5) }), NOW)).toBe('answered');
  });

  it('has ended when the window is over, even before the minute job marked it missed', () => {
    expect(adminCriticalState(row({ critical_status: 'missed', due_at: at(-5) }), NOW)).toBe('ended');
    expect(adminCriticalState(row({ critical_status: 'waiting', due_at: at(-1) }), NOW)).toBe('ended');
  });
});

describe('isStillOpen', () => {
  it('is false once a consultant is assigned or the ticket is finished', () => {
    expect(isStillOpen(row())).toBe(true);
    expect(isStillOpen(row({ consultant_assigned: true }))).toBe(false);
    expect(isStillOpen(row({ ticket_status: 'closed' }))).toBe(false);
    expect(isStillOpen(row({ ticket_status: 'cancelled' }))).toBe(false);
  });
});

describe('adminAttention', () => {
  it('says nothing for a request that is waiting normally or was answered', () => {
    expect(adminAttention(row(), NOW)).toBeNull();
    expect(adminAttention(row({ critical_status: 'answered', replied: 1 }), NOW)).toBeNull();
  });

  it('asks the administrator to act when nobody could be alerted', () => {
    expect(adminAttention(row({ alerted: 0 }), NOW)).toBe('Nobody could be alerted: contact a consultant yourself');
  });

  it('asks the administrator to act when the window ended without a reply', () => {
    expect(adminAttention(row({ critical_status: 'missed', due_at: at(-3) }), NOW)).toBe(
      'Nobody replied in time: contact a consultant, or ask the client to give more time',
    );
  });

  it('says nothing once a consultant works on the ticket', () => {
    expect(adminAttention(row({ alerted: 0, consultant_assigned: true }), NOW)).toBeNull();
    expect(adminAttention(row({ critical_status: 'missed', due_at: at(-3), ticket_status: 'resolved' }), NOW)).toBeNull();
  });
});

describe('adminCriticalSummary', () => {
  it('counts the open requests that wait and the ones that need attention', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', alerted: 0 }),
      row({ id: 'c', critical_status: 'missed', due_at: at(-4) }),
      row({ id: 'd', critical_status: 'answered', replied: 2 }),
      row({ id: 'e', consultant_assigned: true }),
    ];
    expect(adminCriticalSummary(rows, NOW)).toEqual({ waiting: 2, needAttention: 2 });
    expect(adminCriticalSummary([], NOW)).toEqual({ waiting: 0, needAttention: 0 });
    expect(adminCriticalSummary(null, NOW)).toEqual({ waiting: 0, needAttention: 0 });
  });
});

type Answer = { data?: unknown; error?: { message: string } | null; count?: number | null };
type Query = { table: string; filters: Record<string, unknown> };

/** A fake database client: every query is answered by the handler and its filters are recorded. */
function fakeClient(handler: (q: Query) => Answer) {
  const queries: Query[] = [];
  return {
    queries,
    from(table: string) {
      const q: Query = { table, filters: {} };
      const builder: any = {};
      ['select', 'eq', 'is', 'in', 'gte', 'order', 'limit'].forEach((op) => {
        builder[op] = (...args: unknown[]) => {
          if (op === 'eq' || op === 'is' || op === 'in' || op === 'gte') q.filters[op + ':' + String(args[0])] = args[1];
          return builder;
        };
      });
      builder.then = (resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) => {
        queries.push(q);
        return Promise.resolve(handler(q)).then(resolve, reject);
      };
      return builder;
    },
  };
}

const dbTicket = (over: Record<string, unknown> = {}) => ({
  id: 'a', title: 'Posting fails', status: 'new', created_at: at(-10), consultant_id: null, critical_status: 'waiting', critical_due_at: at(20),
  critical_surcharge_percent: 30, critical_extensions: 0, ...over,
});

describe('fetchAdminCriticalRequests', () => {
  it('adds the open requests that dropped out of the latest ones, newest first and without doubles, with exact counts', async () => {
    const client = fakeClient((q) => {
      if (q.table === 'tickets' && 'is:consultant_id' in q.filters) {
        return { data: [dbTicket({ id: 'old', title: '', status: null, created_at: at(-3000), critical_status: 'missed', critical_due_at: at(-2900) }), dbTicket({ id: 'a' })] };
      }
      if (q.table === 'tickets') return { data: [dbTicket({ id: 'a' }), dbTicket({ id: 'b', created_at: at(-5), consultant_id: 'c1', critical_status: 'answered', critical_extensions: 2 })] };
      const id = q.filters['eq:ticket_id'];
      if (q.table === 'critical_alerts') return { count: id === 'a' ? 1200 : id === 'b' ? 4 : 0 };
      return { count: id === 'b' ? 1 : null };
    });
    const rows = await fetchAdminCriticalRequests(client, 12, NOW);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'old']);
    expect(rows[0]).toEqual({
      id: 'b', title: 'Posting fails', ticket_status: 'new', critical_status: 'answered', due_at: at(20), surcharge_percent: 30, extensions: 2,
      consultant_assigned: true, created_at: at(-5), alerted: 4, replied: 1,
    });
    expect(rows[1].alerted).toBe(1200);
    expect(rows[1].replied).toBe(0);
    expect(rows[2].title).toBe('Untitled request');
    expect(rows[2].ticket_status).toBe('new');
    const openQuery = client.queries.find((q) => 'is:consultant_id' in q.filters);
    expect(openQuery ? openQuery.filters['gte:created_at'] : null).toBe(new Date(NOW - 14 * 24 * 60 * 60 * 1000).toISOString());
    expect(openQuery ? openQuery.filters['in:critical_status'] : null).toEqual(['waiting', 'missed']);
  });

  it('answers an empty list without asking for counts when there is no critical request', async () => {
    const client = fakeClient(() => ({ data: [] }));
    expect(await fetchAdminCriticalRequests(client, 12, NOW)).toEqual([]);
    expect(client.queries.filter((q) => q.table !== 'tickets').length).toBe(0);
  });

  it('fails when a count cannot be read, instead of reporting that nobody was alerted', async () => {
    const client = fakeClient((q) => {
      if (q.table === 'tickets') return { data: [dbTicket()] };
      if (q.table === 'critical_alerts') return { count: null, error: { message: 'statement timeout' } };
      return { count: 0 };
    });
    const failure = await fetchAdminCriticalRequests(client, 12, NOW).then(() => 'no error', (e: Error) => e.message);
    expect(failure).toBe('statement timeout');
  });

  it('fails when the tickets cannot be read', async () => {
    const client = fakeClient((q) => (q.table === 'tickets' ? { data: null, error: { message: 'permission denied' } } : { count: 0 }));
    const failure = await fetchAdminCriticalRequests(client, 12, NOW).then(() => 'no error', (e: Error) => e.message);
    expect(failure).toBe('permission denied');
  });
});
