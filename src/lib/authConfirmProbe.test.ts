import { describe, it, expect, vi } from 'vitest';
import { confirmationLink, createConfirmPageProbe, isConfirmMarker } from '../../supabase/functions/_shared/authConfirmLink';

const SITE = 'https://www.aisupport360.com';
const VERIFY = 'https://auth.example.com/auth/v1/verify?token=abcdef123456&type=signup&redirect_to=https://www.aisupport360.com/login';
const resp = (ok: boolean, body: string) => ({ ok, text: async () => body });

describe('confirmation e-mail falls back when /auth/confirm is not published', () => {
  it('uses the one-click page only when the marker is live', () => {
    expect(confirmationLink(VERIFY, SITE, 'a@b.co', true)).toMatch(/^https:\/\/www\.aisupport360\.com\/auth\/confirm\?token_hash=abcdef123456&type=signup/);
    expect(confirmationLink(VERIFY, SITE, 'a@b.co', false)).toBe(VERIFY);
  });

  it('a home page served for every address does not count as the marker', () => {
    expect(isConfirmMarker('<!doctype html><html></html>')).toBe(false);
    expect(isConfirmMarker('{"route":"/auth/confirm","ready":true}')).toBe(true);
  });

  it('probe: live marker = ready (cached), missing page or network error = not ready', async () => {
    let t = 0;
    const live = vi.fn(async (_url: string) => resp(true, '{"route":"/auth/confirm","ready":true}'));
    const probe = createConfirmPageProbe(SITE, live, () => t);
    expect(await probe()).toBe(true);
    expect(await probe()).toBe(true);
    expect(live).toHaveBeenCalledTimes(1);
    expect(live.mock.calls[0][0]).toBe('https://www.aisupport360.com/auth-confirm-ready.json');

    expect(await createConfirmPageProbe(SITE, async () => resp(true, '<html>home</html>'), () => t)()).toBe(false);
    expect(await createConfirmPageProbe(SITE, async () => resp(false, ''), () => t)()).toBe(false);
    expect(await createConfirmPageProbe(SITE, async () => { throw new Error('offline'); }, () => t)()).toBe(false);

    // A not-ready answer is re-checked after a minute, so publishing takes effect quickly.
    let ready = false;
    const flip = vi.fn(async () => resp(ready, '{"route":"/auth/confirm","ready":true}'));
    const p2 = createConfirmPageProbe(SITE, flip, () => t);
    expect(await p2()).toBe(false);
    ready = true; t += 61_000;
    expect(await p2()).toBe(true);
  });
});
