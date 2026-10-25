import { describe, expect, it } from 'vitest';
import {
  agreementLabel, confirmationState, contactProblems, crewProblems, docSizeOk, docTypeOk, draftChecklist, normalizeSaSettings, REFERENCE_RE,
  SA_DEFAULT_SETTINGS, secretOk, type CrewEntry, type SaTerms,
} from '../../supabase/functions/_shared/supportAgreements';
import { emptyTerms } from '@/lib/agreements/model';

const s = SA_DEFAULT_SETTINGS;
const e = (id: string, o: Partial<CrewEntry> = {}): CrewEntry => ({ consultant_id: id, role: 'functional', ...o });

describe('agreement name and reference', () => {
  it('reference format is SA-<year>-<6 digits> and shows next to the name', () => {
    expect(REFERENCE_RE.test('SA-2026-000012')).toBe(true);
    expect(REFERENCE_RE.test('SA-26-12')).toBe(false);
    expect(agreementLabel({ name: 'FI support', reference: 'SA-2026-000012' })).toBe('FI support (SA-2026-000012)');
  });
});

describe('crew rules', () => {
  it('crew size limit: lead + 5 members by default (6 in total)', () => {
    expect(s.crew_max).toBe(6);
    expect(crewProblems(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => e(x)), null, s)).toContain('crew_size');
    expect(crewProblems(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => e(x)), null, s)).not.toContain('crew_size');
  });
  it('only the selected lead may have the lead role; no duplicates', () => {
    expect(crewProblems([e('a', { role: 'lead' })], null, s)).toContain('crew_role');
    expect(crewProblems([e('a', { role: 'lead' }), e('b')], 'a', s)).toEqual([]);
    expect(crewProblems([e('a'), e('a')], null, s)).toContain('crew_duplicate');
  });
  it('capacity 0-60 h/week, working hours HH:MM and days 1-7, backup covers another member', () => {
    expect(crewProblems([e('a', { capacity_hours_per_week: 61 })], null, s)).toContain('crew_capacity');
    expect(crewProblems([e('a', { working_hours: { from: '8:00' } })], null, s)).toContain('crew_hours');
    expect(crewProblems([e('a', { working_hours: { days: [0] } })], null, s)).toContain('crew_hours');
    expect(crewProblems([e('a', { backup_for: 'a' })], null, s)).toContain('crew_backup');
    expect(crewProblems([e('a'), e('b', { role: 'backup', backup_for: 'a' })], null, s)).toEqual([]);
  });
});

describe('team confirmation (nobody works and the agreement SLA does not start before it)', () => {
  const base = { agreed: true, nda_required: true, admin_review: 'not_needed', start_date: '2026-11-01' };
  const lead = { consultant_id: 'k', role: 'lead', required: true, status: 'active', sla_accepted_at: '2026-10-20', nda_ok: true };
  it('waits for every required member to accept place + SLA, and for their NDA', () => {
    const invited = { consultant_id: 'u', role: 'functional', required: true, status: 'invited', sla_accepted_at: null, nda_ok: false };
    expect(confirmationState({ ...base, members: [lead, invited] }, '2026-11-02').ready).toBe(false);
    const accepted = { ...invited, status: 'active', sla_accepted_at: '2026-10-25' };
    expect(confirmationState({ ...base, members: [lead, accepted] }, '2026-11-02')).toMatchObject({ ready: false, items: { crew: true, nda: false } });
    expect(confirmationState({ ...base, members: [lead, { ...accepted, nda_ok: true }] }, '2026-11-02').ready).toBe(true);
  });
  it('a declined required member blocks; an optional one does not', () => {
    const declined = { consultant_id: 'u', role: 'backup', required: true, status: 'declined', sla_accepted_at: null, nda_ok: false };
    expect(confirmationState({ ...base, members: [lead, declined] }, '2026-11-02').items.crew).toBe(false);
    expect(confirmationState({ ...base, members: [lead, { ...declined, required: false }] }, '2026-11-02').ready).toBe(true);
  });
  it('also waits for the start date and the admin review', () => {
    expect(confirmationState({ ...base, members: [lead] }, '2026-10-31').ready).toBe(false);
    expect(confirmationState({ ...base, admin_review: 'pending', members: [lead] }, '2026-11-02').ready).toBe(false);
  });
});

