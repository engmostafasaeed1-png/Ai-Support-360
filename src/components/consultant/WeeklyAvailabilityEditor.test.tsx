import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const saveWeekly = vi.fn(async () => undefined);
const me = { consultantId: 'c1', userId: 'u1', timezone: 'Asia/Riyadh', createdAt: null, availabilityStatus: 'available', weekly: [] as Array<{ day: number; start: string; end: string }>, weeklySlotIds: [], status: null, holds: null };
vi.mock('@/hooks/useAvailabilityHold', () => ({
  useMyAvailability: () => ({ data: me, isLoading: false }),
  useAvailabilityActions: () => ({ saveWeekly }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (_: string, f: string) => f }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import WeeklyAvailabilityEditor from './WeeklyAvailabilityEditor';

describe('WeeklyAvailabilityEditor', () => {
  beforeEach(() => saveWeekly.mockClear());

  it('preset fills the days and the live summary, then saves', async () => {
    render(<WeeklyAvailabilityEditor />);
    expect(screen.getByTestId('availability-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('preset-sun_thu'));
    expect(screen.getByTestId('availability-summary')).toHaveTextContent('Sun-Thu, 09:00-17:00 Riyadh time, 40 h/week');
    expect(screen.getByTestId('day-chip-0')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('day-chip-5')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('availability-save'));
    await waitFor(() => expect(saveWeekly).toHaveBeenCalledTimes(1));
    expect((saveWeekly.mock.calls[0] as unknown[])[1]).toHaveLength(5);
  });

  it('end before start is shown next to the time and blocks saving', async () => {
    render(<WeeklyAvailabilityEditor />);
    fireEvent.click(screen.getByTestId('day-chip-1'));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '08:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The end time must be after the start time.');
    fireEvent.click(screen.getByTestId('availability-save'));
    await Promise.resolve();
    expect(saveWeekly).not.toHaveBeenCalled();
  });

  it('copy to all working days', () => {
    render(<WeeklyAvailabilityEditor />);
    fireEvent.click(screen.getByTestId('day-chip-0'));
    fireEvent.click(screen.getByTestId('day-chip-1'));
    const sunday = screen.getAllByLabelText('From')[0];
    fireEvent.change(sunday, { target: { value: '08:00' } });
    fireEvent.click(screen.getByTestId('copy-0'));
    expect(screen.getByTestId('availability-summary')).toHaveTextContent('Sun-Mon, 08:00-17:00 Riyadh time, 18 h/week');
  });
});
