import { describe, it, expect } from 'vitest';
import {
  MAX_CERT_BYTES,
  STATE_LABELS,
  STATUS_FILTERS,
  VERIFICATION_STATES,
  certificateDocumentPath,
  certificateFileKind,
  certificateFileProblem,
  countByStatus,
  countForFilter,
  decisionOptions,
  isVerificationState,
  safeHttpUrl,
} from './consultantReview';

describe('verification states', () => {
  it('knows the six states of the database and nothing else', () => {
    for (const state of VERIFICATION_STATES) expect(isVerificationState(state)).toBe(true);
    expect(VERIFICATION_STATES).toHaveLength(6);
    expect(isVerificationState('approved')).toBe(false);
    expect(isVerificationState(null)).toBe(false);
    expect(isVerificationState(3)).toBe(false);
  });

  it('has a name for every state', () => {
    for (const state of VERIFICATION_STATES) expect(STATE_LABELS[state].length).toBeGreaterThan(0);
  });

  it('shows every state in exactly one group of the approvals page', () => {
    for (const state of VERIFICATION_STATES) {
      expect(STATUS_FILTERS.filter(f => f.statuses.includes(state))).toHaveLength(1);
    }
  });
});

describe('decisionOptions', () => {
  const targets = (status: (typeof VERIFICATION_STATES)[number]) => decisionOptions(status).map(o => o.to);

  it('lets an administrator start, hold, reject or approve a new application', () => {
    expect(targets('pending')).toEqual(['under_review', 'on_hold', 'rejected', 'verified']);
    expect(targets('under_review')).toEqual(['on_hold', 'rejected', 'verified']);
    expect(targets('on_hold')).toEqual(['under_review', 'rejected', 'verified']);
  });

  it('lets an administrator hold or suspend a verified consultant, and bring a suspended or rejected one back', () => {
    expect(targets('verified')).toEqual(['on_hold', 'suspended']);
    expect(targets('suspended')).toEqual(['under_review', 'verified']);
    expect(targets('rejected')).toEqual(['under_review']);
  });

  it('never offers the status that the consultant already has', () => {
    for (const state of VERIFICATION_STATES) expect(targets(state).includes(state)).toBe(false);
  });

  it('puts the approval last and marks reject and suspend as dangerous', () => {
    const pending = decisionOptions('pending');
    expect(pending[pending.length - 1].to).toBe('verified');
    expect(pending[pending.length - 1].tone).toBe('primary');
    expect(decisionOptions('pending').filter(o => o.to === 'rejected')[0].tone).toBe('danger');
    expect(decisionOptions('verified').filter(o => o.to === 'suspended')[0].tone).toBe('danger');
  });

  it('gives every decision the words for its box and for the message afterwards', () => {
    for (const state of VERIFICATION_STATES) {
      for (const option of decisionOptions(state)) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.title.length).toBeGreaterThan(0);
        expect(option.placeholder.length).toBeGreaterThan(0);
        expect(option.done.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('countByStatus and countForFilter', () => {
  const rows = [
    { verification_status: 'pending' },
    { verification_status: 'pending' },
    { verification_status: 'under_review' },
    { verification_status: 'verified' },
    { verification_status: 'suspended' },
    { verification_status: null },
    { verification_status: 'something else' },
  ];

  it('counts every status and ignores what it does not know', () => {
    expect(countByStatus(rows)).toEqual({ pending: 2, under_review: 1, on_hold: 0, verified: 1, rejected: 0, suspended: 1 });
    expect(countByStatus([])).toEqual({ pending: 0, under_review: 0, on_hold: 0, verified: 0, rejected: 0, suspended: 0 });
  });

  it('adds the states of a group', () => {
    const counts = countByStatus(rows);
    expect(countForFilter(counts, STATUS_FILTERS[0])).toBe(3);
    expect(countForFilter(counts, STATUS_FILTERS[2])).toBe(1);
    expect(countForFilter(counts, STATUS_FILTERS[3])).toBe(0);
  });
});

describe('safeHttpUrl', () => {
  it('keeps http and https addresses', () => {
    expect(safeHttpUrl('https://github.com/jane')).toBe('https://github.com/jane');
    expect(safeHttpUrl('  http://example.com/a?b=1 ')).toBe('http://example.com/a?b=1');
  });

  it('refuses everything else', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'ftp://example.com', 'example.com', '', '   ', 'not a url']) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe('certificateFileProblem', () => {
  it('accepts a PDF, a JPG and a PNG of normal size', () => {
    for (const name of ['cert.pdf', 'cert.JPG', 'scan.jpeg', 'badge.png']) {
      expect(certificateFileProblem({ name, size: 1000 })).toBeNull();
    }
  });

  it('refuses other kinds of file, an empty file and a file over 10 MB', () => {
    expect(certificateFileProblem({ name: 'page.html', size: 1000 })).toBe('Choose a PDF, JPG or PNG file.');
    expect(certificateFileProblem({ name: 'noextension', size: 1000 })).toBe('Choose a PDF, JPG or PNG file.');
    expect(certificateFileProblem({ name: 'cert.pdf', size: 0 })).toBe('The file is empty.');
    expect(certificateFileProblem({ name: 'cert.pdf', size: MAX_CERT_BYTES + 1 })).toBe('The file is larger than 10 MB.');
    expect(certificateFileProblem({ name: 'cert.pdf', size: MAX_CERT_BYTES })).toBeNull();
  });
});

describe('certificateDocumentPath', () => {
  it('keeps a path of the bucket', () => {
    expect(certificateDocumentPath('u1/certifications/1700000000000-cert.pdf')).toBe('u1/certifications/1700000000000-cert.pdf');
    expect(certificateDocumentPath('/u1/certifications/cert.pdf')).toBe('u1/certifications/cert.pdf');
  });

  it('takes the path out of an older address of a file in the bucket', () => {
    expect(certificateDocumentPath('https://abc.supabase.co/storage/v1/object/public/consultant-documents/u1/certifications/my%20cert.pdf?token=x')).toBe('u1/certifications/my cert.pdf');
  });

  it('gives null for nothing, for another website and for another bucket', () => {
    expect(certificateDocumentPath(null)).toBeNull();
    expect(certificateDocumentPath('  ')).toBeNull();
    expect(certificateDocumentPath('https://evil.example.com/cert.pdf')).toBeNull();
    expect(certificateDocumentPath('https://abc.supabase.co/storage/v1/object/public/avatars/u1/me.png')).toBeNull();
  });
});

describe('certificateFileKind', () => {
  it('tells a PDF, an image and anything else', () => {
    expect(certificateFileKind('u1/a.PDF')).toBe('pdf');
    expect(certificateFileKind('u1/a.png')).toBe('image');
    expect(certificateFileKind('u1/a.jpeg')).toBe('image');
    expect(certificateFileKind('u1/a.html')).toBe('other');
    expect(certificateFileKind(null)).toBe('other');
  });
});
