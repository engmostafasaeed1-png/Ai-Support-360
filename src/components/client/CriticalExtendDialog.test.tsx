import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@/hooks/useCriticalService', () => ({
  useExtendCritical: () => ({ mutate: state.mutate, isPending: false }),
}));

import CriticalExtendDialog from './CriticalExtendDialog';
import type { CriticalView } from '@/lib/criticalService';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const view = (over: Partial<CriticalView> = {}): CriticalView => ({
  critical_response: true, status: 'waiting', due_at: inMinutes(20), minutes: 30, surcharge_percent: 30, extensions: 0, max_minutes: 240,
  max_surcharge_percent: 100, can_extend: true, ...over,
});

beforeEach(() => state.mutate.mockReset());
afterEach(() => cleanup());

describe('CriticalExtendDialog', () => {
  it('starts with 30 more minutes and the current surcharge, and sends only the time', () => {
    render(<CriticalExtendDialog ticketId="t1" view={view()} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alert consultants again' }));
    expect(state.mutate).toHaveBeenCalledWith({ ticketId: 't1', extraMinutes: 30, newPercent: null }, expect.anything());
  });

  it('sends the new surcharge when it was raised', () => {
    render(<CriticalExtendDialog ticketId="t1" view={view()} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Surcharge for the consultant'), { target: { value: '50' } });
    expect(screen.getByText('Surcharge: +50%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alert consultants again' }));
    expect(state.mutate).toHaveBeenCalledWith({ ticketId: 't1', extraMinutes: 30, newPercent: 50 }, expect.anything());
  });

  it('can raise the surcharge without more time while the window is open', () => {
    render(<CriticalExtendDialog ticketId="t1" view={view()} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Add time'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Surcharge for the consultant'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Alert consultants again' }));
    expect(state.mutate).toHaveBeenCalledWith({ ticketId: 't1', extraMinutes: 0, newPercent: 40 }, expect.anything());
  });

  it('does not send a change that changes nothing', () => {
    render(<CriticalExtendDialog ticketId="t1" view={view()} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Add time'), { target: { value: '0' } });
    expect(screen.getByText('Add minutes or raise the surcharge')).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Alert consultants again' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('needs minutes when the reply window has passed', () => {
    render(<CriticalExtendDialog ticketId="t1" view={view({ status: 'missed', due_at: inMinutes(-5) })} open onOpenChange={() => {}} />);
    const add = screen.getByLabelText('Add time') as HTMLSelectElement;
    expect(Array.from(add.options).map((o) => o.value)).toEqual(['5', '10', '15', '30', '60', '120', '240']);
    expect(add.value).toBe('30');
  });

  it('offers only the surcharges from the current one up to the limit', () => {
    render(<CriticalExtendDialog ticketId="t1" view={view({ surcharge_percent: 50, max_surcharge_percent: 80 })} open onOpenChange={() => {}} />);
    const percent = screen.getByLabelText('Surcharge for the consultant') as HTMLSelectElement;
    expect(Array.from(percent.options).map((o) => o.value)).toEqual(['50', '60', '70', '80']);
    expect(percent.value).toBe('50');
  });
});
