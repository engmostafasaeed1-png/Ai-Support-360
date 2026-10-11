import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  terms: { data: undefined as unknown, isLoading: false, isError: false },
  mutate: vi.fn(),
}));

vi.mock('@/hooks/useCriticalService', () => ({
  useCriticalTerms: () => state.terms,
  useSaveCriticalService: () => ({ mutate: state.mutate, isPending: false }),
}));

import CriticalServiceSettingsCard from './CriticalServiceSettingsCard';

const standard = { enabled: true, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 };

beforeEach(() => {
  state.terms = { data: standard, isLoading: false, isError: false };
  state.mutate.mockReset();
});

afterEach(() => cleanup());

describe('CriticalServiceSettingsCard', () => {
  it('shows the current numbers and has nothing to save yet', () => {
    render(<CriticalServiceSettingsCard />);
    expect((screen.getByLabelText('Standard reply window (minutes)') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('Standard surcharge (%)') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('Longest window a client can choose (minutes)') as HTMLInputElement).value).toBe('240');
    expect((screen.getByLabelText('Highest surcharge a client can choose (%)') as HTMLInputElement).value).toBe('100');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Nothing to save.')).toBeTruthy();
  });

  it('saves a change', () => {
    render(<CriticalServiceSettingsCard />);
    fireEvent.change(screen.getByLabelText('Standard surcharge (%)'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.mutate).toHaveBeenCalledWith({ enabled: true, minutes: 30, surcharge_percent: 35, max_minutes: 240, max_surcharge_percent: 100 });
  });

  it('switches the service off', () => {
    render(<CriticalServiceSettingsCard />);
    fireEvent.click(screen.getByRole('switch', { name: 'Critical reply service is on' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.mutate).toHaveBeenCalledWith({ ...standard, enabled: false });
  });

  it('refuses numbers the database would refuse', () => {
    render(<CriticalServiceSettingsCard />);
    fireEvent.change(screen.getByLabelText('Standard reply window (minutes)'), { target: { value: '3' } });
    expect(screen.getByRole('alert').textContent).toBe('The reply window must be between 5 and 720 minutes');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Standard reply window (minutes)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Highest surcharge a client can choose (%)'), { target: { value: '20' } });
    expect(screen.getByRole('alert').textContent).toMatch(/^The highest surcharge must be at least the standard surcharge/);
    fireEvent.change(screen.getByLabelText('Standard surcharge (%)'), { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toBe('Fill in every number');
  });

  it('says so when the settings cannot be loaded', () => {
    state.terms = { data: undefined, isLoading: false, isError: true };
    render(<CriticalServiceSettingsCard />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
