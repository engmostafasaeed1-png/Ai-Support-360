import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  adminMessageSubject, adminMessageText, buildAdminMessageData, clip, finishFor, renderAdminMessage, safePortalPath,
} from '../../supabase/functions/_shared/adminMessageEmail';
import {
  adminEmailHeader, canUntickEmail, emailKindOf, typeAlreadyEmailed, MAX_RECIPIENTS_PER_ACTION, PER_RECIPIENT_PER_HOUR,
  planRecipientMail,
} from '@/lib/adminMessageEmail';

const mail = (n: number, extra: Partial<{ lang: string; digest: boolean; link: string; title: string; body: string }> = {}) => ({
  mail_key: 'k', recipient: 'u', email: 'a@example.com', lang: extra.lang ?? 'en', digest: extra.digest ?? n > 1,
  items: Array.from({ length: n }, (_, i) => ({ id: String(i), title: extra.title ?? `Title ${i}`, body: extra.body ?? 'Body', link: extra.link ?? '/consultant/profile' })),
});

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
    expect(adminMessageSubject({ lang: 'en', digest: false, items: [{ title: 'Line\r\nBcc: x@y.z', body: '', url: '' }] })).not.toMatch(/[\r\n]/);
    expect(adminMessageSubject({ lang: 'ar', digest: true, items: [1, 2, 3].map(() => ({ title: 't', body: '', url: '' })) })).toContain('3 رسائل');
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
    expect(html).not.toContain('<img');
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
