import { describe, expect, it, vi } from 'vitest';
import { interviewAccessAllowed, warmInterviewContext } from '../../supabase/functions/_shared/interviewWarmup';

describe('authenticated interview warm-up', () => {
  it('denies a stranger before loading any private cache', async () => {
    const load = vi.fn(async () => undefined);
    const response = await warmInterviewContext({ owner: false, admin: false, interviewer: false }, load, {});
    expect(response.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });
  it('returns an empty 204 after filling the owner caches once', async () => {
    const load = vi.fn(async () => undefined);
    const response = await warmInterviewContext({ owner: true, admin: false, interviewer: false }, load, { 'Access-Control-Allow-Origin': 'http://localhost:8080' });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(load).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8080');
  });
  it('keeps administrator access and restricts interviewers to copilot calls', () => {
    expect(interviewAccessAllowed({ owner: false, admin: true, interviewer: false }, 'warmup')).toBe(true);
    expect(interviewAccessAllowed({ owner: false, admin: false, interviewer: true }, 'warmup')).toBe(false);
    expect(interviewAccessAllowed({ owner: false, admin: false, interviewer: true }, 'copilot')).toBe(true);
  });
});