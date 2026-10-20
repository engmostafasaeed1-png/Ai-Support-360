import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn(), settings: {} as Record<string, boolean> }));
vi.mock('@/hooks/useAdminSettings', () => ({ useAdminSettings: () => ({ settings: h.settings, loading: false, updateSetting: h.update }) }));
vi.mock('@/hooks/useAssignmentPolicy', async () => {
  const m = await import('../../../supabase/functions/_shared/assignmentPolicy');
  return { useAssignmentPolicy: () => m.POLICY_DEFAULTS };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: { message: 'missing' } }),
    from: () => ({ upsert: (...a: unknown[]) => { h.upsert(...a); return Promise.resolve({ error: null }); } }),
  },
}));

import AssignmentRemindersCard from './AssignmentRemindersCard';

const renderCard = () => render(<QueryClientProvider client={new QueryClient()}><AssignmentRemindersCard /></QueryClientProvider>);
afterEach(() => { cleanup(); h.upsert.mockReset(); h.update.mockReset(); h.settings = {}; });

describe('AssignmentRemindersCard', () => {
  it('shows the owner defaults in hours and minutes and the switch on by default', () => {
    renderCard();
    expect((screen.getByLabelText('Reminder 1 after (hours)') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Reminder 2 after (hours)') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Reminder 3 after (hours)') as HTMLInputElement).value).toBe('24');
    expect((screen.getByLabelText('Critical reminder 1 (minutes)') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Critical No response (minutes)') as HTMLInputElement).value).toBe('30');
    expect(screen.getByRole('switch', { name: 'Send reminders and No response notices' })).toHaveAttribute('aria-checked', 'true');
  });

  it('saves changed timings in minutes', async () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Reminder 1 after (hours)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save timings' }));
    await waitFor(() => expect(h.upsert).toHaveBeenCalledTimes(1));
    const [row] = h.upsert.mock.calls[0] as [{ key: string; value: Record<string, number> }];
    expect(row.key).toBe('assignment_reminder_minutes');
    expect(row.value).toMatchObject({ r1: 60, r2: 240, r3: 1440, expire: 1440, critical_r1: 10, critical_expire: 30 });
  });

  it('blocks saving reminders out of order', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Reminder 2 after (hours)'), { target: { value: '30' } });
    expect(screen.getByRole('alert').textContent).toMatch(/must come in order/);
    expect(screen.getByRole('button', { name: 'Save timings' })).toBeDisabled();
  });

  it('turns the reminders switch off', () => {
    renderCard();
    fireEvent.click(screen.getByRole('switch', { name: 'Send reminders and No response notices' }));
    expect(h.update).toHaveBeenCalledWith('assignment_reminders', false);
  });
});
