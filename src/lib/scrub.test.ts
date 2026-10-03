import { describe, it, expect } from 'vitest';
import {
  scrubText,
  scrubAll,
  denyTermsFromNames,
  denyTermsFromEmails,
} from '../../supabase/functions/_shared/scrub.ts';

describe('scrubText', () => {
  it('removes e-mail addresses', () => {
    const r = scrubText('Please write to john.smith@acme-industrial.com today');
    expect(r.text).toBe('Please write to [email] today');
    expect(r.flags).toEqual(['email']);
  });

  it('removes links and host names', () => {
    const r = scrubText('Open https://acme.sharepoint.com/sites/fi?id=1 or www.acme.com/login and try s4prd.corp.acme.com');
    expect(r.text).toBe('Open [link] or [link] and try [host]');
    expect(r.flags).toEqual(['host', 'link']);
  });

  it('removes IP addresses and ids', () => {
    const r = scrubText('Server 10.20.30.40 and ticket 123e4567-e89b-12d3-a456-426614174000');
    expect(r.text).toBe('Server [ip] and ticket [id]');
    expect(r.flags).toEqual(['id', 'ip']);
  });

  it('removes phone numbers but not dates, times or short numbers', () => {
    const r = scrubText('Call +20 100 123 4567 or (011) 555-1234. On 2026-10-03 at 12:30 use FB60, error 4711.');
    expect(r.text).toBe('Call [phone] or [phone]. On 2026-10-03 at 12:30 use FB60, error 4711.');
    expect(r.flags).toEqual(['phone']);
  });

  it('removes long document numbers but keeps SAP note references', () => {
    const r = scrubText('PO 4500123456 and invoice 90001234. See SAP Note 2270407 and KBA 3012345.');
    expect(r.text).toBe('PO [number] and invoice [number]. See SAP Note 2270407 and KBA 3012345.');
    expect(r.flags).toEqual(['number']);
  });

  it('removes customer objects but keeps standard names', () => {
    const r = scrubText('Program ZFI_VENDOR_REPORT, report ZFI01, but standard FBL1N, MIRO, /IWFND/MAINT_SERVICE and ZERO stay');
    expect(r.text).toBe('Program [custom object], report [custom object], but standard FBL1N, MIRO, /IWFND/MAINT_SERVICE and ZERO stay');
    expect(r.flags).toEqual(['custom_object']);
  });

  it('leaves a clean text exactly as it is', () => {
    const clean = 'Open the posting period in OB52 for account type K, then post the invoice again with MIRO.';
    const r = scrubText(clean);
    expect(r.text).toBe(clean);
    expect(r.flags).toEqual([]);
  });

  it('is safe for empty input', () => {
    expect(scrubText('')).toEqual({ text: '', flags: [] });
    expect(scrubText(null).text).toBe('');
    expect(scrubText(undefined).flags).toEqual([]);
  });
});

describe('names to remove', () => {
  it('removes a company name in full and by its distinctive word, whatever the capitals', () => {
    const deny = denyTermsFromNames(['Acme Industrial Holdings Ltd'], '[company]');
    const r = scrubText('We are ACME Industrial Holdings Ltd. Acme runs SAP in two plants.', deny);
    expect(r.text).toBe('We are [company]. [company] runs SAP in two plants.');
    expect(r.flags).toEqual(['name']);
  });

  it('does not touch words that only contain the name', () => {
    const deny = denyTermsFromNames(['Acme'], '[company]');
    expect(scrubText('Acmeology is a word, Acme is not', deny).text).toBe('Acmeology is a word, [company] is not');
  });

  it('keeps words that many company names share', () => {
    const terms = denyTermsFromNames(['Global Trading Group'], '[company]').map(t => t.term.toLowerCase());
    expect(terms).toContain('global trading group');
    expect(terms).not.toContain('global');
    expect(terms).not.toContain('trading');
    expect(terms).not.toContain('group');
  });

  it('removes a person by first and last name', () => {
    const deny = denyTermsFromNames(['Mostafa Saeed'], '[person]', 3);
    expect(scrubText('Thanks Mostafa, Saeed will call', deny).text).toBe('Thanks [person], [person] will call');
  });

  it('works for Arabic names', () => {
    const deny = denyTermsFromNames(['شركة النور للتجارة'], '[company]');
    expect(scrubText('تواصلنا مع النور اليوم', deny).text).toBe('تواصلنا مع [company] اليوم');
  });

  it('builds terms from e-mail addresses (people before the @, company from the domain)', () => {
    const deny = denyTermsFromEmails(['john.smith@acme-industrial.com']);
    const r = scrubText('John and Smith from Acme', deny);
    expect(r.text).toBe('[person] and [person] from [company]');
  });

  it('ignores terms shorter than three characters', () => {
    expect(denyTermsFromNames(['Al'], '[person]')).toEqual([]);
  });
});

describe('scrubAll and idempotence', () => {
  it('scrubs several texts and returns the union of the flags', () => {
    const r = scrubAll(['mail a@b.com', 'call 4500123456', null], []);
    expect(r.values).toEqual(['mail [email]', 'call [number]', '']);
    expect(r.flags).toEqual(['email', 'number']);
  });

  it('gives the same result when it runs twice', () => {
    const deny = denyTermsFromNames(['Acme Industrial Holdings'], '[company]');
    const text = 'Acme (a@acme.com, +20 100 123 4567, 10.1.1.1) uses ZFI_X_REPORT for PO 4500123456 on https://acme.com/x and host s4.acme.com.';
    const once = scrubText(text, deny).text;
    expect(scrubText(once, deny).text).toBe(once);
  });
});
