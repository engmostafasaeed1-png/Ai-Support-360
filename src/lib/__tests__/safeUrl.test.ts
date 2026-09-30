import { describe, it, expect } from 'vitest';
import { hostIsOneOf, isSafeHttpsUrl, openExternal, openProtocolLink, parseHttpUrl, safeHref } from '../safeUrl';

describe('parseHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(parseHttpUrl('https://meet.google.com/abc-defg-hij')?.hostname).toBe('meet.google.com');
    expect(parseHttpUrl('http://localhost:8080/x')?.port).toBe('8080');
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull();
    expect(parseHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(parseHttpUrl('file:///etc/passwd')).toBeNull();
    expect(parseHttpUrl('not a url')).toBeNull();
    expect(parseHttpUrl('')).toBeNull();
    expect(parseHttpUrl(null)).toBeNull();
  });
});

describe('isSafeHttpsUrl', () => {
  it('requires https and no embedded credentials', () => {
    expect(isSafeHttpsUrl('https://example.com/a')).toBe(true);
    expect(isSafeHttpsUrl('http://example.com/a')).toBe(false);
    expect(isSafeHttpsUrl('https://user:pw@example.com/a')).toBe(false);
  });
});

describe('openExternal / openProtocolLink', () => {
  it('refuses dangerous schemes without touching window.open', () => {
    const original = window.open;
    let calls = 0;
    window.open = (() => {
      calls += 1;
      return null;
    }) as typeof window.open;
    try {
      expect(openExternal('javascript:alert(1)')).toBe(false);
      expect(openExternal('data:text/html,hi')).toBe(false);
      expect(openProtocolLink('teamviewer10://control?device=1', ['anydesk'])).toBe(false);
      expect(calls).toBe(0);
      expect(openExternal('https://example.com')).toBe(true);
      expect(openProtocolLink('anydesk:123456789', ['anydesk'])).toBe(true);
      expect(calls).toBe(2);
    } finally {
      window.open = original;
    }
  });
});

describe('safeHref', () => {
  it('passes http(s) URLs through and neutralises everything else', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(safeHref('/relative/path')).toBe('#');
    expect(safeHref(null, '/fallback')).toBe('/fallback');
  });
});

describe('hostIsOneOf', () => {
  it('matches the domain and its subdomains only', () => {
    const meet = ['meet.google.com', 'zoom.us'];
    expect(hostIsOneOf('https://meet.google.com/abc-defg-hij', meet)).toBe(true);
    expect(hostIsOneOf('https://us02web.zoom.us/j/123', meet)).toBe(true);
    expect(hostIsOneOf('https://evilzoom.us/j/123', meet)).toBe(false);
    expect(hostIsOneOf('https://zoom.us.evil.example/j/1', meet)).toBe(false);
    expect(hostIsOneOf('https://meet.google.com.evil.example/', meet)).toBe(false);
    expect(hostIsOneOf('javascript:alert(1)', meet)).toBe(false);
  });
});
