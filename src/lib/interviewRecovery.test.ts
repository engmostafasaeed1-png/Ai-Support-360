import { describe, expect, it, vi } from 'vitest';
import { fetchInterviewTurn } from './interviewRecovery';

describe('interview retry policy', () => {
  it('retries 429 once after the requested backoff', async () => {
    const run = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '4' } })).mockResolvedValue(new Response('ok'));
    const wait = vi.fn().mockResolvedValue(undefined);
    expect((await fetchInterviewTurn(run, wait)).status).toBe(200);
    expect(wait).toHaveBeenCalledWith(4000);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 402, 403, 404, 409, 422])('never retries terminal status %i', async status => {
    const run = vi.fn().mockResolvedValue(new Response('', { status }));
    await fetchInterviewTurn(run, vi.fn());
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('caps transient attempts at two', async () => {
    const run = vi.fn().mockImplementation(async () => new Response('', { status: 503 }));
    await fetchInterviewTurn(run, vi.fn().mockResolvedValue(undefined));
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('does not retry a confirmed non-transient service problem', async () => {
    const run = vi.fn().mockResolvedValue(new Response(JSON.stringify({ retryable: false }), { status: 503 }));
    await fetchInterviewTurn(run, vi.fn());
    expect(run).toHaveBeenCalledTimes(1);
  });
});