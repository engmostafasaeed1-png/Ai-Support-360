import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildPolicyEmail, parsePolicyEmailBody, policyEmailNumbers, policyEmailText, POLICY_EMAIL_STR, type PolicyEmailProps,
} from '../../supabase/functions/_shared/consultantPolicyEmail';
import {
  POLICY_DRAFT_BODY_AR, POLICY_DRAFT_BODY_EN, POLICY_DRAFT_NOTE_AR, POLICY_DRAFT_NOTE_EN,
} from '../../supabase/functions/_shared/consultantPolicyDraft';

const CONFIRM = 'https://www.aisupport360.com/consultant/profile#service-policy';
const render = (p: PolicyEmailProps) => renderToStaticMarkup(buildPolicyEmail(createElement, p));
const en = (extra: Partial<PolicyEmailProps> = {}): PolicyEmailProps => ({
  lang: 'en', kind: 'notice', name: 'Sara', version: 1, body: POLICY_DRAFT_BODY_EN, deadline: '28 October 2026', effectiveDate: '21 October 2026', ...extra,
});
const ar = (extra: Partial<PolicyEmailProps> = {}): PolicyEmailProps => ({
  ...en(), lang: 'ar', name: 'سارة', body: POLICY_DRAFT_BODY_AR, deadline: '28 أكتوبر 2026', ...extra,
});
/** React escapes quotes in text; compare against the same escaping. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

describe('Consultant Service Policy e-mail', () => {
  it('contains every numbered section, every line of the policy and an anchor per section', () => {
    for (const p of [en(), ar()]) {
      const html = render(p);
      const body = parsePolicyEmailBody(p.body);
      expect(body.sections).toHaveLength(6);
      body.sections.forEach((s, i) => {
        expect(html).toContain(`id="s${i + 1}"`);
        expect(html).toContain(`href="#s${i + 1}"`);
        expect(html).toContain(esc(s.heading));
        for (const b of s.blocks) expect(html).toContain(esc(b.text));
      });
      const text = policyEmailText(p);
      for (const line of String(p.body).split('\n').map(l => l.replace(/^(## |- )/, '').trim()).filter(Boolean)) {
        expect(text).toContain(line.replace(/^(\d+)\. /, '$1. '));
      }
    }
  });

  it('keeps the draft marker visible as published', () => {
    expect(render(en())).toContain(POLICY_DRAFT_NOTE_EN);
    expect(render(ar())).toContain(POLICY_DRAFT_NOTE_AR);
    expect(policyEmailText(en())).toContain(POLICY_DRAFT_NOTE_EN);
  });

  it('marks Arabic as right-to-left and English as left-to-right', () => {
    expect(render(ar())).toMatch(/^<html lang="ar" dir="rtl">/);
    expect(render(ar())).toContain('<body dir="rtl"');
    expect(render(en())).toMatch(/^<html lang="en" dir="ltr">/);
    expect(render(ar())).toContain(POLICY_EMAIL_STR.ar.whyTitle);
  });

  it('shows the confirmation deadline and says that sign-in and current work are never blocked', () => {
    const html = render(en());
    expect(html).toContain('Please confirm by 28 October 2026');
    expect(html).toContain('Signing in, reading and confirming are never blocked, and your current work is not affected.');
    expect(render(en({ deadlinePassed: true }))).toContain('The confirmation period ended on 28 October 2026');
    expect(render(en({ deadline: undefined }))).toContain('You have 7 days to confirm');
    expect(render(ar())).toContain('يُرجى التأكيد قبل 28 أكتوبر 2026');
  });

  it('links both buttons to the policy step of the profile', () => {
    const html = render(en());
    expect(html).toContain(`href="${CONFIRM}" data-cta="top"`);
    expect(html).toContain(`href="${CONFIRM}" data-cta="bottom"`);
    expect(html.match(/data-cta=/g)).toHaveLength(2);
    expect(render(en({ confirmUrl: 'javascript:alert(1)' }))).toContain(`href="${CONFIRM}" data-cta="top"`);
    expect(policyEmailText(en())).toContain(`Read and confirm: ${CONFIRM}`);
  });

  it('escapes HTML written into the policy text', () => {
    const html = render(en({ body: '## 1. <script>alert(1)</script>\n- <img src=x onerror=alert(1)> **bold**', summary: '<b>x</b>', name: '<i>n</i>' }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<strong');
  });

  it('reads the key numbers from the real settings', () => {
    const n = policyEmailNumbers({ r1: 60, r2: 180, r3: 600, expire: 720 }, { min_sample: 8, warnings: 3, dispute_days: 10 }, 5);
    expect(n).toMatchObject({ r1: 60, expire: 720, minSample: 8, notices: 3, disputeDays: 10, graceDays: 5, windowDays: 90 });
    const html = render(en({ numbers: n }));
    expect(html).toContain('12 h');
    expect(html).toContain('1 h · 3 h · 10 h');
    expect(html).toContain('10 days');
    const d = render(en());
    for (const v of ['24 h', '30 min', '2 h · 4 h · 1 day', '90 days']) expect(d).toContain(v);
  });

  it('draws the request timeline in section 1 only', () => {
    const html = render(en());
    expect(html.match(/data-step="/g)).toHaveLength(5);
    expect(html.indexOf('What happens after a request arrives')).toBeGreaterThan(html.indexOf('id="s1"'));
    expect(html.indexOf('What happens after a request arrives')).toBeLessThan(html.indexOf('id="s2"'));
  });
});
