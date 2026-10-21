import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatConsultantName, maskingFromSetting, publicConsultantName, type NameFormat } from './consultantName';
import { DEFAULT_FILTERS, passes, type DirectoryContext } from './directoryFilters';
import type { ConsultantLive } from './consultantDirectory';

// The same cases as docs/sql/consultant-name-privacy.test.sql, so the browser preview and the database agree.
const CASES: Array<[string, NameFormat, string]> = [
  ['Mostafa Saeed', 'masked', 'M. S****'],
  ['Mostafa Saeed', 'initial_family', 'M. Saeed'],
  ['Mostafa Saeed', 'initials', 'M.S.'],
  ['  Mostafa   Saeed ', 'full', 'Mostafa Saeed'],
  ['Dr. Mostafa Ahmed Saeed', 'masked', 'M. S****'],
  ['Mostafa', 'masked', 'M*****'],
  ['Ali', 'masked', 'A***'],
  ['Mostafa', 'initials', 'M.'],
  ['A B', 'masked', 'A. B***'],
  ['José Núñez', 'masked', 'J. N****'],
  ['José Núñez', 'initial_family', 'J. Núñez'],
  ['مصطفى سعيد', 'masked', 'م. س***'],
  ['مصطفى سعيد', 'initial_family', 'م. سعيد'],
  ['مصطفى سعيد', 'initials', 'م.س.'],
  ['م. مُصْطَفَى أحمد سعيد', 'masked', 'م. س***'],
  ['د. علي', 'masked', 'ع***'],
  ['Eng. Omar', 'masked', 'O***'],
  ['', 'masked', ''],
];

describe('name formats (English and Arabic)', () => {
  it.each(CASES)('%s as %s is %s', (name, format, expected) => {
    expect(formatConsultantName(name, format)).toBe(expected);
  });
  it('uses between 3 and 5 stars for the hidden letters', () => {
    expect(formatConsultantName('Mostafa Al', 'masked')).toBe('M. A***');
    expect(formatConsultantName('Mostafa Abdelrahman', 'masked')).toBe('M. A*****');
  });
  it('keeps Arabic right-to-left text as letters, dot and stars only', () => {
    expect(formatConsultantName('أحمد محمود', 'masked')).toBe('أ. م****');
  });
});

describe('who sees what', () => {
  it('shows the chosen format to viewers without access, masked when the format is unknown', () => {
    expect(publicConsultantName('Mostafa Saeed', 'initials')).toBe('M.S.');
    expect(publicConsultantName('Mostafa Saeed', undefined)).toBe('M. S****');
    expect(publicConsultantName('Mostafa Saeed', 'nonsense')).toBe('M. S****');
  });
  it('shows the full name to unlocked viewers (owner, admin, client with NDA) and when hiding is off', () => {
    expect(publicConsultantName('Mostafa Saeed', 'masked', { unlocked: true })).toBe('Mostafa Saeed');
    expect(publicConsultantName('Mostafa Saeed', 'masked', { maskingOn: false })).toBe('Mostafa Saeed');
  });
  it('treats the setting as on unless it is explicitly false', () => {
    expect(maskingFromSetting(undefined)).toBe(true);
    expect(maskingFromSetting(true)).toBe(true);
    expect(maskingFromSetting(false)).toBe(false);
  });
});

describe('directory search cannot find hidden parts of a name', () => {
  const person = (patch: Partial<ConsultantLive>): ConsultantLive => ({
    id: 'c', name: 'M. S****', specialty: 'SAP FI', skills: ['SAP FI'], rating: 4.5, reviews: 5, rate: 80, avatar: 'MS', available: true, status: 'available',
    badges: [], lat: null, lng: null, city: '', country: '', place: '', industries: [], linkedinVerified: false, credlyVerified: false,
    linkedin_state: 'none', credly_state: 'none', languages: ['en'], response_time_minutes: 30, verification_status: 'verified', completion_percent: 80, ...patch,
  } as ConsultantLive);
  const ctx: DirectoryContext = { founding: new Set(), viewerOffset: 0 };
  it('does not match the hidden family name, but matches skills', () => {
    const c = person({});
    expect(passes(c, { ...DEFAULT_FILTERS, q: 'Saeed' }, ctx)).toBe(false);
    expect(passes(c, { ...DEFAULT_FILTERS, q: 'Mostafa' }, ctx)).toBe(false);
    expect(passes(c, { ...DEFAULT_FILTERS, q: 'SAP FI' }, ctx)).toBe(true);
  });
});

describe('prepared SQL (docs/sql/consultant-name-privacy.sql)', () => {
  const sql = readFileSync(resolve(__dirname, '../../docs/sql/consultant-name-privacy.sql'), 'utf8');
  const body = (fn: string) => {
    const i = sql.indexOf(`FUNCTION public.${fn}(`);
    expect(i, fn).toBeGreaterThan(-1);
    return sql.slice(i, sql.indexOf('$function$;', i));
  };
  it('starts every consultant as masked and keeps hiding on by default', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS name_format text NOT NULL DEFAULT 'masked'/);
    expect(sql).toMatch(/CHECK \(name_format IN \('masked', 'initial_family', 'initials', 'full'\)\)/);
    expect(sql).toMatch(/'consultant_name_masking_enabled', 'true'::jsonb/);
  });
  it('routes the shared name directory through the viewer rule', () => {
    expect(sql).toMatch(/CASE WHEN c\.id IS NULL THEN p\.display_name ELSE public\.consultant_public_name\(c\.id\) END AS display_name/);
  });
  it('keeps the per-viewer helpers away from the browser', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.consultant_name_for\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.consultant_name_unlocked\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);
  });
  it.each(['notify_match_accepted', 'notify_nda_signed', 'notify_proposal_events', 'notify_session_lifecycle', 'notify_shared_remote_config_change',
    'set_environment_consultants', 'team_panel', 'team_thread', 'claim_assignment_info_emails'])('%s names consultants through consultant_name_for', (fn) => {
    const b = body(fn);
    expect(b).toContain('consultant_name_for(');
    expect(b).not.toMatch(/display_name INTO _(consultant_name|cons_name)\b/);
  });
  it('writes stored team notification texts in the public format, never unlocked', () => {
    expect(body('team_consultant_name')).toContain('consultant_name_for(_consultant_id, NULL)');
  });
  it('unlocks the full name only for ready/active teams or legacy assignments with an NDA signed by both', () => {
    const b = sql.slice(sql.indexOf('FUNCTION public.consultant_name_unlocked('), sql.indexOf('FUNCTION public.consultant_name_for('));
    expect(b).toContain("m.status IN ('ready', 'active')");
    expect(b).toContain("a.status::text = 'active'");
    expect(b).toContain('n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL');
    expect(b).toContain('n.revoked_at IS NULL');
  });
});
