import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OnboardingGuidePanel, OnboardingGuideAccordion, OnboardingWelcome, OnboardingFinish, FieldHint } from './OnboardingGuidePanel';
import { totalGuideMinutes } from '@/lib/consultantGuide';

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(() => cleanup());

describe('OnboardingGuidePanel', () => {
  it('shows the desktop guide for the profile step', () => {
    render(<OnboardingGuidePanel stepIndex={1} strength={40} />);
    expect(screen.getByText('Step 2 of 9 · about 4 min')).toBeTruthy();
    expect(screen.getByText('Why this matters')).toBeTruthy();
    expect(screen.getByText('Your headline, bio and rate are the first things a client reads before choosing you.')).toBeTruthy();
    expect(screen.getByText('What clients see')).toBeTruthy();
    expect(screen.getByText('Common mistakes')).toBeTruthy();
    expect(screen.getByText('Leaving the rate at 0')).toBeTruthy();
    expect(screen.getAllByText('Profile strength 40%').length).toBeGreaterThan(0);
  });

  it('mobile accordion is collapsed by default and remembers its state per step', () => {
    const { unmount } = render(<OnboardingGuideAccordion stepIndex={2} />);
    const trigger = screen.getByRole('button', { name: /Need help with this step\?/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    unmount();
    render(<OnboardingGuideAccordion stepIndex={2} />);
    expect(screen.getByRole('button', { name: /Need help with this step\?/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('welcome screen starts and skips', () => {
    const onStart = vi.fn(); const onSkip = vi.fn();
    render(<OnboardingWelcome onStart={onStart} onSkip={onSkip} />);
    expect(screen.getByText("Welcome. Let's set up your consultant profile")).toBeTruthy();
    expect(screen.getByText(`About ${totalGuideMinutes()} minutes. You can stop at any time and continue later.`)).toBeTruthy();
    expect(screen.getByText('Get paid within 15 business days')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onStart).toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalled();
  });

  it('finish screen lists the next steps and opens the tour', () => {
    const onTour = vi.fn();
    render(<OnboardingFinish onTour={onTour} />);
    expect(screen.getByText('Your profile is ready')).toBeTruthy();
    expect(screen.getByText('Take the 2-minute portal tour')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    expect(onTour).toHaveBeenCalled();
  });

  it('field hint has an accessible label', () => {
    render(<FieldHint field="hourlyRate" />);
    expect(screen.getByRole('button', { name: 'Why we ask: Clients approve your rate before any work starts.' })).toBeTruthy();
  });
});
