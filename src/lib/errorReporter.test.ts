import { describe, expect, it } from 'vitest';
import { isCrawlerUserAgent, isIgnoredHost, isIgnoredMessage } from '@/lib/errorReporter';

describe('error report noise filters', () => {
  it('ignores the editor preview and developer machines but not the live site', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      '2b30b1db-ed1c-4d7b-8706-596c66fe5232.lovableproject.com',
      'id-preview--2b30b1db-ed1c-4d7b-8706-596c66fe5232.lovable.app',
    ]) {
      expect(isIgnoredHost(host), host).toBe(true);
    }
    for (const host of ['www.aisupport360.com', 'aisupport360.com', 'my-project.lovable.app']) {
      expect(isIgnoredHost(host), host).toBe(false);
    }
  });

  it('ignores search-engine crawlers and headless test browsers but not people', () => {
    for (const agent of [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/153.0.8010.36 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.52 Mobile Safari/537.36 (compatible; GoogleOther)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0 (compatible; meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36',
    ]) {
      expect(isCrawlerUserAgent(agent), agent).toBe(true);
    }
    for (const agent of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; CUBOT KingKong) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    ]) {
      expect(isCrawlerUserAgent(agent), agent).toBe(false);
    }
  });

  it('ignores browser and library noise but keeps real errors', () => {
    for (const message of [
      "Lock broken by another request with the 'steal' option.",
      'Lock "lock:sb-abcdefghijklmnopqrst-auth-token" was released because another request stole it',
      // Navigator LockManager races in the sign-in library: two requests refresh the session at once, the losing one reports and then recovers.
      'Lock was stolen by another request',
      "Lock broken by another request with the 'steal' option",
      'Acquiring an exclusive Navigator LockManager lock failed',
      'A Navigator LockManager lock was taken elsewhere',
      'lockmanager lock busy, retrying',
      'ResizeObserver loop completed with undelivered notifications.',
      'Script error.',
      '[diag:csp] CSP violation: connect-src blocked wss://localhost:8080/?token=[redacted]',
      '[diag:csp] CSP violation: script-src-elem blocked https://gc.kis.v2.scr.kaspersky-labs.com/x.js',
    ]) {
      expect(isIgnoredMessage(message), message).toBe(true);
    }
    for (const message of [
      "Cannot read properties of undefined (reading 'default')",
      '[diag:csp] CSP violation: script-src-elem blocked https://cdn.example.com/x.js',
      'Query failed: relation "public.nothing" does not exist',
      'TypeError: Cannot read properties of null (reading "toFixed")',
    ]) {
      expect(isIgnoredMessage(message), message).toBe(false);
    }
  });
});
