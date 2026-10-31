import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  adminMessageSubject, adminMessageText, buildAdminMessageData, buildMessageView, categoryForType, clip, finishFor, formatBody, renderAdminMessage, safePortalPath,
  badgeFor, decisionSteps, DECISION_OUTCOMES, DECISION_SUBJECTS, FOOTER_PARTS, MESSAGE_COPY,
} from '../../supabase/functions/_shared/adminMessageEmail';
import {
  adminEmailHeader, canUntickEmail, emailKindOf, typeAlreadyEmailed, MAX_RECIPIENTS_PER_ACTION, PER_RECIPIENT_PER_HOUR,
  planRecipientMail, canUntickCategory, fillTemplateVars, historyCsv, type HistoryRow, consultantOutcome, decisionNoticeState,
} from '@/lib/adminMessageEmail';
import { dayGroups } from '@/lib/notificationGroups';

const mail = (n: number, extra: Partial<{ lang: string; digest: boolean; link: string; title: string; body: string; meta: Record<string, unknown> }> = {}) => ({
  mail_key: 'k', recipient: 'u', email: 'a@example.com', lang: extra.lang ?? 'en', digest: extra.digest ?? n > 1,
  items: Array.from({ length: n }, (_, i) => ({ id: String(i), title: extra.title ?? `Title ${i}`, body: extra.body ?? 'Body', link: extra.link ?? '/consultant/profile',
    type: 'admin_message', created_at: '2026-10-30T12:40:00Z', meta: extra.meta ?? null })),
});
const SITE = 'https://www.aisupport360.com';
const html = (d: ReturnType<typeof buildAdminMessageData>) => renderToStaticMarkup(renderAdminMessage(React.createElement as never, d) as React.ReactElement);

describe('admin messages by e-mail — rules', () => {
  it('sends one e-mail per message: a single item keeps its own page link', () => {
    const d = buildAdminMessageData(mail(1), 'https://www.aisupport360.com');
    expect(d.digest).toBe(false);
    expect(d.items).toHaveLength(1);
    expect(d.url).toBe('https://www.aisupport360.com/consultant/profile');
  });

  it('beyond 5 per recipient per hour the rest go out together as one digest', () => {
    expect(PER_RECIPIENT_PER_HOUR).toBe(5);
    expect(planRecipientMail(3, 0)).toEqual({ kind: 'single', mails: 3 });
    expect(planRecipientMail(4, 3)).toEqual({ kind: 'digest', mails: 1 });
    expect(planRecipientMail(1, 4)).toEqual({ kind: 'single', mails: 1 });
    expect(planRecipientMail(1, 5)).toEqual({ kind: 'held', mails: 0 });
  });

  it('flows that already send their own e-mail are never mailed twice', () => {
    for (const t of ['nda', 'referral', 'sla', 'agreement', 'ticket_tracking', 'feedback_reply', 'session', 'interview', 'match_request']) {
      expect(typeAlreadyEmailed(t)).toBe(true);
    }
    expect(typeAlreadyEmailed('admin_message')).toBe(false);
    expect(typeAlreadyEmailed('approval')).toBe(false);
  });

  it('decisions are locked on; only comments can be unticked', () => {
    expect(emailKindOf('admin_message')).toBe('comment');
    expect(emailKindOf('approval')).toBe('decision');
    expect(canUntickEmail('approval')).toBe(false);
    expect(adminEmailHeader({ type: 'approval', email: false })).toBe('');
    expect(adminEmailHeader({ type: 'admin_message', email: false })).toBe('off');
  });

  it('"important" overrides quiet pauses and "include tests" reaches test-tagged accounts', () => {
    expect(adminEmailHeader({ type: 'admin_message', email: true, important: true, includeTests: true })).toBe('important,tests');
    expect(MAX_RECIPIENTS_PER_ACTION).toBe(5);
  });

  it('links stay on our own site', () => {
    expect(safePortalPath('/client/tickets/1')).toBe('/client/tickets/1');
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/a/../b', '/a b', null]) {
      expect(safePortalPath(bad)).toBe('/notifications');
    }
    const d = buildAdminMessageData(mail(1, { link: 'https://evil.example/x' }), 'https://www.aisupport360.com');
    expect(d.url).toBe('https://www.aisupport360.com/notifications');
  });

  it('clips long text and keeps the subject on one line', () => {
    expect(clip('x'.repeat(1200), 1000)).toHaveLength(1000);
    const v = buildMessageView({ title: 'Line\r\nBcc: x@y.z', body: '', type: 'payment' }, 'https://www.aisupport360.com');
    expect(adminMessageSubject({ lang: 'en', digest: false, items: [v] })).toBe('Decision: Line Bcc: x@y.z — AI Support 360');
    expect(adminMessageSubject({ lang: 'ar', digest: true, items: [v, v, v] })).toContain('3 رسائل');
  });

  it('a suppressed address is a logged skip, not a failure', () => {
    expect(finishFor({ sent: false, reason: 'recipient_suppressed' })).toEqual({ status: 'skipped', reason: 'recipient_suppressed' });
    expect(finishFor({ sent: true })).toEqual({ status: 'sent' });
  });
});

