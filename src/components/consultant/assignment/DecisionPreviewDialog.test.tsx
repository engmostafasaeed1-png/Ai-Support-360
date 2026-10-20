import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ data: null as any }));
vi.mock('@/hooks/useAssignmentInfo', async () => {
  const m = await import('../../../../supabase/functions/_shared/assignmentInfo');
  return { useDecisionPreview: () => ({ data: h.data ? m.sanitizePreview(h.data) : undefined, isLoading: false, isError: false }) };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (_k: string, fallback: string, values: Record<string, unknown> = {}) => fallback.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(values[n] ?? '')),
  }),
}));

import DecisionPreviewDialog from './DecisionPreviewDialog';

afterEach(() => { cleanup(); h.data = null; });

describe('DecisionPreviewDialog', () => {
  it('shows the decision facts and the attachment list, but no file link, contact data or company name', () => {
    h.data = {
      request_id: 'r1', title: 'FI period close', description: 'Mail me at boss@acme.com. Close fails in 0FI_GL.',
      sap_module: 'FI', sap_modules: ['FI'], urgency: 'high', industry: 'Retail', country: 'Egypt', planned_hours: 8,
      attachments: [{ name: 'error.png', type: 'image/png', size: 4096, file_url: 'ticket-documents/t1/u1/error.png' }],
      company_name: 'Acme Ltd', credentials: 'SAP*:secret',
    };
    render(<DecisionPreviewDialog requestId="r1" onClose={() => {}} />);
    expect(screen.getByText('FI period close')).toBeTruthy();
    expect(screen.getByText(/Close fails in 0FI_GL/)).toBeTruthy();
    expect(screen.getByText('Retail')).toBeTruthy();
    expect(screen.getByText('Egypt')).toBeTruthy();
    expect(screen.getByText('error.png')).toBeTruthy();
    expect(screen.getByText(/Locked until you are engaged/)).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('a[href]')).toBeNull();
    expect(dialog.textContent).not.toMatch(/boss@acme|Acme Ltd|secret|ticket-documents/);
  });
});
