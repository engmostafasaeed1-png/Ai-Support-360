/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { render, screen, cleanup, waitFor, renderHook, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const REVOKED = ['linkedin_url', 'github_url', 'personal_website', 'profile_video_url', 'credly_username', 'cv_url', 'nationality'];

// A fake database: consultants never carries the links, only consultant_contact_links does; every select is written down.
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  selects: [] as Array<{ table: string; columns: string }>,
}));
vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string) => {
    const result = () => ({ data: db.tables[table] ?? null, error: null });
    const b: any = {};
    b.select = (columns: string) => { db.selects.push({ table, columns }); return b; };
    for (const m of ['in', 'order', 'eq', 'limit']) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(db.tables[table]) ? (db.tables[table] as any[])[0] ?? null : db.tables[table] ?? null, error: null });
    b.then = (ok: any, ko: any) => Promise.resolve(result()).then(ok, ko);
    return b;
  };
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'jane@example.com' } } }) }, from: (t: string) => chain(t) } };
});
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/data/adminMockData', () => ({ pendingConsultants: [] }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/consultant/ReinterviewDialog', () => ({ default: () => null }));
vi.mock('@/components/admin/ScheduleLiveInterviewDialog', () => ({ default: () => null }));
vi.mock('@/components/consultant/InterviewHistory', () => ({ default: () => null }));
vi.mock('@/components/admin/ConsultantVerificationAuditLog', () => ({ default: () => null }));

import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import ConsultantLinksCard from '@/components/consultant/ConsultantLinksCard';
import ConsultantApprovalsPage from '@/pages/admin/ConsultantApprovalsPage';

const LINKS = { consultant_id: 'c1', linkedin_url: 'https://www.linkedin.com/in/jane-doe', github_url: 'https://github.com/jane', personal_website: null, credly_username: 'jane-doe.1a2b3c4d' };

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function consultantSelectsAreSafe() {
  const own = db.selects.filter(s => s.table === 'consultants');
  expect(own.length).toBeGreaterThan(0);
  for (const s of own) {
    expect(s.columns).not.toContain('*');
    for (const c of REVOKED) expect(s.columns).not.toMatch(new RegExp(`\\b${c}\\b`));
  }
}

beforeEach(() => {
  db.selects.length = 0;
  db.tables = {
    consultants: [{ id: 'c1', user_id: 'u1', bio: 'SAP FI', hourly_rate: 100, verification_status: 'pending', created_at: '2026-10-01T10:00:00Z', city: 'Cairo', country: 'Egypt', linkedin_checked_at: null, credly_checked_at: null, consultant_skills: [], certifications: [] }],
    consultant_contact_links: [LINKS],
    profiles: [{ user_id: 'u1', display_name: 'Jane Doe' }],
  };
});
afterEach(() => cleanup());

describe('consultant contact links come from consultant_contact_links', () => {
  it('useConsultantProfile reads credly_username from the view', async () => {
    const { result } = renderHook(() => useConsultantProfile(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect((result.current.data as any).credly_username).toBe('jane-doe.1a2b3c4d');
    expect(db.selects.some(s => s.table === 'consultant_contact_links')).toBe(true);
    consultantSelectsAreSafe();
  });

  it('ConsultantLinksCard fills LinkedIn and Credly from the view', async () => {
    render(<ConsultantLinksCard />, { wrapper });
    const linkedin = (await screen.findByLabelText(/LinkedIn profile/)) as HTMLInputElement;
    await waitFor(() => expect(linkedin.value).toBe(LINKS.linkedin_url));
    expect((screen.getByLabelText(/Credly profile/) as HTMLInputElement).value).toBe(LINKS.credly_username);
    consultantSelectsAreSafe();
  });

  it('ConsultantApprovalsPage shows the LinkedIn link from the view', async () => {
    render(<ConsultantApprovalsPage />, { wrapper });
    fireEvent.click(await screen.findByText('Jane Doe'));
    expect(screen.getByLabelText('Open the LinkedIn page in a new tab').getAttribute('href')).toBe(LINKS.linkedin_url);
    consultantSelectsAreSafe();
  });

  it('no consultant-side or admin-side read of consultants selects * or a revoked column', () => {
    const files = [
      'src/hooks/useConsultantProfile.ts', 'src/components/profile/ProfileEditDialog.tsx', 'src/components/consultant/ConsultantLinksCard.tsx',
      'src/components/consultant/onboarding/ConsultantOnboarding.tsx', 'src/pages/consultant/VerificationPage.tsx', 'src/components/consultant/CredlyBadgesSection.tsx',
      'src/pages/admin/ConsultantApprovalsPage.tsx', 'src/api/consultants.ts', 'src/pages/consultant/ConsultantDashboard.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      const re = /from\('consultants'\)[\s\S]{0,400}?\.select\((['`])([\s\S]*?)\1/g;
      for (const m of src.matchAll(re)) {
        if (/from\('(?!consultants')/.test(src.slice(m.index!, m.index! + m[0].indexOf('.select(')).slice(20))) continue;
        expect(m[2], f).not.toMatch(/^\s*\*|,\s*\*/);
        for (const c of REVOKED) expect(m[2], `${f}: ${c}`).not.toMatch(new RegExp(`\\b${c}\\b`));
      }
    }
  });
});
