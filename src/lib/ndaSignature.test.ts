import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  base64ToBytes, idProblems, maskedIdOk, maskIdNumber, nameProblems, ndaView, nextReminderAllowedAt, normaliseIdNumber, pngInfo,
  signatureProblems, signFormProblems, strokeMetrics, type NdaStatus, type Stroke,
} from '../../supabase/functions/_shared/ndaSignature';
import { decryptIdNumber, encryptIdNumber } from '../../supabase/functions/_shared/ndaIdCrypto';
import { renderNdaEmail } from '../../supabase/functions/_shared/ndaEmail';
import { buildNdaPdf, partyRows, type NdaPdfInput } from '@/lib/nda/pdf';

// a real 120 x 50 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAyCAYAAACXpx/YAAABoElEQVR4nO2bMRLCMAwEE95BzaN4II+i5h+hYiZAkrEdSzqdbxsahrG1OUUmMC/LMgleLtELELZIMDkSTM5Qgq+3+7J+HYF5hCFrT+jr+Zi91+INveCStDKLphVc24ZZJVMKLmnJW+9hlEwluPZeO8K9mUbwGVnMaU4vuFcKWdOcVvDRENUqhVFySsHWIphadirBngljSXOaryq9C147eaMCn2CEJGVu2dCCEeQirqUGSMHIxcyWZijBFkcfC5AvwF9gBGcq2jTlWW+44CyF2gO9ZYcKzi73A/I+QgQjF6QV1D25C0YtRC/QWrabYHaxa5D2ai44y9HHAoQ0mwpGupKjiK6BieDoTaERWY/ugiV3n4iW3U2wxJbhXacuz4Mltxzv58ynEiyx5/Bo2U2CRz769MY6JNWClVobrNJcLFhi7bGocdGQJbk+WAxghwmW2Dh6texdwZIbTw8Hf4IlFouzPjYT/PuhkhtPa8s+bNESi0VLmsN/dCfqqUmzBCelNM1p/nwmvik9MyvBBKylKsGEfKRupVoJJkcJJkeCyXkDCRqo2BXLOJ0AAAAASUVORK5CYII=';

const line = (x0: number, x1: number, y0: number, y1: number, n = 40): Stroke =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1) }));

describe('signature pad rules', () => {
  it('rejects an empty pad', () => {
    expect(signatureProblems(strokeMetrics([]))).toEqual(['signature_empty']);
  });
  it('rejects a dot', () => {
    const p = signatureProblems(strokeMetrics([[{ x: 100, y: 100 }]]));
    expect(p).toContain('signature_too_short');
    expect(p).toContain('signature_too_small');
  });
  it('rejects a tiny scribble and a flat line', () => {
    expect(signatureProblems(strokeMetrics([line(100, 140, 100, 108)]))).toContain('signature_too_small');
    expect(signatureProblems(strokeMetrics([line(50, 400, 120, 120)]))).toEqual(['signature_too_small']);
  });
  it('accepts a real signature', () => {
    const m = strokeMetrics([line(40, 300, 150, 60), line(300, 520, 60, 160)]);
    expect(m.length).toBeGreaterThan(150);
    expect(signatureProblems(m)).toEqual([]);
  });
  it('keeps points inside the pad', () => {
    const m = strokeMetrics([[{ x: -50, y: -10 }, { x: 900, y: 500 }]]);
    expect(m.width).toBe(600);
    expect(m.height).toBe(200);
  });
});

describe('full legal name', () => {
  it('needs at least two words of letters', () => {
    expect(nameProblems('')).toEqual(['name_required']);
    expect(nameProblems('Karim')).toEqual(['name_two_words']);
    expect(nameProblems('Karim 2 Hassan')).toEqual(['name_letters_only']);
  });
  it('accepts Arabic, accents, hyphens and apostrophes', () => {
    expect(nameProblems('مُحَمَّد بن سلمان')).toEqual([]);
    expect(nameProblems('Ana María López')).toEqual([]);
    expect(nameProblems("Jean-Luc O'Neil")).toEqual([]);
  });
});

