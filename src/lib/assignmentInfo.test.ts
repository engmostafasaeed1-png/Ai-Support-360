import { describe, expect, it } from 'vitest';
import {
  ANSWER_MAX_TEXT, INFO_MAX_REQUESTS, clientInfoView, contactDetailsInText, infoCountsAsResponse, infoRequestBlock,
  maskContactDetails, normalizeDeclineReasons, remainingAtPause, resumeDeadline, sanitizePreview, validateInfoRequest,
} from '../../supabase/functions/_shared/assignmentInfo';
import { POLICY_DEFAULTS, clientRequestView, nextPopup, parseRunBody, policyText, popupKey } from '../../supabase/functions/_shared/assignmentPolicy';

const H = 3_600_000;

describe('decision preview hides locked data', () => {
  const raw = {
    request_id: 'r1',
    title: 'MM posting error',
    description: 'Call me on +966 55 123 4567 or mail ops@acme.com, see https://acme.com/x',
    sap_module: 'MM', sap_modules: ['MM', 'FI'], urgency: 'high', critical: false,
    industry: 'Retail', country: 'Saudi Arabia', planned_hours: '12', budget_max_rate: '80',
    attachments: [{ name: 'dump.txt', type: 'text/plain', size: 2048, file_url: 'ticket-documents/t1/u/dump.txt', url: 'https://x' }],
    // Anything the screen must never show, even if a later database change returned it:
    file_url: 'secret/path', credentials: 'sap*:pw', remote_access: 'anydesk 123', company_name: 'Acme Ltd', client_email: 'ceo@acme.com',
  };
  const p = sanitizePreview(raw)!;

  it('keeps only the allowed facts', () => {
    expect(p.title).toBe('MM posting error');
    expect(p.industry).toBe('Retail');
    expect(p.planned_hours).toBe(12);
    expect(p.budget_max_rate).toBe(80);
    const keys = Object.keys(p);
    for (const k of ['file_url', 'credentials', 'remote_access', 'company_name', 'client_email']) expect(keys).not.toContain(k);
  });

  it('masks contact details in the description', () => {
    expect(p.description).not.toMatch(/966|ops@acme|https:/);
    expect(p.description).toContain('[hidden]');
  });

  it('lists attachments by name, type and size only (no path or link)', () => {
    expect(p.attachments).toEqual([{ name: 'dump.txt', type: 'TXT', size: 2048 }]);
  });

  it('refuses a preview without request id', () => {
    expect(sanitizePreview({ title: 'x' })).toBeNull();
  });
});

describe('Request more information: form rules', () => {
  it('needs a topic or text', () => {
    expect(validateInfoRequest([], '  ')).toContain('empty');
    expect(validateInfoRequest(['scope'], '')).toEqual([]);
  });
  it('allows at most 3 topics and 500 characters', () => {
    expect(validateInfoRequest(['scope', 'system', 'error', 'access'], '')).toContain('too_many_topics');
    expect(validateInfoRequest([], 'a'.repeat(501))).toContain('too_long');
    expect(validateInfoRequest([], 'a'.repeat(500))).toEqual([]);
  });
  it('blocks contact details (contact-bypass filter)', () => {
    expect(validateInfoRequest([], 'write me on WhatsApp')).toContain('contact');
    expect(contactDetailsInText('mail me at a.b@c.com')).toBe(true);
    expect(maskContactDetails('see www.example.com')).toBe('see [hidden]');
  });
  it('one open question at a time, at most 3 per request', () => {
    expect(INFO_MAX_REQUESTS).toBe(3);
    expect(infoRequestBlock('pending', [])).toBeNull();
    expect(infoRequestBlock('pending', [{ status: 'open' }])).toBe('open');
    expect(infoRequestBlock('pending', [{ status: 'timed_out' }])).toBe('open');
    expect(infoRequestBlock('pending', [{ status: 'answered' }, { status: 'answered' }])).toBeNull();
    expect(infoRequestBlock('pending', [{ status: 'answered' }, { status: 'answered' }, { status: 'answered' }])).toBe('limit');
    expect(infoRequestBlock('accepted', [])).toBe('not_pending');
  });
  it('client answers have at most 1000 characters', () => {
    expect(ANSWER_MAX_TEXT).toBe(1000);
  });
});