describe('admin messages by e-mail — layout', () => {
  it('escapes all admin text (no HTML or script reaches the e-mail)', () => {
    const data = buildAdminMessageData(mail(1, { title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script> & "quotes"' }), 'https://www.aisupport360.com');
    const html = renderToStaticMarkup(renderAdminMessage(React.createElement as never, data) as React.ReactElement);
    expect(adminMessageText(data)).toContain('<script>alert(1)</script>'); // plain-text part is not HTML
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Reply in the portal');
    expect(html).toContain('href="https://www.aisupport360.com/notifications/pause"');
  });

  it('uses the recipient language with right-to-left layout in Arabic', () => {
    const html = renderToStaticMarkup(renderAdminMessage(React.createElement as never, buildAdminMessageData(mail(2, { lang: 'ar' }), 'https://www.aisupport360.com')) as React.ReactElement);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('الرد عبر البوابة');
    expect(html).toContain('لديك 2 رسائل جديدة من الفريق');
  });
});

describe('organised messages — shared layout', () => {
  const full = { v: 1, category: 'action', summary: 'Two quick changes and your profile can be verified.', action_label: 'Update your profile', deadline: '2026-11-06',
    context: { kind: 'ticket', label: 'SAP FI posting error', ref: '#1A2B3C4D', status: 'in progress' } };

  it('formats long text: keeps line breaks, detects lists, splits walls of text', () => {
    const b = formatBody('Hello Sara,\nthanks.\n\n- one\n- two\n1. first\n2. second', SITE);
    expect(b.map((x) => x.t)).toEqual(['p', 'ul', 'ol']);
    expect(b[0].t === 'p' && b[0].lines).toHaveLength(2);
    const wall = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here and explains something.`).join(' ');
    expect(formatBody(wall, SITE).length).toBeGreaterThan(1);
  });

  it('bold and links: only our own site becomes a link', () => {
    const [p] = formatBody('**Note** see [your profile](/consultant/profile) or [evil](https://evil.example) https://www.aisupport360.com/client', SITE);
    const parts = p.t === 'p' ? p.lines[0] : [];
    expect(parts.find((x) => x.bold)?.text).toBe('Note');
    expect(parts.filter((x) => x.href).map((x) => x.href)).toEqual([`${SITE}/consultant/profile`, `${SITE}/client`]);
    expect(parts.some((x) => x.text.includes('evil (https://evil.example)'))).toBe(true);
  });

  it('category comes from the message, else from the notice type', () => {
    expect(categoryForType('payment')).toBe('decision');
    expect(categoryForType('profile_reminder')).toBe('reminder');
    expect(buildMessageView({ title: 'x', type: 'admin_message', meta: { v: 1, category: 'welcome' } }, SITE).category).toBe('welcome');
    expect(canUntickCategory('decision')).toBe(false);
    expect(canUntickCategory('update')).toBe(true);
  });

  it('e-mail has chip, summary, related item, what to do with deadline, button, sender line and no tracking pixel', () => {
    const out = html(buildAdminMessageData(mail(1, { meta: full }), SITE));
    for (const s of ['Request for action', 'Two quick changes', 'SAP FI posting error', '#1A2B3C4D', 'What you need to do', 'Deadline:', 'Reply in the portal',
      'Sent by the AI Support 360 team (admin)', '30 Oct 2026', 'name="color-scheme"', 'max-width:600px']) expect(out).toContain(s);
    expect((out.match(/<img /g) ?? []).length).toBe(1); // the logo only
  });

  it('e-mail HTML snapshot (EN, escaped admin text)', () => {
    const d = buildAdminMessageData(mail(1, { meta: full, title: '<b>Hi</b> & "you"', body: 'Line <script>x</script>\n- **bold** item' }), SITE);
    const out = html(d);
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>Hi');
    expect(out).toMatchSnapshot();
  });

  it('e-mail HTML snapshot (AR, right-to-left, digest)', () => {
    expect(html(buildAdminMessageData(mail(2, { lang: 'ar', meta: full }), SITE))).toMatchSnapshot();
  });

  it('templates fill {first_name} {ticket} {link}', () => {
    expect(fillTemplateVars('Hi {first_name}, see {ticket} at {{link}} {other}', { first_name: 'Sara', ticket: '#AB12', link: `${SITE}/x` }))
      .toBe(`Hi Sara, see #AB12 at ${SITE}/x {other}`);
  });

  it('history CSV is spreadsheet-safe', () => {
    const row = { id: '1', notification_id: 'n', created_at: '2026-10-30T12:40:00Z', recipient: 'u', recipient_name: '=HYPERLINK("x")', actor_name: 'Admin',
      category: 'notice', subject: 'Hello, "you"', status: 'sent', reason: null, is_read: true, in_app: true, important: false, is_test: false, digest: false, send_after: '' } as HistoryRow;
    const csv = historyCsv([row]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"Hello, ""you"""`);
  });

  it('groups notifications by day', () => {
    const now = new Date('2026-10-30T15:00:00');
    const g = dayGroups([{ created_at: '2026-10-30T09:00:00' }, { created_at: '2026-10-29T09:00:00' }, { created_at: '2026-10-20T09:00:00' }], now);
    expect(g.map((x) => x.label)).toEqual(['today', 'yesterday', 'date']);
  });
});

describe('review decisions — one shared sender and layout', () => {
  const decisionMail = (decision: Record<string, unknown>, lang = 'en') => buildAdminMessageData({
    mail_key: 'k', recipient: 'u', email: 'a@example.com', lang, digest: false,
    items: [{ id: '1', title: 'Your consultant profile is approved', body: 'stored English copy', link: '/consultant/verification', type: 'approval',
      created_at: '2026-10-30T12:40:00Z', meta: { v: 1, category: 'decision', decision } }],
  }, SITE);

  it('every outcome maps to one of the status badges (Approved / Needs changes / Rejected, plus Suspended and In review)', () => {
    expect(DECISION_OUTCOMES.map((o) => badgeFor(o))).toEqual(['approved', 'approved', 'changes', 'changes', 'rejected', 'changes', 'suspended', 'approved', 'review']);
    expect(DECISION_SUBJECTS).toHaveLength(8);
  });

  it('empty comment: approved sends the welcome text with next steps', () => {
    const d = decisionMail({ subject: 'consultant_profile', outcome: 'approved', comment: '' });
    const v = d.items[0];
    expect(v.category).toBe('decision');
    expect(v.title).toBe('Your consultant profile is approved');
    expect(plainBody(v)).toMatch(/^Welcome!/);
    expect(v.decision?.comment).toBe('');
    expect(v.decision?.steps).toEqual(decisionSteps('consultant_profile', 'approved', 'en'));
    expect(v.decision!.steps.length).toBeGreaterThan(1);
    const out = html(d);
    expect(out).toContain('Approved');
    expect(out).toContain('What you need to do next');
    expect(out).not.toContain('Comment from the administrator');
    expect(out).toContain('Open your profile');
    expect(out).toContain('href="https://www.aisupport360.com/consultant/verification"');
  });

  it('empty comment: rejected states a reason and how to appeal', () => {
    const v = decisionMail({ subject: 'client_account', outcome: 'rejected', comment: null }).items[0];
    expect(plainBody(v)).toContain('does not meet our current requirements');
    expect(v.decision?.steps.at(-1)).toContain('To appeal');
    expect(v.decision?.badge).toBe('rejected');
  });

  it("the admin's comment is shown in a quote card, escaped and as plain text", () => {
    const d = decisionMail({ subject: 'consultant_profile', outcome: 'changes', comment: 'Add your <script>alert(1)</script> S/4HANA projects\nand a CV' });
    const out = html(d);
    expect(out).toContain('Comment from the administrator');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
    expect(out).toContain('Needs changes');
    expect(adminMessageSubject(d)).toBe('Decision: Your consultant profile needs changes (Needs changes) — AI Support 360');
    expect(adminMessageText(d)).toContain('"Add your <script>alert(1)</script> S/4HANA projects\nand a CV"');
  });

  it('Arabic readers get the decision in Arabic, right to left', () => {
    const d = decisionMail({ subject: 'consultant_profile', outcome: 'approved' }, 'ar');
    const out = html(d);
    expect(d.items[0].title).toBe('تمت الموافقة على ملفك كمستشار');
    expect(out).toContain('dir="rtl"');
    expect(out).toContain('ما الذي عليك فعله بعد ذلك');
    expect(out).toContain('افتح ملفك');
  });

  it('unknown decision data falls back to the stored notice (never a broken e-mail)', () => {
    const v = decisionMail({ subject: 'nope', outcome: 'approved' }).items[0];
    expect(v.decision).toBeNull();
    expect(v.title).toBe('Your consultant profile is approved');
  });

  it('consultant status changes map to the same decisions as the database trigger', () => {
    expect(consultantOutcome('pending', 'verified')).toBe('approved');
    expect(consultantOutcome('rejected', 'verified')).toBe('reapproved');
    expect(consultantOutcome('suspended', 'verified')).toBe('reactivated');
    expect(consultantOutcome('under_review', 'on_hold')).toBe('info');
    expect(consultantOutcome('verified', 'pending')).toBe('unverified');
    expect(consultantOutcome('verified', 'suspended')).toBe('suspended');
    expect(consultantOutcome('pending', 'under_review')).toBe('review');
    expect(consultantOutcome('under_review', 'pending')).toBeNull();
  });

  it('the line next to the comment box says where it goes, or why not (recorded)', () => {
    expect(decisionNoticeState({ found: true, email: 'a@b.com', confirmed: true, enabled: true })).toEqual({ kind: 'send', email: 'a@b.com' });
    expect(decisionNoticeState({ found: true, email: null, confirmed: false }).kind).toBe('no_email');
    expect(decisionNoticeState({ found: true, email: 'a@b.com', confirmed: true, test: true }).kind).toBe('test');
    expect(decisionNoticeState({ found: true, email: 'a@b.com', confirmed: true, suppressed: true }).kind).toBe('suppressed');
    expect(decisionNoticeState({ found: true, email: 'a@b.com', confirmed: false }).kind).toBe('not_confirmed');
    expect(decisionNoticeState(null).kind).toBe('unknown');
  });

  it('decision e-mail HTML snapshot (EN, comment quote, next steps)', () => {
    expect(html(decisionMail({ subject: 'certificate', outcome: 'unverified', comment: 'The file is unreadable.' }))).toMatchSnapshot();
  });
});

function plainBody(v: { blocks: ReturnType<typeof formatBody> }) {
  return v.blocks.map((b) => (b.t === 'p' ? b.lines.map((l) => l.map((p) => p.text).join('')).join('\n') : '')).join('\n');
}

describe('modern e-mail layout — safe HTML and service-only footer', () => {
  const full = { v: 1, category: 'action', summary: 'Two quick changes', action_label: 'Update', deadline: '2026-11-06', context: { kind: 'other', label: 'Profile' } };
  const textOf = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const footerOf = (markup: string) => textOf(markup.split('data-part="footer"')[1] ?? '');
  // Words that would turn an app e-mail into promotion, or make claims we cannot back (owner rule: current facts only).
  const BANNED = [/why ai support 360/i, /24\s*\/\s*7/, /\d+\s*\+/, /\d+\s*%/, /guarantee/i, /best|leading|#1|top-rated/i, /testimonial|trusted by|customers love/i,
    /verified (sap )?consultants/i, /vetted experts/i, /steady (sap )?requests/i, /fair rate/i, /sign up|join now|upgrade|offer|discount/i, /لماذا/, /مضمون/];

  it('is Outlook/Gmail-safe: layout tables, inline styles only, no <style>, scripts, web fonts or extra images', () => {
    for (const lang of ['en', 'ar']) {
      const out = html(buildAdminMessageData(mail(1, { lang, meta: full }), SITE));
      expect(out).toContain('role="presentation"');
      expect(out).not.toMatch(/<style|<script|<link|@import|fonts\.googleapis/i);
      expect(out.match(/<img [^>]*>/g)).toEqual([expect.stringContaining('alt="AI Support 360"')]);
      expect(out).toContain('max-width:600px'); // fluid single column on phones
      expect(out).toContain('bgcolor="#1B2559"'); // button cell keeps its colour in Outlook
    }
  });

  it('the footer holds only the approved service lines, in both languages', () => {
    for (const lang of ['en', 'ar'] as const) {
      const c = MESSAGE_COPY[lang] as Record<string, unknown>;
      const allowed = [...FOOTER_PARTS.map((k) => String(c[k])), 'info@aisupport360.com', '·'];
      let rest = footerOf(html(buildAdminMessageData(mail(1, { lang, meta: full }), SITE)));
      for (const a of allowed.sort((x, y) => y.length - x.length)) rest = rest.split(a).join(' ');
      expect(rest.replace(/[\s.,،؟?]/g, '')).toBe('');
    }
  });

  it('no promotional value blocks or unbacked claims anywhere in the footer or plain text (single and digest, EN/AR)', () => {
    for (const lang of ['en', 'ar']) for (const n of [1, 3]) {
      const d = buildAdminMessageData(mail(n, { lang, meta: full }), SITE);
      const foot = footerOf(html(d));
      const plainFoot = adminMessageText(d).split('\n---\n').pop() ?? '';
      for (const re of BANNED) { expect(foot).not.toMatch(re); expect(plainFoot).not.toMatch(re); }
    }
  });

  it('a plain-text alternative exists with help, preferences link and company line', () => {
    const t = adminMessageText(buildAdminMessageData(mail(1, { lang: 'ar', meta: full }), SITE));
    expect(t).toContain(MESSAGE_COPY.ar.helpLine);
    expect(t).toContain('info@aisupport360.com');
    expect(t).toContain(`${SITE}/notifications/pause`);
    expect(t).toContain('AI Support 360 · www.aisupport360.com');
  });

  it('Arabic e-mail flips direction: right-aligned card, lists and gradient bar', () => {
    const out = html(buildAdminMessageData(mail(1, { lang: 'ar', meta: full, body: '- one\n- two' }), SITE));
    expect(out).toContain('dir="rtl"');
    expect(out).toContain('direction:rtl;text-align:right');
    expect(out).toContain('padding-right:22px');
    expect(out).toContain('linear-gradient(270deg');
  });
});