describe('ID document', () => {
  it('passport: 6-12 letters/digits', () => {
    expect(idProblems('passport', 'EG', 'A1234')).toEqual(['id_length']);
    expect(idProblems('passport', 'EG', 'A12345')).toEqual([]);
    expect(idProblems('passport', 'DE', 'C01X00T47')).toEqual([]);
    expect(idProblems('passport', 'EG', 'A123456789012')).toEqual(['id_length']);
    expect(idProblems('passport', 'EG', 'AB#12345')).toEqual(['id_format']);
  });
  it('national ID: 5-20, digits or alphanumerics', () => {
    expect(idProblems('national_id', 'SA', '1234')).toEqual(['id_length']);
    expect(idProblems('national_id', 'SA', '12345')).toEqual([]);
    expect(idProblems('national_id', 'ES', '12345678Z')).toEqual([]);
    expect(idProblems('national_id', 'SA', '1'.repeat(21))).toEqual(['id_length']);
    expect(idProblems('national_id', 'SA', '111111')).toEqual(['id_repeated']);
    expect(idProblems('national_id', 'SA', 'ABCDEF')).toEqual(['id_needs_digit']);
  });
  it('type and country are required; Israel is not offered', () => {
    expect(idProblems('', 'EG', 'A12345')).toEqual(['id_type_required']);
    expect(idProblems('passport', '', 'A12345')).toEqual(['id_country_required']);
    expect(idProblems('passport', 'IL', 'A12345')).toEqual(['id_country_invalid']);
  });
  it('normalises spaces, hyphens and Arabic-Indic digits', () => {
    expect(normaliseIdNumber(' ab-12 34.5 ')).toBe('AB12345');
    expect(normaliseIdNumber('١٢٣٤٥٦٧')).toBe('1234567');
  });
});

describe('masking', () => {
  it('shows first 2 + last 3 and never the whole number', () => {
    expect(maskIdNumber('A12345789')).toBe('A1****789');
    expect(maskIdNumber('1012345321')).toBe('10*****321');
    expect(maskIdNumber('A12345')).toBe('A***45');
    expect(maskIdNumber('12345')).toBe('1***5');
    for (const v of ['12345', 'A12345', 'A1234567', '12345678901234567890']) {
      expect(maskIdNumber(v)).not.toBe(v);
      expect(maskIdNumber(v)).toHaveLength(v.length);
    }
  });
  it('masked shape check matches the database rule', () => {
    expect(maskedIdOk('passport', 'A1****789')).toBe(true);
    expect(maskedIdOk('national_id', '1***5')).toBe(true);
    expect(maskedIdOk('passport', 'A12345789')).toBe(false);
    expect(maskedIdOk('passport', '1***5')).toBe(false);
  });
});

describe('the whole form', () => {
  const base = {
    party: 'consultant' as const, method: 'draw' as const, metrics: strokeMetrics([line(40, 300, 150, 60), line(300, 520, 60, 160)]),
    allowTyped: false, name: 'Karim Hassan', idType: 'passport' as const, idCountry: 'EG', idNumber: 'A12345789', authorised: true, agreed: true,
  };
  it('is ready only when every item is valid', () => {
    expect(signFormProblems(base)).toEqual([]);
    expect(signFormProblems({ ...base, authorised: false })).toEqual(['not_authorised']);
    expect(signFormProblems({ ...base, agreed: false })).toEqual(['not_agreed']);
    expect(signFormProblems({ ...base, metrics: null })).toEqual(['signature_empty']);
  });
  it('a client also needs job title and company, without contact details', () => {
    expect(signFormProblems({ ...base, party: 'client' })).toEqual(['title_required', 'company_required']);
    expect(signFormProblems({ ...base, party: 'client', jobTitle: 'Call +966 55 123 4567', companyName: 'Acme Trading' })).toEqual(['title_contact']);
    expect(signFormProblems({ ...base, party: 'client', jobTitle: 'IT Director', companyName: 'Acme Trading' })).toEqual([]);
  });
  it('typed signature only when the admin setting is on (default off)', () => {
    expect(signFormProblems({ ...base, method: 'typed', typedSignature: 'Karim Hassan' })).toEqual(['typed_not_allowed']);
    expect(signFormProblems({ ...base, method: 'typed', typedSignature: 'Karim Hassan', allowTyped: true })).toEqual([]);
  });
});

