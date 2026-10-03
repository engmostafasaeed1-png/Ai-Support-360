import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ProfileStep from './ProfileStep';
import type { OnboardingData } from '../ConsultantOnboarding';

const BASE: OnboardingData = {
  displayName: 'Jane Doe',
  bio: 'SAP FI consultant',
  hourlyRate: 100,
  currency: 'USD',
  timezone: 'Africa/Cairo',
  languages: ['en'],
  nationality: 'Egyptian',
  city: '',
  country: '',
  linkedinUrl: '',
  githubUrl: '',
  personalWebsite: '',
  credlyUsername: '',
  skills: [],
  certifications: [],
  workHistory: [],
  education: [],
  projects: [],
  availability: [],
};

function show(partial: Partial<OnboardingData> = {}, onChange: (p: Partial<OnboardingData>) => void = () => {}) {
  render(<ProfileStep data={{ ...BASE, ...partial }} onChange={onChange} />);
}

afterEach(() => cleanup());

describe('ProfileStep (links and place)', () => {
  it('writes the Credly name that the consultant types', () => {
    const onChange = vi.fn();
    show({}, onChange);
    fireEvent.change(screen.getByLabelText('Credly username or profile address'), { target: { value: 'jane-doe' } });
    expect(onChange).toHaveBeenCalledWith({ credlyUsername: 'jane-doe' });
  });

  it('writes the LinkedIn address that the consultant types', () => {
    const onChange = vi.fn();
    show({}, onChange);
    fireEvent.change(screen.getByLabelText('LinkedIn profile address'), { target: { value: 'https://www.linkedin.com/in/jane-doe' } });
    expect(onChange).toHaveBeenCalledWith({ linkedinUrl: 'https://www.linkedin.com/in/jane-doe' });
  });

  it('shows no warning for empty fields or for good values', () => {
    show({ linkedinUrl: 'https://www.linkedin.com/in/jane-doe', credlyUsername: 'jane-doe.1a2b3c4d' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns about a LinkedIn address that is not the profile of a person', () => {
    show({ linkedinUrl: 'https://evil.example.com/in/jane' });
    expect(screen.getByRole('alert').textContent).toMatch(/LinkedIn profile/);
  });

  it('warns about a Credly name that has a space', () => {
    show({ credlyUsername: 'jane doe' });
    expect(screen.getByRole('alert').textContent).toMatch(/Credly/);
  });

  it('asks for the country before the city, then offers the city drop-down', () => {
    show();
    expect(screen.getByText('Select country first')).toBeTruthy();
    cleanup();
    show({ country: 'Egypt' });
    expect(screen.getByText('Select city')).toBeTruthy();
  });

  it('says that clients see the area of the city and never an address', () => {
    show();
    expect(document.body.textContent).toMatch(/never an address/);
  });
});
