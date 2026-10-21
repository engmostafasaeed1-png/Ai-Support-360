import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildPolicyEmail, parsePolicyEmailBody, policyEmailBytes, policyEmailNumbers, policyEmailSubject, policyEmailText,
  renderPolicyEmailHtml, POLICY_EMAIL_HTML_LIMIT, POLICY_EMAIL_STR, type PolicyEmailProps,
} from '../../supabase/functions/_shared/consultantPolicyEmail';
import {
  POLICY_DRAFT_BODY_AR, POLICY_DRAFT_BODY_EN, POLICY_DRAFT_NOTE_AR, POLICY_DRAFT_NOTE_EN,
} from '../../supabase/functions/_shared/consultantPolicyDraft';

const CONFIRM = 'https://www.aisupport360.com/consultant/profile#service-policy';
const render = (p: PolicyEmailProps) => renderToStaticMarkup(buildPolicyEmail(createElement, p));
const renderFull = (p: PolicyEmailProps) => renderPolicyEmailHtml(createElement, (el) => renderToStaticMarkup(el as never), p);
const mail = (lang: 'en' | 'ar', extra: Partial<PolicyEmailProps> = {}): PolicyEmailProps => ({
  lang, kind: 'notice', name: 'Sara', version: 1,
  texts: {
    en: { body: POLICY_DRAFT_BODY_EN, deadline: '28 October 2026', effectiveDate: '21 October 2026' },
    ar: { body: POLICY_DRAFT_BODY_AR, deadline: '28 أكتوبر 2026', effectiveDate: '21 أكتوبر 2026' },
  },
  ...extra,
});
const en = (extra: Partial<PolicyEmailProps> = {}) => mail('en', extra);
const ar = (extra: Partial<PolicyEmailProps> = {}) => mail('ar', extra);
/** The part of the mail belonging to one language version. */
const part = (html: string, lang: 'en' | 'ar') => {
  const i = html.indexOf(`id="lang-${lang}"`);
  const other = html.indexOf(`id="lang-${lang === 'en' ? 'ar' : 'en'}"`);
  return other > i ? html.slice(i, other) : html.slice(i);
};
/** React escapes quotes in text; compare against the same escaping. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

describe('Consultant Service Policy e-mail (bilingual)', () => {
  it('carries both complete language versions for any preferred language', () => {
    for (const p of [en(), ar()]) {
      const html = render(p);
      for (const [lang, bodyText] of [['en', POLICY_DRAFT_BODY_EN], ['ar', POLICY_DRAFT_BODY_AR]] as const) {
        const v = part(html, lang);
        const body = parsePolicyEmailBody(bodyText);
        expect(body.sections).toHaveLength(6);
        body.sections.forEach((s, i) => {
          expect(v).toContain(`id="${lang}-s${i + 1}"`);
          expect(v).toContain(`href="#${lang}-s${i + 1}"`);
          expect(v).toContain(esc(s.heading));
          for (const b of s.blocks) expect(v).toContain(esc(b.text));
        });
        const t = POLICY_EMAIL_STR[lang];
        for (const x of [t.title(1), t.whyTitle, t.meansTitle, t.fullTitle, t.needTitle, t.timelineTitle]) expect(v).toContain(esc(x));
        expect(v).toContain(`href="${CONFIRM}" data-cta="${lang}-top"`);
        expect(v).toContain(`href="${CONFIRM}" data-cta="${lang}-bottom"`);
        expect(v.match(/data-step="/g)).toHaveLength(5);
      }
      expect(html.match(/data-cta=/g)).toHaveLength(4);
      const text = policyEmailText(p);
      for (const b of [POLICY_DRAFT_BODY_EN, POLICY_DRAFT_BODY_AR]) {
        for (const line of b.split('\n').map(l => l.replace(/^(## |- )/, '').trim()).filter(Boolean)) expect(text).toContain(line);
      }
    }
  });

  it('puts the preferred language first, with a divider and a language switch bar at the top', () => {
    const a = render(ar());
    expect(a.indexOf('data-lang="ar"')).toBeLessThan(a.indexOf('data-lang="en"'));
    const e = render(en());
    expect(e.indexOf('data-lang="en"')).toBeLessThan(e.indexOf('data-lang="ar"'));
    for (const html of [a, e]) {
      const bar = html.indexOf('data-switch="ar"');
      expect(bar).toBeGreaterThan(-1);
      expect(bar).toBeLessThan(html.indexOf('data-lang='));
      expect(html.indexOf('data-switch="ar"')).toBeLessThan(html.indexOf('data-switch="en"'));
      expect(html).toContain('>العربية</a>');
      expect(html).toContain('>English</a>');
    }
    expect(part(a, 'en')).toContain(POLICY_EMAIL_STR.en.versionLabel);
    expect(part(a, 'ar')).not.toContain(POLICY_EMAIL_STR.ar.versionLabel);
    expect(part(e, 'ar')).toContain(POLICY_EMAIL_STR.ar.versionLabel);
    const ta = policyEmailText(ar());
    expect(ta.indexOf(POLICY_EMAIL_STR.ar.whyTitle)).toBeLessThan(ta.indexOf(POLICY_EMAIL_STR.en.whyTitle.toUpperCase()));
    const te = policyEmailText(en());
    expect(te.indexOf(POLICY_EMAIL_STR.en.whyTitle.toUpperCase())).toBeLessThan(te.indexOf(POLICY_EMAIL_STR.ar.whyTitle));
  });

  it('sets dir="rtl" only on the Arabic part', () => {
    for (const html of [render(ar()), render(en())]) {
      expect(html).toMatch(/^<html lang="(ar|en)">/);
      expect(html).toMatch(/<body style=/);
      expect(part(html, 'en')).not.toContain('dir="rtl"');
      expect(part(html, 'ar')).not.toContain('dir="ltr"');
      expect(html.slice(0, html.indexOf('data-lang='))).not.toContain('dir="rtl"');
      expect(html).toContain('lang="ar" dir="rtl" data-lang="ar"');
      expect(html).toContain('lang="en" dir="ltr" data-lang="en"');
    }
  });

  it('every in-mail anchor link resolves to an element in the mail', () => {
    for (const html of [render(ar()), render(en())]) {
      const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map(x => x[1]);
      expect(hrefs).toEqual(expect.arrayContaining(['lang-ar', 'lang-en', 'ar-s1', 'en-s6']));
      for (const id of hrefs) expect(html).toContain(`id="${id}"`);
      const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(x => x[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('stays under the Gmail clipping size without dropping any policy section', () => {
    for (const p of [en(), ar()]) {
      const html = renderFull(p);
      console.log('policy mail bytes', p.lang, policyEmailBytes(html));
      expect(policyEmailBytes(html)).toBeLessThanOrEqual(POLICY_EMAIL_HTML_LIMIT);
      for (const lang of ['en', 'ar'] as const) for (let i = 1; i <= 6; i++) expect(html).toContain(`id="${lang}-s${i}"`);
    }
    // A long policy falls back to the compact second version, still complete.
    const long = POLICY_DRAFT_BODY_EN + '\n' + Array.from({ length: 150 }, (_, i) => `- Extra rule ${i} with enough words to fill the line nicely.`).join('\n');
    const p = en({ texts: { en: { body: long }, ar: { body: POLICY_DRAFT_BODY_AR } } });
    const normal = '<!DOCTYPE html>' + render(p);
    const out = renderFull(p);
    expect(policyEmailBytes(out)).toBeLessThan(policyEmailBytes(normal));
    for (const b of parsePolicyEmailBody(POLICY_DRAFT_BODY_AR).sections.flatMap(s => s.blocks)) expect(out).toContain(esc(b.text));
  });

  it('uses a bilingual subject', () => {
    expect(policyEmailSubject({ version: 2, kind: 'notice' })).toBe('Consultant Service Policy / سياسة خدمة المستشار - version 2');
    expect(policyEmailSubject({ version: 2, kind: 'reminder' })).toBe('Reminder / تذكير: Consultant Service Policy / سياسة خدمة المستشار - version 2');
  });

  it('keeps the draft marker visible as published in both languages', () => {
    const html = render(en());
    expect(html).toContain(POLICY_DRAFT_NOTE_EN);
    expect(html).toContain(POLICY_DRAFT_NOTE_AR);
    expect(policyEmailText(ar())).toContain(POLICY_DRAFT_NOTE_EN);
  });

  it('shows the confirmation deadline in each language and says that sign-in and current work are never blocked', () => {
    const html = render(en());
    expect(part(html, 'en')).toContain('Please confirm by 28 October 2026');
    expect(html).toContain('Signing in, reading and confirming are never blocked, and your current work is not affected.');
    expect(part(html, 'ar')).toContain('يُرجى التأكيد قبل 28 أكتوبر 2026');
    expect(render(en({ deadlinePassed: true }))).toContain('The confirmation period ended on 28 October 2026');
    expect(render(en({ texts: undefined }))).toContain('You have 7 days to confirm');
  });

  it('falls back to safe button links', () => {
    expect(render(en({ confirmUrl: 'javascript:alert(1)' }))).toContain(`href="${CONFIRM}" data-cta="en-top"`);
    expect(policyEmailText(en())).toContain(`Read and confirm: ${CONFIRM}`);
  });

  it('escapes HTML written into the policy text', () => {
    const html = render(en({ texts: { en: { body: '## 1. <script>alert(1)</script>\n- <img src=x onerror=alert(1)> **bold**', summary: '<b>x</b>' } }, name: '<i>n</i>' }));
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

  it('draws the request timeline in section 1 of each version', () => {
    const html = render(en());
    for (const lang of ['en', 'ar'] as const) {
      const v = part(html, lang);
      const t = esc(POLICY_EMAIL_STR[lang].timelineTitle);
      expect(v.indexOf(t)).toBeGreaterThan(v.indexOf(`id="${lang}-s1"`));
      expect(v.indexOf(t)).toBeLessThan(v.indexOf(`id="${lang}-s2"`));
    }
  });
});
