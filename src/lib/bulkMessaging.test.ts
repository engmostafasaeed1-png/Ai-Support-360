import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULTS, buildAudience, confirmationOk, exclusionReason, needsTypedConfirmation, normalizePhone, parseEmails, parseMessage,
  recipientPlan, renderVariables, riskWarnings, secretFindings, smsLink, throttleBudget, toPlainText, whatsappLink, withinDailyCap,
  zonedToUtc, EMPTY_FILTER, footerText, pickText,
} from './bulkMessaging';
import { notificationType } from '../../supabase/functions/_shared/bulkMessaging';
import { notificationCategory } from '../../supabase/functions/_shared/notificationPause';
import { runBulkBatch, type ClaimRow, type FinishRow } from '../../supabase/functions/_shared/bulkMessagesRun';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firstArg = <T,>(m: { mock: { calls: any[] } }): T => m.mock.calls[0][0] as T;
type Inserted = Array<{ user_id: string; title: string; body: string; type: string; link: string }>;
import { effectivePermissions, hasPermission } from './userAdmin';

const sql = readFileSync('docs/sql/bulk-messaging.sql', 'utf8');

describe('audience definitions', () => {
  it('pasted e-mails are cleaned, lower-cased and deduplicated', () => {
    expect(parseEmails('A@x.com, a@x.com;\n<b@y.org> not-an-email c@z')).toEqual(['a@x.com', 'b@y.org']);
  });
  it('a filter only carries the criteria that were set', () => {
    expect(buildAudience('filter', { filter: { ...EMPTY_FILTER, roles: ['consultant'], location_missing: true, inactive_days: 90 } }))
      .toEqual({ kind: 'filter', roles: ['consultant'], location_missing: true, inactive_days: 90 });
  });
  it('selected users are capped at 5000', () => {
    const ids = Array.from({ length: 5100 }, (_, i) => `id-${i}`);
    expect((buildAudience('users', { userIds: ids }) as { user_ids: string[] }).user_ids).toHaveLength(5000);
  });
});

describe('exclusions', () => {
  const base = { user_id: 'u' };
  it('suspended and deleted accounts never receive anything, service or marketing', () => {
    expect(exclusionReason({ ...base, suspended: true }, 'service')).toBe('suspended');
    expect(exclusionReason({ ...base, deleted: true }, 'marketing')).toBe('deleted');
  });
  it('marketing skips unsubscribed and paused people; service notices do not', () => {
    expect(exclusionReason({ ...base, unsubscribed: true }, 'marketing')).toBe('unsubscribed');
    expect(exclusionReason({ ...base, paused: true }, 'marketing')).toBe('paused');
    expect(exclusionReason({ ...base, unsubscribed: true, paused: true }, 'service')).toBeNull();
  });
  it('people the admin unticks are excluded', () => {
    expect(exclusionReason(base, 'service', true)).toBe('excluded_by_admin');
  });
  it('Telegram only for linked users, manual channels only with a phone; pop-up rides on in-app', () => {
    expect(recipientPlan({ ...base, telegram: false, has_phone: true }, 'service', ['in_app', 'popup', 'telegram', 'whatsapp_manual'])).toEqual([
      { channel: 'in_app', status: 'queued', reason: null },
      { channel: 'telegram', status: 'skipped', reason: 'not_linked' },
      { channel: 'whatsapp_manual', status: 'manual_pending', reason: null },
    ]);
    expect(recipientPlan({ ...base, suspended: true }, 'service', ['in_app', 'sms_manual']).every((r) => r.status === 'skipped' && r.reason === 'suspended')).toBe(true);
  });
});

describe('essential vs marketing', () => {
  it('service messages are essential (never paused); marketing is a pausable digest', () => {
    expect(notificationCategory(notificationType('service'), 'Service notice')).toBe('essential');
    expect(notificationCategory(notificationType('marketing'), 'News')).toBe('digests');
  });
  it('the database classifier agrees', () => {
    const q = readFileSync('docs/sql/notification-pauses.sql', 'utf8');
    expect(q).toMatch(/IN \('digest', 'admin', 'admin_marketing'\) THEN 'digests'/);
    expect(q).toMatch(/'admin_message'[\s\S]*?THEN 'essential'/);
  });
});