describe('PNG check', () => {
  it('accepts a real PNG and reads its size', () => {
    expect(pngInfo(base64ToBytes(PNG))).toEqual({ ok: true, width: 120, height: 50 });
  });
  it('rejects SVG, other types and truncated files', () => {
    const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(200)}</svg>`);
    expect(pngInfo(svg).ok).toBe(false);
    expect(pngInfo(base64ToBytes(PNG).slice(0, 200)).ok).toBe(false);
  });
});

const status = (over: Partial<NdaStatus>): NdaStatus => ({
  available: true, nda_id: 'n1', consultant_id: 'c1', client_id: 'u1', revoked_at: null, document_hash: 'h', my_party: 'consultant',
  consultant: { signed_at: null, legacy: false, evidence: null }, client: { signed_at: null, legacy: false, evidence: null },
  last_reminder_at: null, reminder_hours: 24, ...over,
});

describe('NDA box state', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  it('legacy NDAs (no ID collected) still count as fully signed', () => {
    const v = ndaView(status({ consultant: { signed_at: '2026-01-01T00:00:00Z', legacy: true, evidence: null }, client: { signed_at: '2026-01-02T00:00:00Z', legacy: true, evidence: null } }), now);
    expect(v.kind).toBe('fully_signed');
    expect(v.legacy).toEqual(['consultant', 'client']);
    expect(v.canAddDetails).toBe(true);
  });
  it('signer waits for the other party; reminder once per 24 h', () => {
    const signed = { consultant: { signed_at: '2026-10-25T08:00:00Z', legacy: false, evidence: null } };
    expect(ndaView(status(signed), now)).toMatchObject({ kind: 'waiting_other', other: 'client', canRemind: true, mySignedAt: '2026-10-25T08:00:00Z' });
    const recent = ndaView(status({ ...signed, last_reminder_at: '2026-10-25T00:00:00Z' }), now);
    expect(recent.canRemind).toBe(false);
    expect(recent.nextReminderAt).toBe('2026-10-26T00:00:00.000Z');
    expect(ndaView(status({ ...signed, last_reminder_at: '2026-10-24T11:00:00Z' }), now).canRemind).toBe(true);
  });
  it('the client must sign after the consultant; before that the client waits and may remind', () => {
    expect(ndaView(status({ my_party: 'client', consultant: { signed_at: '2026-10-25T08:00:00Z', legacy: false, evidence: null } }), now).kind).toBe('sign');
    expect(ndaView(status({ my_party: 'client', nda_id: null }), now)).toMatchObject({ kind: 'waiting_other', other: 'consultant', canRemind: true });
  });
  it('revoked NDAs show as revoked', () => {
    expect(ndaView(status({ revoked_at: '2026-10-20T00:00:00Z', consultant: { signed_at: '2026-10-01T00:00:00Z', legacy: false, evidence: null } }), now).kind).toBe('revoked');
  });
  it('a reminder window is never shorter than 24 hours', () => {
    expect(nextReminderAllowedAt('2026-10-25T00:00:00Z', 1)).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('ID encryption', () => {
  const key = 'k'.repeat(48);
  it('round-trips for the signer only', async () => {
    const c = await encryptIdNumber('A12345789', key, 'user-1');
    expect(c).toMatch(/^v1\.[0-9a-f]{8}\./);
    expect(c).not.toContain('A12345789');
    expect(await decryptIdNumber(c, key, 'user-1')).toBe('A12345789');
    await expect(decryptIdNumber(c, key, 'user-2')).rejects.toThrow();
    await expect(decryptIdNumber(c, 'x'.repeat(48), 'user-1')).rejects.toThrow('id_key_mismatch');
  });
  it('refuses a short or missing key', async () => {
    await expect(encryptIdNumber('A12345789', 'short', 'user-1')).rejects.toThrow('id_key_missing');
  });
});

describe('signed NDA PDF', () => {
  const ev = {
    signature_id: 's1', kind: 'signature' as const, method: 'draw' as const, signer_name: 'Karim Hassan', job_title: null, company_name: null,
    id_type: 'passport' as const, id_country: 'EG', id_masked: 'A1****789', document_hash: 'd'.repeat(64), image_sha256: 'e'.repeat(64),
    signed_at: '2026-10-25T08:00:00Z', captured_at: '2026-10-25T08:00:00Z',
  };
  const input: NdaPdfInput = {
    ndaId: 'nda-1', content: 'Non-Disclosure Agreement\n1. Confidential information ...', consultantName: 'K. H****', clientName: 'Acme Trading',
    consultant: { signedAt: ev.signed_at, image: `data:image/png;base64,${PNG}`, typed: null, name: 'Karim Hassan', evidence: ev, legacy: false },
    client: { signedAt: '2026-01-02T00:00:00Z', image: null, typed: 'Omar Fathy', name: 'Omar Fathy', company: 'Acme Trading', evidence: null, legacy: true },
    documentHash: 'd'.repeat(64),
  };
  it('signature block rows carry the masked ID only and mark legacy signatures', () => {
    const rows = partyRows(input.consultant, 'consultant', 'en').map(([, v]) => v).join(' | ');
    expect(rows).toContain('Passport · EG · A1****789');
    expect(rows).not.toContain('A12345789');
    expect(partyRows(input.client, 'client', 'en').map(([, v]) => v)).toContain('Signed (legacy signature, no ID collected)');
  });
  it('draws the signature image, the masked ID and the footer on every page', () => {
    const font = (f: string) => readFileSync(resolve(__dirname, `../../public/fonts/brd/${f}`)).toString('base64');
    const texts: string[] = [];
    let images = 0;
    // jsPDF returns its own API object from the constructor, so the spy wraps the methods of each new document
    function Spy(this: unknown, opts: unknown) {
      const d = new jsPDF(opts as never) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const text = d.text.bind(d), addImage = d.addImage.bind(d);
      d.text = (...a: unknown[]) => { texts.push(String(Array.isArray(a[0]) ? (a[0] as string[]).join(' ') : a[0])); return text(...a); };
      d.addImage = (...a: unknown[]) => { images++; return addImage(...a); };
      return d;
    }
    const doc = buildNdaPdf(Spy as never, input, 'en', { regular: font('IBMPlexSansArabic-Regular.ttf'), bold: font('IBMPlexSansArabic-Bold.ttf') });
    const all = texts.join(' ');
    expect(images).toBe(1);
    expect(all).toContain('A1****789');
    expect(all).not.toContain('A12345789');
    expect(all).toContain('Not');
    expect(all).toContain('qualified');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});

describe('NDA e-mails', () => {
  it('names the signer, links to the NDA page and escapes text', () => {
    const r = renderNdaEmail({ lang: 'en', kind: 'needs_signature', signer: '<b>M. S****</b>', path: '/client/contracts?nda=1' });
    expect(r.subject).toBe('<b>M. S****</b> signed the NDA, your signature is needed');
    expect(r.html).toContain('&lt;b&gt;M. S****&lt;/b&gt;');
    expect(r.text).toContain('https://www.aisupport360.com/client/contracts?nda=1');
    const ar = renderNdaEmail({ lang: 'ar', kind: 'reminder', signer: 'Acme', path: '//evil.example' });
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).not.toContain('evil.example');
  });
});
