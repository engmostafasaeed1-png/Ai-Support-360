import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const scheduleMeeting = vi.fn();
vi.mock('@/lib/scheduleMeeting', () => ({ scheduleMeeting: (x: unknown) => scheduleMeeting(x) }));
vi.mock('@/integrations/supabase/client', () => {
  const q = () => ({ select: () => q(), eq: () => q(), in: () => q(), then: (r: (v: unknown) => void) => r({ data: [] }) });
  return { supabase: { from: () => q() } };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (_: string, f: string) => f }) }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }));
vi.mock('@/components/ui/calendar', () => ({ Calendar: ({ onSelect }: { onSelect: (d: Date) => void }) => <button type="button" onClick={() => onSelect(new Date(Date.now() + 3 * 86_400_000))}>pick date</button> }));

import ScheduleMeetingDialog from './ScheduleMeetingDialog';

const setup = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <ScheduleMeetingDialog open onOpenChange={() => {}} ticketId="t1" ticketTitle="SAP issue" clientId="c1" consultantId={null} />
  </QueryClientProvider>,
);
const goExternal = () => fireEvent.click(screen.getByText('External'));

describe('ScheduleMeetingDialog external invitees', () => {
  beforeEach(() => { scheduleMeeting.mockReset(); toastError.mockReset(); Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }); });

  it('adds valid (plus, upper case) addresses as chips and explains an invalid one', () => {
    setup(); goExternal();
    const input = screen.getByTestId('external-email-input');
    fireEvent.change(input, { target: { value: 'Ali+Meet@Example.COM, not-an-email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByTestId('external-email-chip').map((c) => c.textContent)).toEqual(['Ali+Meet@example.com']);
    expect(screen.getByTestId('external-email-error')).toHaveTextContent('Not a valid e-mail address: not-an-email');
  });

  it('shows the real reason instead of "Failed to schedule meeting"', async () => {
    scheduleMeeting.mockResolvedValue({ ok: false, code: 'not_allowed' });
    setup(); goExternal();
    fireEvent.change(screen.getByTestId('external-email-input'), { target: { value: 'guest@partner.sa' } });
    fireEvent.keyDown(screen.getByTestId('external-email-input'), { key: 'Enter' });
    fireEvent.click(screen.getByText('pick date'));
    fireEvent.click(screen.getByRole('button', { name: /Schedule Meeting/ }));
    await waitFor(() => expect(screen.getByTestId('schedule-meeting-error')).toHaveTextContent('Only the client of this request, an assigned consultant or an administrator'));
    expect(toastError).not.toHaveBeenCalledWith('Failed to schedule meeting');
    expect(scheduleMeeting.mock.calls[0][0]).toMatchObject({ external_emails: ['guest@partner.sa'], consultant_ids: [] });
  });

  it('shows the delivery status of each recipient', async () => {
    scheduleMeeting.mockResolvedValue({ ok: true, session_id: 's', meeting_url: 'm', join_url: 'https://www.aisupport360.com/join/s',
      invitations: [{ email: 'a@x.com', status: 'sent' }, { email: 'b@y.com', status: 'failed' }] });
    setup(); goExternal();
    fireEvent.change(screen.getByTestId('external-email-input'), { target: { value: 'a@x.com b@y.com' } });
    fireEvent.keyDown(screen.getByTestId('external-email-input'), { key: 'Enter' });
    fireEvent.click(screen.getByText('pick date'));
    fireEvent.click(screen.getByRole('button', { name: /Schedule Meeting/ }));
    await waitFor(() => expect(screen.getAllByTestId('invitation-status')).toHaveLength(2));
    const rows = screen.getAllByTestId('invitation-status');
    expect(rows[0]).toHaveAttribute('data-status', 'sent');
    expect(rows[1]).toHaveTextContent('Not sent: the e-mail service had a problem');
  });
});
