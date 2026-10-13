import { describe, expect, it } from 'vitest';
import { mergeLoaded } from './ConsultantOnboarding';

const base = {
  displayName: '', bio: '', hourlyRate: 0, currency: 'USD', timezone: 'Asia/Riyadh', languages: ['en'],
  nationality: '', city: '', country: '', linkedinUrl: '', githubUrl: '', personalWebsite: '', credlyUsername: '',
  skills: [], certifications: [], workHistory: [], education: [], projects: [], availability: [],
} as any;
const saved = { ...base, displayName: 'Saved Name', bio: 'Saved bio', city: 'Riyadh' };

describe('mergeLoaded', () => {
  it('first load fills everything', () => {
    expect(mergeLoaded(base, saved, new Set())).toEqual(saved);
  });
  it('keeps typed display name and bio after a reload', () => {
    const typed = { ...base, displayName: 'Typed', bio: 'Typed bio' };
    const out = mergeLoaded(typed, saved, new Set(['displayName', 'bio']));
    expect(out.displayName).toBe('Typed');
    expect(out.bio).toBe('Typed bio');
  });
  it('an untouched field gets the saved value after a reload', () => {
    const typed = { ...base, displayName: 'Typed' };
    expect(mergeLoaded(typed, saved, new Set(['displayName'])).city).toBe('Riyadh');
  });
  it('returns the same object when nothing changes', () => {
    expect(mergeLoaded(saved, { ...saved }, new Set())).toBe(saved);
  });
});
