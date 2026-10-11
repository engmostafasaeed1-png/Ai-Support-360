import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  terms: { data: { enabled: true, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 } as unknown },
}));

vi.mock('@/hooks/useCriticalService', () => ({
  useCriticalTerms: () => state.terms,
}));

import CriticalRequestOption from './CriticalRequestOption';
import { NO_CRITICAL_CHOICE, type CriticalChoice } from '@/lib/criticalService';

const on: CriticalChoice = { on: true, minutes: null, percent: null, agreed: false };

beforeEach(() => {
  state.terms = { data: { enabled: true, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 } };
});

afterEach(() => cleanup());

describe('CriticalRequestOption', () => {
  it('is only offered for the urgency Critical', () => {
    render(<CriticalRequestOption urgency="high" value={NO_CRITICAL_CHOICE} onChange={() => {}} />);
    expect(screen.queryByTestId('critical-option')).toBeNull();
  });

  it('is not offered while the administrator switched the service off', () => {
    state.terms = { data: { enabled: false, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 } };
    render(<CriticalRequestOption urgency="critical" value={NO_CRITICAL_CHOICE} onChange={() => {}} />);
    expect(screen.queryByTestId('critical-option')).toBeNull();
  });

  it('explains the service and keeps the choices hidden until it is switched on', () => {
    render(<CriticalRequestOption urgency="critical" value={NO_CRITICAL_CHOICE} onChange={() => {}} />);
    expect(screen.getByText(/within 30 minutes earns \+30% on their hourly rate/)).toBeTruthy();
    expect(screen.queryByLabelText('Reply window')).toBeNull();
  });

  it('switches on without a commitment', () => {
    const onChange = vi.fn();
    render(<CriticalRequestOption urgency="critical" value={NO_CRITICAL_CHOICE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Use the critical reply service' }));
    expect(onChange).toHaveBeenCalledWith({ on: true, minutes: null, percent: null, agreed: false });
  });

  it('offers longer windows and higher surcharges up to the limits', () => {
    render(<CriticalRequestOption urgency="critical" value={on} onChange={() => {}} />);
    const minutes = screen.getByLabelText('Reply window') as HTMLSelectElement;
    const percent = screen.getByLabelText('Surcharge for the consultant') as HTMLSelectElement;
    expect(Array.from(minutes.options).map((o) => o.value)).toEqual(['30', '45', '60', '90', '120', '180', '240']);
    expect(Array.from(percent.options).map((o) => o.value)).toEqual(['30', '40', '50', '60', '70', '80', '90', '100']);
    expect(minutes.value).toBe('30');
    expect(percent.value).toBe('30');
  });

  it('asks for the commitment again when a number changes', () => {
    const onChange = vi.fn();
    render(<CriticalRequestOption urgency="critical" value={{ ...on, agreed: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Reply window'), { target: { value: '60' } });
    expect(onChange).toHaveBeenCalledWith({ on: true, minutes: 60, percent: null, agreed: false });
    fireEvent.change(screen.getByLabelText('Surcharge for the consultant'), { target: { value: '50' } });
    expect(onChange).toHaveBeenLastCalledWith({ on: true, minutes: null, percent: 50, agreed: false });
  });

  it('shows the chosen numbers in the commitment and records it', () => {
    const onChange = vi.fn();
    render(<CriticalRequestOption urgency="critical" value={{ on: true, minutes: 60, percent: 40, agreed: false }} onChange={onChange} />);
    expect(screen.getByText(/replied within 60 minutes, 40% is added/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('critical-agree'));
    expect(onChange).toHaveBeenCalledWith({ on: true, minutes: 60, percent: 40, agreed: true });
  });
});
