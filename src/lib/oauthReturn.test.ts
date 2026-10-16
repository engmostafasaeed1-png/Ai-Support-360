import { describe, it, expect, beforeEach } from 'vitest';
import { readOAuthError, isFirstTimeOAuthUser, newUserDestination, readStoredOAuthRole, storeOAuthRole } from './oauthReturn';

const now = Date.parse('2026-10-16T21:00:00Z');

describe('oauthReturn', () => {
  beforeEach(() => sessionStorage.clear());

  it('reads error params from the query or the hash', () => {
    expect(readOAuthError('?error=invalid_request&error_description=State+verification+failed', '')).toEqual({
      error: 'invalid_request',
      description: 'State verification failed',
    });
    expect(readOAuthError('', '#error=access_denied')?.error).toBe('access_denied');
    expect(readOAuthError('?next=/client', '')).toBeNull();
  });

  it('treats a new Google account without a role as first-time', () => {
    const user = { created_at: '2026-10-16T20:50:00Z', app_metadata: { provider: 'google' }, user_metadata: {} };
    expect(isFirstTimeOAuthUser(user, now)).toBe(true);
  });

  it('does not ask email sign-ups, older accounts or accounts with a role', () => {
    expect(isFirstTimeOAuthUser({ created_at: '2026-10-16T20:50:00Z', app_metadata: { provider: 'email' } }, now)).toBe(false);
    expect(isFirstTimeOAuthUser({ created_at: '2026-10-16T19:00:00Z', app_metadata: { provider: 'google' } }, now)).toBe(false);
    expect(isFirstTimeOAuthUser({ created_at: '2026-10-16T20:50:00Z', app_metadata: { provider: 'google' }, user_metadata: { role: 'client' } }, now)).toBe(false);
  });

  it('sends new clients to companies and new consultants to profile setup', () => {
    expect(newUserDestination('client')).toBe('/client/companies');
    expect(newUserDestination('consultant')).toBe('/consultant/profile?section=setup');
  });

  it('stores and reads the chosen role', () => {
    storeOAuthRole('consultant');
    expect(readStoredOAuthRole()).toBe('consultant');
    storeOAuthRole(null);
    expect(readStoredOAuthRole()).toBeNull();
  });
});
