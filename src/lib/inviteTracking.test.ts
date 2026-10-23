import { describe, expect, it, vi } from 'vitest';
import { claimInviteClick, inviteSourceFrom, parseEffectiveness, rate, trackInviteClick, withoutInviteTag } from './inviteTracking';
import { referralInviteLink } from '../../supabase/functions/_shared/bulkMessagesRun';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('Refer & earn invitation click tracking', () => {
  it('invitation links carry only the channel tag, never a token or personal data', () => {
    expect(referralInviteLink('telegram')).toBe('/consultant/referrals?tab=programme&from=invite&ch=telegram');
    const keys = [...new URL(`https://x.test${referralInviteLink('email')}`).searchParams.keys()];
    expect(keys).toEqual(['tab', 'from', 'ch']);
  });

  it('reads the channel; old untagged invitation links count as bell notices; other visits are not clicks', () => {
    expect(inviteSourceFrom(new URLSearchParams('tab=programme&from=invite&ch=email'))).toBe('email');
    expect(inviteSourceFrom(new URLSearchParams('tab=programme&from=invite'))).toBe('in_app');
    expect(inviteSourceFrom(new URLSearchParams('tab=programme&from=invite&ch=sms'))).toBe('in_app');
    expect(inviteSourceFrom(new URLSearchParams('tab=programme'))).toBeNull();
  });

  it('removes the tag but keeps the tab', () => {
    expect(withoutInviteTag(new URLSearchParams('tab=programme&from=invite&ch=push')).toString()).toBe('tab=programme');
  });

  it('counts at most once per tab session and channel', async () => {
    const s = memory();
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await trackInviteClick('email', rpc, s)).toBe(true);
    expect(await trackInviteClick('email', rpc, s)).toBe(false);
    expect(await trackInviteClick('in_app', rpc, s)).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('referral_invite_track_click', { _channel: 'email' });
    expect(claimInviteClick('email', s)).toBe(false);
  });

  it('never throws when the database call fails', async () => {
    const rpc = vi.fn(async () => { throw new Error('offline'); });
    await expect(trackInviteClick('push', rpc, memory())).resolves.toBe(false);
  });

  it('click rate is people who clicked out of people reached, null with nobody reached', () => {
    expect(rate(3, 31)).toBe(10);
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 4)).toBe(100);
  });

  it('missing numbers read as zero', () => {
    const e = parseEffectiveness({ version: 2, versions: [1, 2], clicked: { email: 4 }, clickers: 4 });
    expect(e.clicked).toEqual({ in_app: 0, push: 0, telegram: 0, email: 4 });
    expect(e.versions).toEqual([2, 1]);
    expect(e.reached).toBe(0);
  });
});