describe('the reply clock pauses and resumes', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  it('keeps the time left at the moment of asking', () => {
    expect(remainingAtPause(now + 5 * H, now)).toBe(5 * H);
    expect(remainingAtPause(now - H, now)).toBe(0);
  });
  it('resumes with the time left, but at least 2 hours', () => {
    expect(resumeDeadline(5 * H, now)).toBe(now + 5 * H);
    expect(resumeDeadline(10 * 60_000, now)).toBe(now + 2 * H);
    expect(resumeDeadline(0, now)).toBe(now + 2 * H);
  });
  it('asking within the time limit counts as a response', () => {
    expect(infoCountsAsResponse(now, now + H)).toBe(true);
    expect(infoCountsAsResponse(now + 2 * H, now + H)).toBe(false);
  });
  it('a paused request does not pop up, and pops up again after the client answers', () => {
    const base = { id: 'r1', status: 'pending', created_at: new Date(now).toISOString(), response_due_at: new Date(now + H).toISOString(), reminders_sent: 0 };
    const paused = { ...base, info_paused_at: new Date(now).toISOString() };
    expect(nextPopup([paused], new Set())).toBeNull();
    const ackedBefore = new Set([popupKey(base)]);
    const resumed = { ...base, info_resumed_at: new Date(now + 3 * H).toISOString() };
    expect(nextPopup([resumed], ackedBefore)?.id).toBe('r1');
  });
  it('the client sees the request as paused, not waiting', () => {
    expect(clientRequestView({ status: 'pending', response_due_at: new Date(now + H).toISOString(), info_paused_at: new Date(now).toISOString() }, false).kind).toBe('paused');
  });
  it('an unanswered question becomes "Waiting for your answer" after the platform time (default 24 h)', () => {
    expect(POLICY_DEFAULTS.info_wait).toBe(1440);
    const asked = now;
    const due = new Date(asked + 24 * H).toISOString();
    expect(clientInfoView({ status: 'open', client_due_at: due }, asked + 23 * H).kind).toBe('awaiting');
    expect(clientInfoView({ status: 'open', client_due_at: due }, asked + 25 * H).kind).toBe('overdue');
    expect(clientInfoView({ status: 'timed_out', client_due_at: due }, asked + H).kind).toBe('overdue');
    expect(clientInfoView({ status: 'answered', client_due_at: due }, asked + 25 * H).kind).toBe('answered');
  });
});

describe('decline reasons and policy text', () => {
  it('keeps known reasons only, once, in a fixed order', () => {
    expect(normalizeDeclineReasons(['timing', 'bogus', 'not_my_module', 'timing'])).toEqual(['not_my_module', 'timing']);
  });
  it('policy text mentions information requests only when they are live', () => {
    expect(policyText(POLICY_DEFAULTS, 'en')).not.toMatch(/more information/);
    expect(policyText(POLICY_DEFAULTS, 'en', { info: true })).toMatch(/ask the client for more information: the clock pauses/);
    expect(policyText(POLICY_DEFAULTS, 'ar', { info: true })).toMatch(/معلومات إضافية/);
  });
  it('the e-mail callback accepts a well-formed info id only', () => {
    expect(parseRunBody({ info_id: '1b2c3d4e-0000-4000-8000-000000000001' })).toEqual({ requestId: null, infoId: '1b2c3d4e-0000-4000-8000-000000000001' });
    expect(parseRunBody({ info_id: 'drop table' })).toEqual({ requestId: null, infoId: null });
  });
});
