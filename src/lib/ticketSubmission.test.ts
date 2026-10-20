import { describe, it, expect, vi } from 'vitest';
import { PENDING_KEY, clearPending, pendingIdFor, readPending, requestFingerprint, saveTicketOnce, singleFlight, type KeyValueStorage } from './ticketSubmission';

const makeStorage = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

/** A tickets table with a primary key: a second insert of the same id fails like the database does. */
const makeTable = () => {
  const rows = new Set<string>();
  const insert = vi.fn(async (id: string) => {
    await new Promise((r) => setTimeout(r, 5));
    if (rows.has(id)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "tickets_pkey"' } };
    rows.add(id);
    return { error: null };
  });
  return { rows, insert };
};

let n = 0;
const newId = () => `id-${++n}`;
const fp = requestFingerprint(['FB50 posting error', 'details', ['FI'], 'high']);

describe('duplicate-safe ticket submit', () => {
  it('a double click creates one ticket', async () => {
    const storage = makeStorage();
    const table = makeTable();
    const submit = singleFlight(() => saveTicketOnce({ storage, fingerprint: fp, insert: table.insert, newId }));
    const [a, b] = await Promise.all([submit(), submit()]);
    expect(table.insert).toHaveBeenCalledTimes(1);
    expect(table.rows.size).toBe(1);
    expect(a.id).toBe(b.id);
  });

  it('a retry after a page refresh reuses the stored id, so the ticket is not stored twice', async () => {
    const storage = makeStorage(); // sessionStorage survives the refresh
    const table = makeTable();
    // first try: saved on the server, but the answer is lost
    const lostAnswer = vi.fn(async (id: string) => { await table.insert(id); throw new TypeError('Failed to fetch'); });
    await expect(saveTicketOnce({ storage, fingerprint: fp, insert: lostAnswer, newId })).rejects.toThrow('Failed to fetch');
    // after the refresh: a new page sends the same request again
    const second = await saveTicketOnce({ storage, fingerprint: fp, insert: table.insert, newId });
    expect(second.alreadySaved).toBe(true);
    expect(table.rows.size).toBe(1);
    expect([...table.rows][0]).toBe(second.id);
  });

  it('keeps the id after a failure and retries with it', async () => {
    const storage = makeStorage();
    const failing = vi.fn(async (_id: string) => ({ error: { code: '08006', message: 'connection failure' } }));
    await expect(saveTicketOnce({ storage, fingerprint: fp, insert: failing, newId })).rejects.toMatchObject({ code: '08006' });
    const firstId = failing.mock.calls[0][0];
    const table = makeTable();
    const retry = await saveTicketOnce({ storage, fingerprint: fp, insert: table.insert, newId });
    expect(retry.id).toBe(firstId);
    expect(retry.alreadySaved).toBe(false);
  });

  it('a changed request gets a new id', () => {
    const storage = makeStorage();
    const first = pendingIdFor(storage, fp, newId);
    const other = pendingIdFor(storage, requestFingerprint(['another title']), newId);
    expect(other).not.toBe(first);
  });

  it('stores only a fingerprint, never the request text', () => {
    const storage = makeStorage();
    pendingIdFor(storage, requestFingerprint(['secret title', 'secret description']), newId);
    expect(storage.data.get(PENDING_KEY)).not.toContain('secret');
  });

  it('forgets the pending id after 24 hours and when cleared', () => {
    const storage = makeStorage();
    const t0 = 1_000_000;
    pendingIdFor(storage, fp, newId, t0);
    expect(readPending(storage, t0 + 60_000)).not.toBeNull();
    expect(readPending(storage, t0 + 24 * 60 * 60 * 1000 + 1)).toBeNull();
    pendingIdFor(storage, fp, newId, t0);
    clearPending(storage);
    expect(readPending(storage, t0)).toBeNull();
  });
});
