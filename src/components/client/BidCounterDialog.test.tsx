import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), error: vi.fn() }));
vi.mock('@/hooks/useClientBids', () => ({ useCounterOffer: () => ({ mutate: mocks.mutate, isPending: false }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn() } }));
import BidCounterDialog from './BidCounterDialog';
const props = { bid: { id: 'p', proposed_rate: 100, estimated_hours: 3, timeline_days: 2 }, open: true, hasCounter: false, onOpenChange: vi.fn() };
beforeEach(() => vi.clearAllMocks());
describe('counter dialog', () => {
  it('prefills and sends the concrete bid values', () => { render(<BidCounterDialog {...props} />); expect(screen.getByLabelText('Rate per hour')).toHaveValue(100); expect(screen.getByLabelText('Estimated hours')).toHaveValue(3); expect(screen.getByLabelText('Timeline days')).toHaveValue(2); fireEvent.click(screen.getByRole('button', { name: 'Send counter-offer' })); expect(mocks.mutate.mock.calls[0][0]).toEqual({ proposalId: 'p', rate: 100, hours: 3, days: 2, message: '' }); });
  it('rejects nonpositive amounts and a second round', () => { const { rerender } = render(<BidCounterDialog {...props} />); fireEvent.change(screen.getByLabelText('Rate per hour'), { target: { value: '0' } }); expect(screen.getByRole('button', { name: 'Send counter-offer' })).toBeDisabled(); rerender(<BidCounterDialog {...props} hasCounter />); expect(screen.getByRole('button', { name: 'Send counter-offer' })).toBeDisabled(); });
  it('shows database errors verbatim in a toast', () => { mocks.mutate.mockImplementation((_value, options) => options.onError({ message: 'Request no longer open' })); render(<BidCounterDialog {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Send counter-offer' })); expect(mocks.error).toHaveBeenCalledWith('Request no longer open'); });
});
