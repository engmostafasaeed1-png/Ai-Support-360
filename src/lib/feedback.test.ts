import { describe, expect, it } from 'vitest';
import {
  activeEntityFromPath, browserFamily, cleanFeedbackText, cleanPath, csvCell, FEEDBACK_LIMITS, feedbackErrorKey,
  feedbackTaskMarkdown, isFeedbackHiddenRoute, maskSecrets, osFamily, scrubErrorMessage, sniffImageType, validateFeedback,
} from '../../supabase/functions/_shared/feedback';
import { routeName } from './feedback';

describe('feedback validation', () => {
  const ok = { type: 'bug' as const, severity: 'blocks' as const, title: 'Save fails', description: 'Pressing save does nothing at all' };

  it('accepts a complete report', () => {
    expect(validateFeedback(ok)).toEqual({});
  });

  it('requires a type, a title and a 10–2000 character description', () => {
    expect(validateFeedback({ ...ok, type: '' }).type).toBe('required');
    expect(validateFeedback({ ...ok, title: '  ' }).title).toBe('required');
    expect(validateFeedback({ ...ok, title: 'ab' }).title).toBe('too_short');
    expect(validateFeedback({ ...ok, description: 'too short' }).description).toBe('too_short');
    expect(validateFeedback({ ...ok, description: 'x'.repeat(10) })).toEqual({});
    expect(validateFeedback({ ...ok, description: 'x'.repeat(2000) })).toEqual({});
    expect(validateFeedback({ ...ok, description: 'x'.repeat(2001) }).description).toBe('too_long');
  });

  it('counts text without HTML tags', () => {
    expect(validateFeedback({ ...ok, description: '<b><i></i></b>abc' }).description).toBe('too_short');
  });

  it('allows an empty contact e-mail but rejects a malformed one', () => {
    expect(validateFeedback({ ...ok, contactEmail: '' })).toEqual({});
    expect(validateFeedback({ ...ok, contactEmail: 'me@example.com' })).toEqual({});
    expect(validateFeedback({ ...ok, contactEmail: 'not-an-email' }).contactEmail).toBe('invalid');
  });

  it('limits are 3 images of 5 MB, 5 per hour per user and 3 per hour per visitor', () => {
    expect(FEEDBACK_LIMITS.files).toBe(3);
    expect(FEEDBACK_LIMITS.fileBytes).toBe(5 * 1024 * 1024);
    expect(FEEDBACK_LIMITS.userPerHour).toBe(5);
    expect(FEEDBACK_LIMITS.visitorPerHour).toBe(3);
  });
});

describe('masking (same rules as the database)', () => {
  it('hides card numbers and long tokens but keeps normal text, phone numbers and contact details', () => {
    const out = maskSecrets('Card 4111 1111 1111 1111, token abcdefghijklmnopqrstuvwxyz0123456789ABCD, call +20 100 123 4567, mail a@b.co');
    expect(out).not.toContain('4111');
    expect(out).not.toContain('abcdefghijklmnop');
    expect(out).toContain('[hidden number]');
    expect(out).toContain('[hidden]');
    expect(out).toContain('+20 100 123 4567');
    expect(out).toContain('a@b.co');
  });

  it('strips tags before storing', () => {
    expect(cleanFeedbackText('  <script>x</script><b>Save</b> fails ')).toBe('xSave fails');
  });
});

describe('attached context', () => {
  it('drops the query string and hash, and hides token-like path parts but keeps ids', () => {
    expect(cleanPath('/client/tickets?token=secret#top')).toBe('/client/tickets');
    expect(cleanPath('/interview/respond/abcdefghijklmnopqrstuvwxyz1234')).toBe('/interview/respond/:token');
    const id = '6f1c2b8e-4c1d-4a8e-9f00-1234567890ab';
    expect(cleanPath(`/client/tickets/${id}`)).toBe(`/client/tickets/${id}`);
  });

  it('finds the ticket or request on screen from the path only', () => {
    const id = '6f1c2b8e-4c1d-4a8e-9f00-1234567890ab';
    expect(activeEntityFromPath(`/client/tickets/${id}?x=1`)).toEqual({ kind: 'ticket', id });
    expect(activeEntityFromPath('/client/dashboard')).toBeNull();
  });

  it('names the route with ids replaced', () => {
    expect(routeName('/client/tickets/6f1c2b8e-4c1d-4a8e-9f00-1234567890ab')).toBe('/client/tickets/:id');
  });

  it('scrubs error messages (no e-mails or tokens, one short line)', () => {
    const m = scrubErrorMessage('Failed for jane@corp.com\n with key abcdefghijklmnopqrstuvwxyz0123456789ABCD ' + 'x '.repeat(200));
    expect(m).not.toContain('jane@corp.com');
    expect(m).not.toContain('\n');
    expect(m.length).toBeLessThanOrEqual(200);
  });

  it('reports browser and system families only', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
    expect(browserFamily(ua)).toBe('Edge');
    expect(osFamily(ua)).toBe('Windows');
    expect(osFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iOS');
  });
});

describe('screenshots', () => {
  it('accepts only real PNG, JPEG and WebP files by their first bytes', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // PDF
  });
});

describe('where the button shows', () => {
  it('is hidden on the meeting hand-off, sign-in consent, printed invoices and live interview', () => {
    expect(isFeedbackHiddenRoute('/join/abc')).toBe(true);
    expect(isFeedbackHiddenRoute('/.lovable/oauth/consent')).toBe(true);
    expect(isFeedbackHiddenRoute('/invoice/123')).toBe(true);
    expect(isFeedbackHiddenRoute('/interview/live/123')).toBe(true);
  });

  it('shows on public pages, sign-in and every portal', () => {
    for (const p of ['/', '/login', '/signup', '/client/dashboard', '/consultant/profile', '/admin/users', '/super-admin', '/client/invoices']) {
      expect(isFeedbackHiddenRoute(p)).toBe(false);
    }
  });
});

describe('admin helpers', () => {
  it('maps server codes to friendly messages', () => {
    expect(feedbackErrorKey('rate_limited')).toBe('rate_limited');
    expect(feedbackErrorKey('feedback_disabled')).toBe('disabled');
    expect(feedbackErrorKey('invalid_title')).toBe('invalid');
    expect(feedbackErrorKey('boom')).toBe('generic');
  });

  it('task Markdown carries page, browser and errors but no contact details', () => {
    const md = feedbackTaskMarkdown({
      id: 'r1', type: 'bug', severity: 'blocks', title: 'Save fails', description: 'Nothing happens',
      route: '/client/tickets', context: { browser: 'Chrome', os: 'Windows', errors: ['TypeError: x'] },
      ...({ contact_email: 'jane@corp.com' } as object),
    } as any);
    expect(md).toContain('## Save fails');
    expect(md).toContain('`/client/tickets`');
    expect(md).toContain('- TypeError: x');
    expect(md).not.toContain('jane@corp.com');
  });

  it('CSV cells cannot start a spreadsheet formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('plain')).toBe('plain');
  });
});