describe('confirmation, throttling and caps', () => {
  it('more than 50 recipients need the number typed', () => {
    expect(needsTypedConfirmation(50)).toBe(false);
    expect(needsTypedConfirmation(51)).toBe(true);
    expect(confirmationOk('', 51)).toBe(false);
    expect(confirmationOk(' 51 ', 51)).toBe(true);
    expect(sql).toContain("_count > 50 AND COALESCE(_payload ->> 'confirm_count', '') <> _count::TEXT");
  });
  it('per-minute budget subtracts what was claimed in the last minute, capped per run', () => {
    expect(throttleBudget(100, 0)).toBe(100);
    expect(throttleBudget(100, 70)).toBe(30);
    expect(throttleBudget(100, 150)).toBe(0);
    expect(throttleBudget(1000, 0)).toBe(DEFAULTS.maxClaimsPerRun);
    expect(withinDailyCap(1990, 10, 2000)).toBe(true);
    expect(withinDailyCap(1990, 11, 2000)).toBe(false);
  });
  it('defaults match the database settings', () => {
    expect(sql).toContain("('bulk_inapp_per_minute', '100'::jsonb)");
    expect(sql).toContain("('bulk_telegram_per_minute', '240'::jsonb)");
    expect(sql).toContain("('bulk_daily_cap', '2000'::jsonb)");
    expect(sql).toContain("('bulk_messaging_enabled', 'true'::jsonb)");
    expect(sql).toContain("('bulk_whatsapp_sms_provider', '\"off\"'::jsonb)");
    expect(DEFAULTS.telegramPerMinute / 60).toBeLessThan(25);
  });
});

describe('content safety', () => {
  it('obvious secrets are found', () => {
    expect(secretFindings('Your password: Winter2026!')).toEqual(['password']);
    expect(secretFindings('كلمة المرور: 12345')).toEqual(['password']);
    expect(secretFindings('key sk_live_abcdefghijklmnop')).toEqual(['api_key']);
    expect(secretFindings('-----BEGIN RSA PRIVATE KEY-----')).toEqual(['private_key']);
    expect(secretFindings('Please reset your password in settings')).toEqual([]);
  });
  it('contact details, payment instructions and outside links raise warnings', () => {
    expect(riskWarnings('Write to me at a@b.com or +966 50 123 4567')).toEqual(expect.arrayContaining(['contact_email', 'contact_phone']));
    expect(riskWarnings('Send the money by bank transfer to SA0380000000608010167519')).toContain('payment');
    expect(riskWarnings('أرسل حوالة')).toContain('payment');
    expect(riskWarnings('See https://evil.example/login')).toContain('external_link');
    expect(riskWarnings('See https://www.aisupport360.com/pricing')).toEqual([]);
  });
  it('only https or site links and brand images survive the message format', () => {
    const blocks = parseMessage('Hi [click](javascript:alert(1)) and [ok](/pricing)\n![x](https://evil/img.png)\n![Logo](brand:mark)\n[[Open|http://evil]]');
    const flat = JSON.stringify(blocks);
    expect(flat).not.toContain('javascript');
    expect(flat).not.toContain('evil/img');
    expect(flat).toContain('https://www.aisupport360.com/pricing');
    expect(blocks.some((b) => b.kind === 'image' && b.key === 'mark')).toBe(true);
    expect(blocks.some((b) => b.kind === 'button')).toBe(false);
  });
});

