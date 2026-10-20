import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PolicyAcceptForm from './PolicyAcceptForm';

describe('required checkbox', () => {
  it('keeps submit disabled until ticked, then accepts that version', async () => {
    const onAccept = vi.fn(async () => {});
    render(<PolicyAcceptForm version={3} submitLabel="Accept and submit for review" onAccept={onAccept} />);
    const button = screen.getByRole('button', { name: 'Accept and submit for review' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the Consultant Service Policy (version 3)' }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith(3));
  });

  it('shows a refusal next to the button and keeps the form usable', async () => {
    const onAccept = vi.fn(async () => { throw new Error('A newer version of the Consultant Service Policy is available. Please reload and read it.'); });
    render(<PolicyAcceptForm version={1} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A newer version');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});
