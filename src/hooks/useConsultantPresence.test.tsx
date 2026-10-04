import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { presenceStore } from '@/lib/presenceStore';
import { useConsultantPresence } from './useConsultantPresence';

function Probe({ enabled = true }: { enabled?: boolean }) {
  const present = useConsultantPresence(enabled);
  return <div data-testid="probe">{present === null ? 'unknown' : Array.from(present).sort().join(',') || 'nobody'}</div>;
}

beforeEach(() => {
  presenceStore.set(null);
});
afterEach(() => cleanup());

describe('useConsultantPresence', () => {
  it('does not know who is present before the channel has answered', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('unknown');
  });

  it('knows who is present once the answer is saved, and follows the changes', () => {
    render(<Probe />);
    act(() => presenceStore.set(new Set(['c-2', 'c-1'])));
    expect(screen.getByTestId('probe').textContent).toBe('c-1,c-2');
    act(() => presenceStore.set(new Set()));
    expect(screen.getByTestId('probe').textContent).toBe('nobody');
    act(() => presenceStore.set(null));
    expect(screen.getByTestId('probe').textContent).toBe('unknown');
  });

  it('shows what is already known when a page opens later', () => {
    presenceStore.set(new Set(['c-3']));
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('c-3');
  });

  it('says it does not know when it is not enabled, whatever is saved', () => {
    presenceStore.set(new Set(['c-1']));
    render(<Probe enabled={false} />);
    expect(screen.getByTestId('probe').textContent).toBe('unknown');
  });

  it('can be used by two pages at the same time', () => {
    render(<><Probe /><Probe /></>);
    act(() => presenceStore.set(new Set(['c-1'])));
    expect(screen.getAllByTestId('probe').map(element => element.textContent)).toEqual(['c-1', 'c-1']);
  });
});
