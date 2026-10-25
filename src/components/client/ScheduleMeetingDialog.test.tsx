import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const scheduleMeeting = vi.fn();
const meetingOptions = vi.fn();
vi.mock('@/lib/scheduleMeeting', () => ({
  scheduleMeeting: (x: unknown) => scheduleMeeting(x),
  meetingOptions: (x: unknown) => meetingOptions(x),
  DEFAULT_MEETING_OPTIONS: { external_allowed: true, can_invite_colleagues: false, colleagues: [], busy: [], primary_consultant_id: null },
}));
// Table data the dialog reads: the assigned consultant of the ticket and his public name.
let tables: Record<string, unknown[]> = {};
vi.mock('@/integrations/supabase/client', () => {
  const q = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) b[m] = () => b;
    b.then = (r: (v: unknown) => void) => r({ data: tables[table] ?? [] });
    return b;
  };
  return { supabase: { from: (t: string) => q(t) } };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (_: string, f: string) => f }) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }));
const PICKED = new Date(Date.now() + 3 * 86_400_000);
vi.mock('@/components/ui/calendar', () => ({ Calendar: ({ onSelect }: { onSelect: (d: Date) => void }) => <button type="button" onClick={() => onSelect(new Date(PICKED))}>pick date</button> }));

import ScheduleMeetingDialog from './ScheduleMeetingDialog';

const OPTIONS = { external_allowed: true, can_invite_colleagues: false, colleagues: [], busy: [], primary_consultant_id: null };
const setup = (consultantId: string | null = null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ScheduleMeetingDialog open onOpenChange={() => {}} ticketId="t1" ticketTitle="SAP issue" clientId="c1" consultantId={consultantId} />
  </QueryClientProvider>,
);
const goExternal = () => fireEvent.click(screen.getByText('External'));
const submit = () => screen.getByRole('button', { name: /^Schedule Meeting$/ });

beforeEach(() => {
  scheduleMeeting.mockReset(); toastError.mockReset(); toastSuccess.mockReset();
  meetingOptions.mockReset(); meetingOptions.mockResolvedValue(OPTIONS);
  tables = {};
  Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
});

describe('ScheduleMeetingDialog', () => {
  it('opens with the title, the time zone and the reasons the button is still disabled', async () => {
    setup();
    expect(screen.getByRole('heading', { name: /Schedule Meeting/ })).toBeInTheDocument();
    expect(screen.getByTestId('meeting-timezone')).toHaveTextContent('Times are in your time zone');
    expect(submit()).toBeBlocked();
    const missing = screen.getByTestId('schedule-meeting-missing');
    expect(missing).toHaveTextContent('Pick a date.');
    expect(missing).toHaveTextContent('Choose at least one participant.');
  });

  it('pre-selects the assigned consultant and schedules with the chosen time', async () => {
    tables = { consultants: [{ id: 'k1', user_id: 'u1' }], profile_directory: [{ user_id: 'u1', display_name: 'Sara Consultant' }] };
    scheduleMeeting.mockResolvedValue({ ok: true, session_id: 's1', meeting_url: 'm', join_url: 'https://www.aisupport360.com/join/s1', invitations: [] });
    setup('k1');
    await screen.findByText('Sara Consultant');
    fireEvent.click(screen.getByText('pick date'));
    await waitFor(() => expect(submit()).toBeUnblocked());
    fireEvent.click(submit());
    await waitFor(() => expect(scheduleMeeting).toHaveBeenCalledTimes(1));
    const body = scheduleMeeting.mock.calls[0][0];
    expect(body).toMatchObject({ ticket_id: 't1', consultant_ids: ['k1'], external_emails: [], session_type: 'video', duration_minutes: 60 });
    const at = new Date(body.scheduled_at);
    expect(at.getHours()).toBe(10);
    expect(at.getDate()).toBe(PICKED.getDate());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Meeting scheduled.')));
  });

  it('blocks a time at which the consultant is already booked', async () => {
    tables = { consultants: [{ id: 'k1', user_id: 'u1' }], profile_directory: [{ user_id: 'u1', display_name: 'Sara Consultant' }] };
    const start = new Date(PICKED); start.setHours(10, 30, 0, 0);
    meetingOptions.mockResolvedValue({ ...OPTIONS, busy: [{ consultant_id: 'k1', start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString(), kind: 'session' }] });
    setup('k1');
    await screen.findByText('Sara Consultant');
    fireEvent.click(screen.getByText('pick date'));
    expect(await screen.findByTestId('meeting-conflict')).toHaveTextContent('Sara Consultant already has a meeting at this time');
    expect(submit()).toBeBlocked();
  });

  it('shows a readable message when the server refuses (never "Failed to schedule meeting")', async () => {
    scheduleMeeting.mockResolvedValue({ ok: false, code: 'not_allowed' });
    setup(); goExternal();
    fireEvent.change(screen.getByTestId('external-email-input'), { target: { value: 'guest@partner.sa' } });
    fireEvent.keyDown(screen.getByTestId('external-email-input'), { key: 'Enter' });
    fireEvent.click(screen.getByText('pick date'));
    await waitFor(() => expect(submit()).toBeUnblocked());
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByTestId('schedule-meeting-error')).toHaveTextContent('Only the client of this request, an assigned consultant or an administrator'));
    expect(toastError).not.toHaveBeenCalledWith('Failed to schedule meeting');
    expect(scheduleMeeting.mock.calls[0][0]).toMatchObject({ external_emails: ['guest@partner.sa'], consultant_ids: [] });
  });

  it('hides the external address field when the administrator switched it off', async () => {
    meetingOptions.mockResolvedValue({ ...OPTIONS, external_allowed: false });
    setup(); goExternal();
    expect(await screen.findByTestId('external-disabled')).toHaveTextContent('switched off by the administrator');
    expect(screen.queryByTestId('external-email-input')).toBeNull();
  });

  it('adds valid (plus, upper case) addresses as chips and explains an invalid one', () => {
    setup(); goExternal();
    const input = screen.getByTestId('external-email-input');
    fireEvent.change(input, { target: { value: 'Ali+Meet@Example.COM, not-an-email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByTestId('external-email-chip').map((c) => c.textContent)).toEqual(['Ali+Meet@example.com']);
    expect(screen.getByTestId('external-email-error')).toHaveTextContent('Not a valid e-mail address: not-an-email');
  });

  it('shows the delivery status of each recipient', async () => {
    scheduleMeeting.mockResolvedValue({ ok: true, session_id: 's', meeting_url: 'm', join_url: 'https://www.aisupport360.com/join/s',
      invitations: [{ email: 'a@x.com', status: 'sent' }, { email: 'b@y.com', status: 'failed' }] });
    setup(); goExternal();
    fireEvent.change(screen.getByTestId('external-email-input'), { target: { value: 'a@x.com b@y.com' } });
    fireEvent.keyDown(screen.getByTestId('external-email-input'), { key: 'Enter' });
    fireEvent.click(screen.getByText('pick date'));
    await waitFor(() => expect(submit()).toBeUnblocked());
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getAllByTestId('invitation-status')).toHaveLength(2));
    const rows = screen.getAllByTestId('invitation-status');
    expect(rows[0]).toHaveAttribute('data-status', 'sent');
    expect(rows[1]).toHaveTextContent('Not sent: the e-mail service had a problem');
  });
});
