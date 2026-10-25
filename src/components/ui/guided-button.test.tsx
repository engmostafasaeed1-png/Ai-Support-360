import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Button } from './button';

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.use(initReactI18next).init({ lng: 'en', resources: {} });
  await i18n.changeLanguage('en');
});

describe('Button with a blocked reason', () => {
  it('is aria-disabled (not natively disabled), keeps focus and explains itself to screen readers', () => {
    render(<Button reason="no_consultant_assigned">Schedule Meeting</Button>);
    const btn = screen.getByRole('button', { name: 'Schedule Meeting' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAccessibleDescription('A consultant must be assigned first.');
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('tap shows the popover and never runs the action or submits the form', async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <MemoryRouter>
        <form onSubmit={onSubmit}>
          <Button type="submit" onClick={onClick} reason={{ key: 'nda_not_signed_by_you', to: '/consultant/ndas' }}>Start work</Button>
        </form>
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: 'Start work' });
    fireEvent.pointerDown(btn, { pointerType: 'touch' });
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    const pop = await screen.findByTestId('blocked-popover');
    expect(pop).toHaveTextContent('You must sign the NDA first.');
    const link = screen.getByTestId('blocked-next-step');
    expect(link).toHaveTextContent('Sign the NDA');
    expect(link).toHaveAttribute('href', '/consultant/ndas');
  });

  it('keyboard focus opens the explanation; Escape closes it', async () => {
    render(<Button reason="rate_not_approved">Submit timesheet</Button>);
    const btn = screen.getByRole('button', { name: 'Submit timesheet' });
    act(() => btn.focus());
    expect(await screen.findByTestId('blocked-popover')).toHaveTextContent('The hourly rate must be approved first.');
    fireEvent.keyDown(btn, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByTestId('blocked-popover')).toBeNull());
  });

  it('several reasons: shows the first and "N more steps"', async () => {
    render(<Button reason={[false, 'nda_not_signed_by_you', 'rate_not_approved', 'sla_not_accepted']} progress={{ done: 1, total: 4 }}>Accept</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    const pop = await screen.findByTestId('blocked-popover');
    expect(pop).toHaveTextContent('You must sign the NDA first.');
    expect(pop).toHaveTextContent('2 more steps');
    expect(pop).toHaveTextContent('1 of 4 steps done');
  });

  it('runs the next-step action from the popover', async () => {
    const sign = vi.fn();
    render(<Button reason={{ key: 'nda_not_signed_by_you', onNext: sign }}>Accept</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(await screen.findByTestId('blocked-next-step'));
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('inline hint variant shows the reason under the button', () => {
    render(<Button hint="inline" reason="no_consultant_assigned">Schedule Meeting</Button>);
    expect(screen.getByTestId('blocked-hint')).toHaveTextContent('A consultant must be assigned first.');
    expect(screen.getByRole('button', { name: 'Schedule Meeting' })).toHaveAccessibleDescription(/A consultant must be assigned first/);
  });

  it('unblocked: runs the action and keeps the same element (focus is not lost)', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button reason="fill_required_fields" onClick={onClick}>Save</Button>);
    const before = screen.getByRole('button', { name: 'Save' });
    before.focus();
    rerender(<Button reason={false} onClick={onClick}>Save</Button>);
    const after = screen.getByRole('button', { name: 'Save' });
    expect(after).toBe(before);
    expect(after).toHaveFocus();
    expect(after).not.toHaveAttribute('aria-disabled');
    fireEvent.click(after);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('busy: natively disabled, aria-busy and a spoken "Please wait…"', () => {
    render(<Button busy>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveTextContent('Please wait…');
  });

  it('Arabic: reason in Arabic and the panel is right-to-left', async () => {
    await i18n.changeLanguage('ar');
    render(<Button reason="no_consultant_assigned">جدولة اجتماع</Button>);
    fireEvent.click(screen.getByRole('button'));
    const pop = await screen.findByTestId('blocked-popover');
    expect(pop).toHaveAttribute('dir', 'rtl');
    expect(pop).toHaveTextContent('يجب تعيين مستشار أولًا.');
  });
});
