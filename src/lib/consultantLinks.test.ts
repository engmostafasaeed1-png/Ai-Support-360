import { describe, it, expect } from 'vitest';
import { credlyProfileUrl, linkState, normalizeCredlyUsername, normalizeLinkedinUrl } from './consultantLinks';

describe('normalizeLinkedinUrl', () => {
  it('keeps a clean profile address', () => {
    expect(normalizeLinkedinUrl('https://www.linkedin.com/in/jane-doe')).toBe('https://www.linkedin.com/in/jane-doe');
  });

  it('cleans an address without https, with a closing slash, with a country part, with a tracking part or with a page below the profile', () => {
    expect(normalizeLinkedinUrl('linkedin.com/in/jane-doe-123/')).toBe('https://www.linkedin.com/in/jane-doe-123');
    expect(normalizeLinkedinUrl('http://eg.linkedin.com/in/jane-doe?utm_source=x#top')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(normalizeLinkedinUrl('https://www.linkedin.com/in/jane-doe/details/experience/')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(normalizeLinkedinUrl('  https://m.linkedin.com/in/jane-doe  ')).toBe('https://www.linkedin.com/in/jane-doe');
  });

  it('accepts capitals in the host and keeps them in the name', () => {
    expect(normalizeLinkedinUrl('LinkedIn.com/in/Jane-Doe')).toBe('https://www.linkedin.com/in/Jane-Doe');
  });

  it('refuses everything that is not the profile of a person on linkedin.com', () => {
    for (const bad of [
      'https://evil.example.com/in/jane-doe',
      'https://linkedin.com.evil.example/in/jane-doe',
      'https://evil.example/linkedin.com/in/jane-doe',
      'javascript:alert(1)',
      'https://www.linkedin.com/company/acme',
      'https://www.linkedin.com/in/ab',
      'https://user@linkedin.com/in/jane-doe',
      'my linkedin profile',
      '',
      '   ',
    ]) {
      expect(normalizeLinkedinUrl(bad)).toBeNull();
    }
    expect(normalizeLinkedinUrl(null)).toBeNull();
    expect(normalizeLinkedinUrl(undefined)).toBeNull();
  });
});

describe('normalizeCredlyUsername', () => {
  it('keeps a user name', () => {
    expect(normalizeCredlyUsername('jane-doe.1a2b3c4d')).toBe('jane-doe.1a2b3c4d');
  });

  it('takes the name out of the address of a profile', () => {
    expect(normalizeCredlyUsername('https://www.credly.com/users/jane-doe.1a2b3c4d/badges')).toBe('jane-doe.1a2b3c4d');
    expect(normalizeCredlyUsername('credly.com/users/abc')).toBe('abc');
  });

  it('refuses a space, another website, a path and a tag', () => {
    for (const bad of ['jane doe', 'https://evil.example/users/jane', '../../etc/passwd', '<script>', '', '   ']) {
      expect(normalizeCredlyUsername(bad)).toBeNull();
    }
    expect(normalizeCredlyUsername(null)).toBeNull();
  });
});

describe('credlyProfileUrl', () => {
  it('builds the address of the profile from a valid name only', () => {
    expect(credlyProfileUrl('jane-doe.1a2b3c4d')).toBe('https://www.credly.com/users/jane-doe.1a2b3c4d');
    expect(credlyProfileUrl('https://www.credly.com/users/abc/badges')).toBe('https://www.credly.com/users/abc');
    expect(credlyProfileUrl('a b')).toBeNull();
    expect(credlyProfileUrl(null)).toBeNull();
  });
});

describe('linkState', () => {
  it('tells no link, a link given and a link checked', () => {
    expect(linkState(null, null)).toBe('none');
    expect(linkState('', '2026-10-04T10:00:00Z')).toBe('none');
    expect(linkState('https://www.linkedin.com/in/jane-doe', null)).toBe('linked');
    expect(linkState('https://www.linkedin.com/in/jane-doe', '2026-10-04T10:00:00Z')).toBe('checked');
  });
});