describe('contacts, secrets and documents', () => {
  it('at most 5 statement recipients / escalation contacts, levels 1-3', () => {
    expect(s.contacts_max).toBe(5);
    expect(contactProblems({ statement_recipients: ['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co', 'e@x.co', 'f@x.co'] }, s)).toContain('recipients_max');
    expect(contactProblems({ escalation_contacts: [{ email: 'it@acme.com', level: 4 as 1 }] }, s)).toContain('escalation_level');
    expect(contactProblems({ escalation_contacts: [{ email: 'it@acme.com', level: 2 }] }, s)).toEqual([]);
  });
  it('passwords and access secrets are refused', () => {
    expect(secretOk('Access plan password: Winter2026')).toBe(false);
    expect(secretOk('API key = abc')).toBe(false);
    expect(secretOk('كلمة المرور: 1234')).toBe(false);
    expect(secretOk('-----BEGIN RSA PRIVATE KEY-----')).toBe(false);
    expect(secretOk('Bypass: use transaction FB60 for the posting')).toBe(true);
    expect(secretOk('Statement of work, version 2')).toBe(true);
  });
  it('allow-list PDF/DOCX/XLSX/images with matching type, up to 20 MB', () => {
    expect(docTypeOk('SOW.pdf', 'application/pdf')).toBe(true);
    expect(docTypeOk('plan.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(docTypeOk('SOW.pdf', 'image/png')).toBe(false);
    expect(docTypeOk('tool.exe', 'application/octet-stream')).toBe(false);
    expect(docTypeOk('old.doc', 'application/msword')).toBe(false);
    expect(docSizeOk(20 * 1048576, s)).toBe(true);
    expect(docSizeOk(20 * 1048576 + 1, s)).toBe(false);
  });
  it('settings keep the owner defaults: OFF, 1-month minimum term, prepayment off, portal fee = platform fee', () => {
    const n = normalizeSaSettings({});
    expect(n).toMatchObject({ enabled: false, min_term_months: 1, allow_prepayment: false, service_fee_percent: null, doc_max_mb: 20 });
  });
});

describe('agreement settings checklist', () => {
  const today = '2026-10-25';
  const filled = (): SaTerms => ({ ...emptyTerms('payg', '2026-11-10'), name: 'FI support', scope: { modules: ['FI'], versions: [], systems: [], covered: '', not_covered: '' } });
  it('a new draft is not ready: name and SAP areas are missing (basics)', () => {
    const c = draftChecklist(emptyTerms('payg', '2026-11-10'), s, today);
    expect(c.sections.basics).toBe('error');
    expect(c.canPublish).toBe(false);
  });
  it('rates, crew, escalation and documents are optional before applications', () => {
    const c = draftChecklist(filled(), s, today);
    expect(c.sections).toMatchObject({ rates: 'optional', crew: 'optional', escalation: 'optional', documents: 'optional', review: 'done' });
    expect(c.canPublish).toBe(true);
    expect(c.percent).toBe(100);
  });
  it('crew and contact problems show in their sections and block publishing', () => {
    const c = draftChecklist({ ...filled(), team: [e('a'), e('a')], statement_recipients: Array(6).fill('a@x.co') }, s, today);
    expect(c.sections.crew).toBe('error');
    expect(c.sections.reporting).toBe('error');
    expect(c.canPublish).toBe(false);
  });
  it('a target rate outside the bounds is flagged under Rates', () => {
    const t = filled();
    const c = draftChecklist({ ...t, rate: { ...t.rate, hourly_rate: 5000 } }, s, today);
    expect(c.sections.rates).toBe('error');
  });
});
