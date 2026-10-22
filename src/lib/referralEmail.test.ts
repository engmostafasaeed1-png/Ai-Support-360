import { describe, expect, it } from 'vitest';
import {
  CHIP_COLORS, chipFor, esc, initials, lineChip, pauseCategoryFor, REFERRAL_EMAIL_KINDS, referralEmailSettingsFrom, renderReferralEmail, safeUrl, sampleReferralEmail, tabFor, toneFor,
} from '../../supabase/functions/_shared/referralEmail';

describe('Refer & earn e-mail layout', () => {
  it('renders every kind in both languages with HTML and plain text, 600 px, white body, alt text on every image', () => {
    for (const kind of REFERRAL_EMAIL_KINDS) {
      for (const lang of ['en', 'ar'] as const) {
        const m = renderReferralEmail({ ...sampleReferralEmail(kind, lang), bannerUrl: 'https://www.aisupport360.com/email/referral-banner.png' });
        expect(m.subject.length).toBeGreaterThan(5);
        expect(m.text.length).toBeGreaterThan(50);
        expect(m.html).toContain('width="600"');
        expect(m.html).toContain('background:#ffffff');
        expect(m.html).not.toMatch(/<style|<script|<svg/i);
        for (const img of m.html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/alt="[^"]+"/);
        if (lang === 'ar') expect(m.html).toContain('dir="rtl"');
      }
    }
  });

  it('escapes every data value: no raw HTML injection through names or amounts', () => {
    const m = renderReferralEmail({ kind: 'signup', lang: 'en', name: '<img src=x onerror=alert(1)>', other: '"><script>alert(1)</script>', amount: '<b>9</b>' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('&lt;script&gt;');
    expect(esc(`<a href="x">'`)).toBe('&lt;a href&#61;&quot;x&quot;&gt;&#39;');
  });

  it('links only to our own domain, with no token or personal data in the query string', () => {
    expect(safeUrl('https://evil.example/x')).toBe('https://www.aisupport360.com');
    expect(safeUrl('javascript:alert(1)')).toBe('https://www.aisupport360.com');
    const m = renderReferralEmail({ kind: 'reward_paid', lang: 'en', name: 'Sara', other: 'D. K****', amount: 5, siteUrl: 'https://evil.example', bannerUrl: 'https://evil.example/b.png' });
    const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1].replace(/&#61;/g, '='));
    expect(hrefs.length).toBeGreaterThan(2);
    for (const h of hrefs) expect(h).toMatch(/^https:\/\/(www\.)?aisupport360\.com/);
    expect(m.html).not.toContain('evil.example');
    expect(m.ctaUrl).toBe('https://www.aisupport360.com/consultant/referrals?tab=earnings');
  });

  it('numbers come from the settings; the example is labelled and never promises income', () => {
    const s = referralEmailSettingsFrom([
      { key: 'referral_tiers', value: [{ rate: 0.5 }, { rate: 0.6 }, { rate: 1 }] }, { key: 'referral_months', value: 12 },
      { key: 'referral_email_example_fee', value: 2000 }, { key: 'referral_email_example_currency', value: 'EUR' },
    ]);
    expect(s).toMatchObject({ minRate: 0.5, maxRate: 1, months: 12, exampleFee: 2000, currency: 'EUR' });
    const m = renderReferralEmail({ kind: 'signup', lang: 'en', settings: s });
    expect(m.text).toContain('2,000 EUR approved fee × 0.5 % = 10.00 EUR');
    expect(m.text).toContain('Example only, not a promise of income');
    expect(m.text).toContain('0.5 %–1 %');
    expect(m.text).toContain('There is no guaranteed income');
  });

  it('shows the draft-terms line only while the terms are flagged as draft', () => {
    expect(renderReferralEmail({ kind: 'active', settings: { termsDraft: true } }).text).toContain('draft');
    expect(renderReferralEmail({ kind: 'active', settings: { termsDraft: false } }).text).not.toContain('draft');
  });

  it('colour family, tab and pause category per event', () => {
    expect(toneFor('signup')).toBe('invite');
    expect(toneFor('reward_paid')).toBe('earned');
    expect(toneFor('reward_held')).toBe('pending');
    expect(toneFor('reward_reversed')).toBe('negative');
    expect(tabFor('reward_available')).toBe('earnings');
    expect(tabFor('active')).toBe('referrals');
    expect(pauseCategoryFor('reward_paid')).toBe('essential');
    expect(pauseCategoryFor('reminder')).toBe('reminders');
    expect(pauseCategoryFor('reward_available')).toBe('activity');
  });

  it('a reversal shows a minus amount; a test mail says it is a test', () => {
    const m = renderReferralEmail({ kind: 'reward_reversed', amount: 3.2, currency: 'USD', test: true });
    expect(m.text).toContain('-3.20 USD');
    expect(m.subject.startsWith('[TEST] ')).toBe(true);
  });

  it('status chips use the owner colours: Earned green, Held amber, Paid blue, Reversed red', () => {
    expect(chipFor('reward_earned')).toBe('earned');
    expect(chipFor('reward_held')).toBe('held');
    expect(chipFor('reward_paid')).toBe('paid');
    expect(chipFor('reward_reversed')).toBe('reversed');
    expect(CHIP_COLORS.earned.fg).toBe('#166534');
    expect(CHIP_COLORS.held.fg).toBe('#92400E');
    expect(CHIP_COLORS.paid.fg).toBe('#1E40AF');
    expect(CHIP_COLORS.reversed.fg).toBe('#991B1B');
    expect(lineChip('pending')).toBe('earned');
    expect(lineChip('in_payout')).toBe('available');
    expect(lineChip('paid', 'reversal')).toBe('reversed');
  });

  it('a reward shows the large "+$2.40 earned" figure and the progress to the next level from the database numbers', () => {
    const m = renderReferralEmail({ kind: 'reward_earned', lang: 'en', amount: 2.4, currency: 'USD',
      tier: { count: 7, name: 'Tier 1', rate: 0.5, min: 0, next_min: 11, next_rate: 0.6, needed: 4 } });
    expect(m.html).toContain('+$2.40');
    expect(m.html).toMatch(/>earned</);
    expect(m.html).toContain('width="64%"'); // 7 of 11 verified referrals (table-cell bar, Outlook-safe)
    expect(m.text).toContain('4 more verified referrals to reach 0.6 % on later work.');
    expect(renderReferralEmail({ kind: 'reward_reversed', amount: 3.2, currency: 'EUR' }).html).toContain('−€3.20');
  });

  it('statement and weekly summary show a mini table with initials, anonymous references, totals and a status bar', () => {
    for (const kind of ['monthly_statement', 'weekly_digest_admin'] as const) {
      const m = renderReferralEmail({ kind, lang: 'en', period: 'September 2026', lines: [
        { who: 'Dina K****', ref: 'R-7Q4M', fee: 480, reward: 2.4, status: 'pending', currency: 'USD' },
        { who: 'M. A****', ref: 'R-2H9X', fee: 240, reward: 1.2, status: 'reversed', kind: 'reversal', currency: 'USD' },
      ] });
      expect(m.html).toContain('D. K.');
      expect(m.html).not.toContain('Dina');
      expect(m.html).toContain('R-7Q4M');
      expect(m.text).toContain('Total USD: Earned $2.40, Reversed $1.20');
      expect(m.html).toContain('width="67%"');
    }
    expect(renderReferralEmail({ kind: 'weekly_digest_admin' }).ctaUrl).toBe('https://www.aisupport360.com/admin/referrals');
    expect(renderReferralEmail({ kind: 'monthly_statement' }).ctaUrl).toBe('https://www.aisupport360.com/consultant/referrals?tab=calculations');
    expect(initials('D. K****')).toBe('D. K.');
  });
});

