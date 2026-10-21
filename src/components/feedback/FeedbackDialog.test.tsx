import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const submit = vi.fn();
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ profile: { email: 'me@example.com' }, loading: false }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/feedback', async (orig) => {
  const real: any = await orig();
  return { ...real, submitFeedback: (...a: unknown[]) => submit(...a), canCaptureScreen: () => false };
});

// Radix checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

import FeedbackDialog from './FeedbackDialog';

const renderDialog = (signedIn = true) =>
  render(<MemoryRouter initialEntries={['/client/tickets?token=abc']}><FeedbackDialog open onOpenChange={() => {}} signedIn={signedIn} /></MemoryRouter>);

describe('FeedbackDialog', () => {
  beforeEach(() => { submit.mockReset(); submit.mockResolvedValue({ ok: true, screenshotsFailed: 0 }); });

  it('is a labelled dialog with radio chips, the safety warning and the transparency panel', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Bug', 'Improvement idea', 'Question', 'Compliment']);
    expect(screen.getByText(/Do not include passwords, bank details or confidential client data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What we attach' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Short title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
  });

  it('shows severity chips only for bugs', () => {
    renderDialog();
    expect(screen.queryByRole('radiogroup', { name: 'How bad is it?' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Bug' }));
    expect(screen.getByRole('radiogroup', { name: 'How bad is it?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Blocks me' })).toBeInTheDocument();
  });

  it('keeps the spam trap away from people and screen readers', () => {
    const { container } = renderDialog();
    const trap = container.ownerDocument.getElementById('fb-website')!;
    expect(trap.getAttribute('tabindex')).toBe('-1');
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('does not send an incomplete report and explains why', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Choose what it is about.')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('sends a valid report with the cleaned page path, consent on and the prefilled e-mail for signed-in users', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Bug' }));
    fireEvent.change(screen.getByLabelText(/Short title/), { target: { value: 'Save fails' } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Pressing save does nothing at all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const arg = submit.mock.calls[0][0];
    expect(arg.type).toBe('bug');
    expect(arg.consentContact).toBe(true);
    expect(arg.contactEmail).toBe('me@example.com');
    expect(arg.context.path).toBe('/client/tickets');
    expect(arg.website).toBe('');
    expect(await screen.findByText('Thank you — we received it')).toBeInTheDocument();
  });

  it('visitors start with contact switched off', () => {
    renderDialog(false);
    expect(screen.getByRole('checkbox', { name: 'You may contact me about this' })).toHaveAttribute('aria-checked', 'false');
  });
});
