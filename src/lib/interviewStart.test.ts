import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/errorReporter', () => ({ reportError: vi.fn() }));
import { reportError } from '@/lib/errorReporter';
import { classifyStartError, logStartErrorOnce, pickSessionToResume, resetStartErrorLog, resolveAiInterviewSession, startBlockReason, BLOCK_TEXT, ERROR_TEXT } from './interviewStart';

const now = Date.parse('2026-10-20T12:00:00Z');
const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();

describe('which interview to resume', () => {
  it('resumes a started interview before any pending one', () => {
    expect(pickSessionToResume([
      { id: 'p', status: 'pending', created_at: at(1) },
      { id: 's', status: 'in_progress', created_at: at(30) },
    ], now)).toEqual({ id: 's', reason: 'in_progress' });
  });
  it('reuses the newest pending session and marks one older than 24 h as stale', () => {
    expect(pickSessionToResume([{ id: 'a', status: 'pending', created_at: at(2) }, { id: 'b', status: 'pending', created_at: at(50) }], now)).toEqual({ id: 'a', reason: 'pending' });
    expect(pickSessionToResume([{ id: 'b', status: 'pending', created_at: at(25) }], now)).toEqual({ id: 'b', reason: 'stale_pending' });
  });
  it('never picks live sessions or finished ones', () => {
    expect(pickSessionToResume([
      { id: 'live', status: 'pending', created_at: at(1), interview_style: 'live' },
      { id: 'done', status: 'completed', created_at: at(1) },
    ], now)).toBeNull();
  });
});

describe('start blockers', () => {
  const ok = { ready: true, signedIn: true, consultantId: 'c', displayName: 'Mona', hasSapRole: true };
  it('lets an eligible consultant start', () => { expect(startBlockReason(ok)).toBeNull(); });
  it('names each blocker with a visible message', () => {
    expect(startBlockReason({ ...ok, signedIn: false })).toBe('signed_out');
    expect(startBlockReason({ ...ok, consultantId: null })).toBe('no_profile');
    expect(startBlockReason({ ...ok, displayName: '  ' })).toBe('missing_name');
    expect(startBlockReason({ ...ok, hasSapRole: false })).toBe('missing_role');
    expect(BLOCK_TEXT.missing_role.message).toBe('Add your SAP role first.');
    expect(ERROR_TEXT.service.message).toBe('AI service temporarily unavailable - try again.');
  });
});

describe('start errors', () => {
  it('classifies network, permission and service failures', () => {
    expect(classifyStartError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyStartError({ code: '42501', message: 'permission denied for table interview_sessions' })).toBe('permission');
    expect(classifyStartError({ message: 'boom' })).toBe('service');
  });
  it('logs a service error once and never logs network drops', () => {
    resetStartErrorLog(); vi.mocked(reportError).mockClear();
    logStartErrorOnce('service', { message: 'x' }, 'page');
    logStartErrorOnce('service', { message: 'x' }, 'page');
    logStartErrorOnce('network', { message: 'y' }, 'page');
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe('single-flight creation', () => {
  it('two clicks at once create exactly one session', async () => {
    const insert = vi.fn();
    const db = { from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
      chain.limit = async () => { await new Promise(r => setTimeout(r, 5)); return { data: [], error: null }; };
      chain.insert = (p: unknown) => { insert(p); return chain; };
      chain.single = async () => ({ data: { id: 'new' }, error: null });
      return chain;
    } };
    const [a, b] = await Promise.all([resolveAiInterviewSession('c1', db, now), resolveAiInterviewSession('c1', db, now)]);
    expect(a.id).toBe('new'); expect(b.id).toBe('new');
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('H3: sessions stuck as "pending" by the old request dialog', () => {
  it('the owner consultant resumes the newest of them; nothing is created or deleted', async () => {
    // Same shape as production: self-requested, never started, the newest one more than 24 h old.
    const rows = [
      { id: 'p4', status: 'pending', created_at: '2026-10-20T06:45:21Z', interview_style: 'standard' },
      { id: 'p3', status: 'pending', created_at: '2026-10-19T11:14:00Z', interview_style: 'standard' },
      { id: 'p2', status: 'pending', created_at: '2026-10-19T11:05:43Z', interview_style: 'standard' },
      { id: 'p1', status: 'pending', created_at: '2026-10-19T11:03:21Z', interview_style: 'standard' },
    ];
    const insert = vi.fn();
    const del = vi.fn();
    const db = { from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
      chain.limit = async () => ({ data: rows, error: null });
      chain.insert = (p: unknown) => { insert(p); return chain; };
      chain.delete = () => { del(); return chain; };
      return chain;
    } };
    const res = await resolveAiInterviewSession('stuck-consultant', db, now + 24 * 3600_000);
    expect(res).toEqual({ id: 'p4', resumed: 'stale_pending' });
    expect(insert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