describe('variables, language and footer', () => {
  it('fills variables with fallbacks', () => {
    expect(renderVariables('Hi {{first_name}}, {{company}} is at {{profile_completion}}', { first_name: 'Sara', company: 'Acme', profile_completion: 80 }))
      .toBe('Hi Sara, Acme is at 80 %');
    expect(renderVariables('Hi {{first_name}} {{unknown}}', {})).toBe('Hi there ');
  });
  it('Arabic speakers get the Arabic text when written, otherwise English', () => {
    expect(pickText('ar', 'Hello', 'مرحباً')).toEqual({ lang: 'ar', text: 'مرحباً' });
    expect(pickText('ar', 'Hello', '')).toEqual({ lang: 'en', text: 'Hello' });
  });
  it('the footer names the sender, the reason, pause/unsubscribe and privacy', () => {
    const f = footerText('en', 'marketing');
    expect(f).toContain('AI Support 360');
    expect(f).toContain('/notifications');
    expect(f).toContain('/privacy-policy');
    expect(footerText('ar', 'service')).toContain('الخصوصية');
  });
  it('plain text keeps link targets', () => {
    expect(toPlainText('**Hi** [here](/x)\n- one')).toBe('Hi here (https://www.aisupport360.com/x)\n\n• one');
  });
});

