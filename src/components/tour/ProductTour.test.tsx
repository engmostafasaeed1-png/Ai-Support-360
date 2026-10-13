import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProductTour, { type TourStep } from './ProductTour';

const steps: TourStep[] = [
  { id: 'a', placement: 'center', title: 'First', body: 'First body' },
  { id: 'b', target: 'missing-target', title: 'Second', body: 'Second body' },
  { id: 'c', target: 'real', title: 'Third', body: 'Third body' },
];

const renderTour = (props: Partial<Parameters<typeof ProductTour>[0]> = {}) => {
  const onFinish = vi.fn(); const onSkip = vi.fn(); const onStep = vi.fn();
  render(
    <MemoryRouter>
      <button type="button">outside</button>
      <div data-tour="real" style={{ width: 100, height: 40 }}>target</div>
      <ProductTour steps={steps} open onFinish={onFinish} onSkip={onSkip} onStep={onStep} {...props} />
    </MemoryRouter>,
  );
  return { onFinish, onSkip, onStep };
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ProductTour', () => {
  it('renders the dialog card with the step and announces it', () => {
    renderTour();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Step 1 of 3: First');
  });

  it('falls back to a centered card when the target is missing', async () => {
    renderTour({ startAt: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('data-placement')).toMatch(/center|sheet/);
    expect(screen.queryByTestId('tour-cutout')).toBeNull();
  });

  it('cuts out a visible target', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, left: 10, width: 100, height: 40, right: 110, bottom: 50, x: 10, y: 10, toJSON: () => ({}) } as DOMRect);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    renderTour({ startAt: 2 });
    await waitFor(() => expect(screen.getByTestId('tour-cutout')).toBeTruthy());
  });

  it('Esc skips, arrows move, Finish on the last step', () => {
    const { onSkip, onStep, onFinish } = renderTour();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onStep).toHaveBeenLastCalledWith(1);
    expect(screen.getByText('Second')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByText('First')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalled();
  });

  it('moves focus into the card and traps Tab', () => {
    renderTour();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(document.activeElement).toBe(next);
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>('button:not([disabled])');
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
    focusables[0].focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("'Don't show again' skips", () => {
    const { onSkip } = renderTour();
    fireEvent.click(screen.getByRole('button', { name: "Don't show again" }));
    expect(onSkip).toHaveBeenCalled();
  });
});
