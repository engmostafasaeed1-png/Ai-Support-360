import { describe, it, expect, beforeEach } from 'vitest';
import { canonicalOAuthUrl, oauthRedirectUri, friendlyOAuthMessage, STATE_FAILED_MESSAGE, storeOAuthRole, readStoredOAuthRole, OAUTH_ROLE_TTL_MS, providerProfile } from './oauthReturn';

describe('social sign-in start', () => {
  beforeEach(() => localStorage.clear());

  it('moves apex, old domain and published host to the www address, dropping query and hash', () => {
    expect(canonicalOAuthUrl('https://aisupport360.com/signup?ref=x#a')).toBe('https://www.aisupport360.com/signup');
    expect(canonicalOAuthUrl('https://aisapsupportnow.com/login')).toBe('https://www.aisupport360.com/login');
    expect(canonicalOAuthUrl('https://www.aisapsupportnow.com/login')).toBe('https://www.aisupport360.com/login');
    expect(canonicalOAuthUrl('https://ai-support-360.lovable.app/login')).toBe('https://www.aisupport360.com/login');
  });

  it('leaves the www address, editor previews and local development alone', () => {
    expect(canonicalOAuthUrl('https://www.aisupport360.com/login')).toBeNull();
    expect(canonicalOAuthUrl('https://id-preview--abc.lovable.app/login')).toBeNull();
    expect(canonicalOAuthUrl('http://localhost:8080/login')).toBeNull();
  });

  it('returns to a clean public path', () => {
    expect(oauthRedirectUri('https://www.aisupport360.com')).toBe('https://www.aisupport360.com/login');
  });

  it('keeps the chosen account type for 10 minutes only', () => {
    const t0 = 1_000_000;
    storeOAuthRole('consultant', t0);
    expect(readStoredOAuthRole(t0 + OAUTH_ROLE_TTL_MS - 1)).toBe('consultant');
    expect(readStoredOAuthRole(t0 + OAUTH_ROLE_TTL_MS + 1)).toBeNull();
  });

  it('shows the friendly message for state verification failure', () => {
    expect(friendlyOAuthMessage({ error: 'invalid_request', description: 'Authorization failed - State verification failed' })).toBe(STATE_FAILED_MESSAGE);
    expect(STATE_FAILED_MESSAGE).toMatch(/allow cookies/);
  });

  it('takes name and https photo from the provider only', () => {
    expect(providerProfile({ user_metadata: { full_name: 'Sara A', avatar_url: 'https://x/p.png' } })).toEqual({ name: 'Sara A', avatar: 'https://x/p.png' });
    expect(providerProfile({ user_metadata: { picture: 'javascript:alert(1)' } }).avatar).toBeNull();
  });
});