describe('WhatsApp and SMS links', () => {
  it('normalises numbers', () => {
    expect(normalizePhone('+966 50-123 4567')).toBe('966501234567');
    expect(normalizePhone('00201001234567')).toBe('201001234567');
    expect(normalizePhone('123')).toBeNull();
  });
  it('pre-fills the text URL-encoded', () => {
    const text = 'Hi Sara & team?\nسلام #1';
    expect(whatsappLink('+966501234567', text)).toBe(`https://wa.me/966501234567?text=${encodeURIComponent(text)}`);
    expect(whatsappLink('+966501234567', text)).not.toMatch(/[ \n&?#](?!text=)[^=]*$/);
    expect(smsLink('+966501234567', 'a&b c')).toBe('sms:+966501234567?&body=a%26b%20c');
    expect(whatsappLink('abc', 'x')).toBeNull();
  });
});

describe('scheduling', () => {
  it('converts a wall-clock time in a time zone to UTC', () => {
    expect(zonedToUtc('2026-10-21T09:30', 'Asia/Riyadh')?.toISOString()).toBe('2026-10-21T06:30:00.000Z');
    expect(zonedToUtc('2026-07-01T12:00', 'Europe/London')?.toISOString()).toBe('2026-07-01T11:00:00.000Z');
    expect(zonedToUtc('bad', 'UTC')).toBeNull();
  });
});

describe('permission messages.send', () => {
  it('super admins have it; admins only through a group that grants it; others never', () => {
    expect(hasPermission({ roles: ['super_admin'] }, 'messages.send')).toBe(true);
    expect(hasPermission({ roles: ['admin'] }, 'messages.send')).toBe(false);
    expect(hasPermission({ roles: ['admin'], groupPermissions: [['users.read']] }, 'messages.send')).toBe(false);
    expect(hasPermission({ roles: ['admin'], groupPermissions: [['messages.send']] }, 'messages.send')).toBe(true);
    expect(effectivePermissions({ roles: ['client', 'consultant'] })).toEqual([]);
  });
  it('the database checks the same rule, and worker functions are service-only', () => {
    expect(sql).toMatch(/has_role\(_uid, 'super_admin'\) THEN RETURN true/);
    expect(sql).toContain("''messages.send'' = ANY (g.permissions)");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bm_claim(INT) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bm_finish(JSONB) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('FOR UPDATE OF r SKIP LOCKED');
    expect(readFileSync('docs/sql/user-management.sql', 'utf8')).toContain("THEN _perm <> 'messages.send'");
  });
});

describe('send worker', () => {
  const row = (over: Partial<ClaimRow>): ClaimRow => ({
    campaign_id: 'c1', user_id: 'u1', channel: 'in_app', lang: 'en', category: 'marketing', popup: false,
    subject_en: 'News for {{first_name}}', subject_ar: null, body_en: 'Hello {{first_name}}', body_ar: 'مرحباً {{first_name}}', link_url: '/pricing',
    first_name: 'Sara', company: null, profile_completion: null, chat_id: null, attempts: 1, ...over,
  });
  const deps = (rows: ClaimRow[], over: Record<string, unknown> = {}) => ({
    claim: vi.fn(async () => rows),
    insertNotifications: vi.fn(async (r: Array<{ user_id: string }>) => r.map((x, i) => ({ id: `n${i}`, user_id: x.user_id }))),
    sendTelegram: vi.fn(async () => ({ ok: true, blocked: false })),
    pauseTelegramLink: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    now: () => 0,
    ...over,
  });

  it('stores in-app messages in the recipient language with variables and footer, typed as marketing', async () => {
    const d = deps([row({}), row({ user_id: 'u2', lang: 'ar', first_name: 'ليلى' })]);
    const r = await runBulkBatch(d);
    expect(r).toEqual({ claimed: 2, sent: 2, failed: 0 });
    const inserted = firstArg<Inserted>(d.insertNotifications);
    expect(inserted[0]).toMatchObject({ title: 'News for Sara', body: expect.stringContaining('Hello Sara'), type: 'admin_marketing', link: '/notifications?broadcast=c1' });
    expect(inserted[1].body).toContain('مرحباً ليلى');
    const finished = firstArg<FinishRow[]>(d.finish);
    expect(finished[0]).toMatchObject({ ok: true, notification_id: 'n0' });
    expect(finished[0].body).toContain('/privacy-policy');
  });

  it('a blocked bot pauses the link without retry; rate limits retry; out of time defers', async () => {
    let t = 0;
    const d = deps([
      row({ channel: 'telegram', user_id: 'a', chat_id: 1 }),
      row({ channel: 'telegram', user_id: 'b', chat_id: 2 }),
      row({ channel: 'telegram', user_id: 'c', chat_id: 3 }),
    ], {
      sendTelegram: vi.fn()
        .mockResolvedValueOnce({ ok: false, blocked: true, error: 'bot_blocked' })
        .mockResolvedValueOnce({ ok: false, blocked: false, error: 'rate_limited' }),
      now: () => (t += 20_000),
    });
    await runBulkBatch(d, 45_000);
    const f = firstArg<FinishRow[]>(d.finish);
    expect(f[0]).toMatchObject({ user_id: 'a', ok: false, retry: false, error: 'bot_blocked' });
    expect(d.pauseTelegramLink).toHaveBeenCalledWith('a', 'bot_blocked');
    expect(f[1]).toMatchObject({ user_id: 'b', ok: false, retry: true });
    expect(f[2]).toMatchObject({ user_id: 'c', ok: false, retry: true, error: 'deferred' });
    expect(d.sleep).toHaveBeenCalledWith(DEFAULTS.telegramGapMs);
  });

  it('Telegram text is HTML-escaped plain text with one link', async () => {
    const send = vi.fn(async () => ({ ok: true, blocked: false }));
    await runBulkBatch(deps([row({ channel: 'telegram', chat_id: 9, body_en: '**Bold** <script>' })], { sendTelegram: send }));
    const calls = send.mock.calls as unknown as Array<[number, string, string | null]>;
    const [, text, link] = calls[0];
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('**');
    expect(link).toBe('https://www.aisupport360.com/pricing');
  });
});

describe('e-mail stays out of bulk messages', () => {
  it('the administrator e-mail function skips admin bulk messages', () => {
    const f = readFileSync('supabase/functions/admin-notification-email/index.ts', 'utf8');
    expect(f).toContain("bulk_message_in_app_only");
    expect(readFileSync('supabase/functions/bulk-messages-run/index.ts', 'utf8')).not.toContain('sendTemplateEmail');
  });
});

describe('sender schedule', () => {
  const body = (fn: string) => {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    return sql.slice(start, sql.indexOf('END $$;', start));
  };
  it('creating, cancelling and re-enabling wake the sender', () => {
    for (const fn of ['bm_create_campaign', 'bm_cancel_campaign', 'bm_set_settings', 'bm_claim']) {
      expect(body(fn)).toContain('PERFORM public.bm_arm_worker()');
    }
  });
  it('runs every minute only while sending or due, and is removed when nothing is left or switched off', () => {
    const arm = body('bm_arm_worker');
    expect(arm).toContain("status = 'sending'");
    expect(arm).toContain("scheduled_at <= now() + interval '1 minute'");
    expect(arm).toContain("platform_flag('bulk_messaging_enabled', true)");
    expect(arm).toContain("cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bulk-messages-run'");
    expect(sql.match(/cron\.schedule\(/g)).toHaveLength(1);
    expect(sql).not.toMatch(/SELECT cron\.schedule\(/);
  });
});
