import { describe, expect, it, vi } from 'vitest';
import { ADMIN_HOURLY_LIMIT, adminSubject, canAttempt, deliverAdminNotification, rememberNotification, safeAdminLink, UUID, type AdminMailClaim } from '../../supabase/functions/_shared/admin-notification-email';

const row: AdminMailClaim = { id: 'ad782f77-6b8e-4a53-b9fc-18c286c9b965', user_id: 'admin', title: 'Payment reported', body: 'Stored body', link: '/admin/payments', attempt: 1 };
describe('administrator notification email', () => {
  it('limits administrator email attempts to five and hourly sends to 30', () => {
    expect(ADMIN_HOURLY_LIMIT).toBe(30);
    expect(canAttempt(4)).toBe(true);
    expect(canAttempt(5)).toBe(false);
  });
  it('uses the stored title without header injection', () => {
    expect(adminSubject('Payment\r\nBcc: stranger')).toBe('[AI Support 360 admin] Payment  Bcc: stranger');
  });
  it('permits only same-origin links', () => {
    expect(safeAdminLink('/admin/payments?tab=payouts')).toBe('https://www.aisupport360.com/admin/payments?tab=payouts');
    expect(safeAdminLink('https://www.aisupport360.com/admin')).toBe('https://www.aisupport360.com/admin');
    for (const link of ['//evil.example', '/\\evil.example', 'javascript:alert(1)', 'https://www.aisupport360.com.evil.example/admin', 'https://user@www.aisupport360.com/admin']) expect(safeAdminLink(link)).toBeUndefined();
  });
  it('accepts only UUIDs', () => { expect(UUID.test(row.id)).toBe(true); expect(UUID.test('anything')).toBe(false); });
  it('ignores repeated IDs for ten minutes with a 500-entry cap', () => {
    const seen = new Map<string, number>();
    expect(rememberNotification(seen, 'one', 0)).toBe(true);
    expect(rememberNotification(seen, 'one', 599999)).toBe(false);
    expect(rememberNotification(seen, 'one', 600000)).toBe(true);
    for (let i = 0; i < 501; i++) rememberNotification(seen, String(i), 600001);
    expect(seen.size).toBe(500);
  });
  it('sends exactly once and marks accepted email', async () => {
    const send = vi.fn().mockResolvedValue({ sent: true }); const finish = vi.fn();
    await deliverAdminNotification({ claim: vi.fn().mockResolvedValue(row), send, finish, wait: vi.fn() });
    expect(send).toHaveBeenCalledExactlyOnceWith(row); expect(finish).toHaveBeenCalledExactlyOnceWith(row, true, null);
  });
  it('does not send unclaimed historical, disabled or limited rows', async () => {
    const send = vi.fn(); await deliverAdminNotification({ claim: vi.fn().mockResolvedValue(null), send, finish: vi.fn(), wait: vi.fn() });
    expect(send).not.toHaveBeenCalled();
  });
  it('records failures and stops after five attempts', async () => {
    let attempt = 0; const send = vi.fn().mockRejectedValue(new Error('failure')); const finish = vi.fn(); const wait = vi.fn();
    await deliverAdminNotification({ claim: async () => ({ ...row, attempt: ++attempt }), send, finish, wait });
    expect(send).toHaveBeenCalledTimes(5); expect(wait).toHaveBeenCalledTimes(4);
    expect(finish).toHaveBeenLastCalledWith({ ...row, attempt: 5 }, false, 'email send failed');
  });
  it('never retries suppressed recipients', async () => {
    const send = vi.fn().mockResolvedValue({ sent: false, reason: 'recipient_suppressed' }); const finish = vi.fn();
    await deliverAdminNotification({ claim: vi.fn().mockResolvedValue(row), send, finish, wait: vi.fn() });
    expect(send).toHaveBeenCalledTimes(1); expect(finish).toHaveBeenCalledWith(row, true, 'recipient_suppressed');
  });
  it('honors the email service rate-limit retry delay', async () => {
    const send = vi.fn().mockRejectedValueOnce({ status: 429, retryAfterSeconds: 42 }).mockResolvedValue({ sent: true }); const wait = vi.fn();
    await deliverAdminNotification({ claim: vi.fn().mockResolvedValue(row), send, finish: vi.fn(), wait });
    expect(wait).toHaveBeenCalledWith(42000); expect(send).toHaveBeenCalledTimes(2);
  });
});