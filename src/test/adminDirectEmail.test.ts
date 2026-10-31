import { describe, expect, it } from 'vitest';
import {
  arabicIncomplete, DEFAULT_DIRECT_CHANNEL, DEFAULT_PER_SEND_CAP, directBlocker, directPayload, hasOutsideLink, pauseCategoryFor, personalise,
  reportCounts, reportCsv, rowStatus, type DirectPreview, type DirectReportRow,
} from '@/lib/adminDirectEmail';

const preview = (p: Partial<DirectPreview> = {}): DirectPreview => ({
  enabled: true, email_enabled: true, channel: 'both', cap: 200, requested: 3, recipients: 3, email_reach: 3, in_app_reach: 3, arabic: 0, english: 3,
  by_reason: {}, excluded: [], sample: [], later: 0, daily_cap: 300, per_admin_hour: 60, per_recipient_hour: 5, sent_today: 0, admin_sent_hour: 0, waiting: 0, ...p,
});
const row = (r: Partial<DirectReportRow> = {}): DirectReportRow => ({
  user_id: 'u', name: 'Sara', email: 's@example.com', lang: 'en', in_app: true, read: false, email_status: 'sent', reason: null, send_after: null, finished_at: null, ...r,
});

describe('direct admin e-mail', () => {
  it('defaults: In-app + e-mail, at most 200 people per send', () => {
    expect(DEFAULT_DIRECT_CHANNEL).toBe('both');
    expect(DEFAULT_PER_SEND_CAP).toBe(200);
  });

  it('personalises {first_name} like the database, and drops it cleanly when there is no name', () => {
    expect(personalise('Hi {first_name}, welcome', 'Sara')).toBe('Hi Sara, welcome');
    expect(personalise('Hi {{first_name}}, welcome', 'Sara')).toBe('Hi Sara, welcome');
    expect(personalise('Hi {first_name}, welcome', '')).toBe('Hi, welcome');
    expect(personalise('Open {link}', 'Sara', '/client/tickets')).toBe('Open https://www.aisupport360.com/client/tickets');
  });

  it('only allows web addresses on our own site, look-alike domains are outside', () => {
    expect(hasOutsideLink('Plain text only')).toBe(false);
    expect(hasOutsideLink('See https://www.aisupport360.com/pricing.')).toBe(false);
    expect(hasOutsideLink('See https://evil.example/x')).toBe(true);
    expect(hasOutsideLink('See www.evil.example')).toBe(true);
    expect(hasOutsideLink('See https://aisupport360.com.evil.example')).toBe(true);
  });

  it('Arabic version needs both subject and message, or neither', () => {
    expect(arabicIncomplete('', '')).toBe(false);
    expect(arabicIncomplete('مرحبا', '')).toBe(true);
    expect(arabicIncomplete('مرحبا', 'نص')).toBe(false);
  });

  it('quiet pauses: reminders pause with reminders, everything else with activity', () => {
    expect(pauseCategoryFor('reminder')).toBe('reminders');
    expect(pauseCategoryFor('notice')).toBe('activity');
  });

  it('send stays dimmed with the reason: over the cap, nobody, switch off, not confirmed', () => {
    expect(directBlocker(preview({ recipients: 201 }), { installed: true, confirmed: true })).toBe('over_cap');
    expect(directBlocker(preview({ recipients: 200 }), { installed: true, confirmed: true })).toBeNull();
    expect(directBlocker(preview({ recipients: 0 }), { installed: true, confirmed: true })).toBe('nobody');
    expect(directBlocker(preview({ enabled: false }), { installed: true, confirmed: true })).toBe('switched_off');
    expect(directBlocker(preview({ email_enabled: false }), { installed: true, confirmed: true })).toBe('email_off');
    expect(directBlocker(preview({ email_enabled: false, channel: 'in_app' }), { installed: true, confirmed: true })).toBeNull();
    expect(directBlocker(preview(), { installed: true, confirmed: false })).toBe('confirm');
    expect(directBlocker(null, { installed: false, confirmed: true })).toBe('not_installed');
  });

  it('request keeps {first_name} for the database to fill per person', () => {
    const p = directPayload({ category: 'notice', subject: 'Hi {first_name}', summary: '', body: 'x', link: '', action_label: '', deadline: null,
      subject_ar: '', summary_ar: '', body_ar: '', action_label_ar: '', context: null }, { channel: 'email', important: true, includeTests: false }, ['a', 'b'], { requestKey: 'k-12345678', confirmed: true });
    expect(p.subject).toBe('Hi {first_name}');
    expect(p).toMatchObject({ ids: ['a', 'b'], channel: 'email', important: true, tests: false, request_key: 'k-12345678', confirmed: true, test: false });
  });

  it('result statuses per person: sent, queued, later, skipped with reason, failed, in-app only', () => {
    const now = Date.parse('2026-10-31T10:00:00Z');
    expect(rowStatus(row(), 'both', now)).toBe('sent');
    expect(rowStatus(row({ email_status: 'queued', send_after: '2026-10-31T10:00:00Z' }), 'both', now)).toBe('queued');
    expect(rowStatus(row({ email_status: 'queued', send_after: '2026-11-01T00:05:00Z' }), 'both', now)).toBe('later');
    expect(rowStatus(row({ email_status: 'skipped', reason: 'no_email' }), 'both', now)).toBe('skipped');
    expect(rowStatus(row({ email_status: null, reason: 'test_account', in_app: false }), 'email', now)).toBe('skipped');
    expect(rowStatus(row({ email_status: 'failed' }), 'email', now)).toBe('failed');
    expect(rowStatus(row({ email_status: null }), 'in_app', now)).toBe('in_app');
    expect(reportCounts([row(), row({ email_status: 'failed' }), row({ email_status: 'skipped' })], 'both', now)).toMatchObject({ sent: 1, failed: 1, skipped: 1 });
  });

  it('CSV export is spreadsheet-safe and has one line per person', () => {
    const csv = reportCsv([row({ name: '=HYPERLINK("x")' }), row({ email_status: 'skipped', reason: 'no_email' })], 'both');
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith(`"'=HYPERLINK`)).toBe(true);
    expect(lines[2]).toContain('No e-mail address');
  });
});
