import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const inserted = vi.fn();
const updated = vi.fn();
let jobs: unknown[] = [];

vi.mock('@/hooks/useProfileAutosaveReady', () => ({ useProfileAutosaveReady: () => ({ data: false }) }));
vi.mock('./saving/ProfileImportance', () => ({ useProfileSavePrompt: () => undefined }));
vi.mock('./CvImportDialog', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table: string) => {
      if (table === 'consultants') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'c1' } }) }) }) };
      if (table === 'consultant_private') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) };
      return {
        select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: jobs }) }) }) }),
        insert: (row: unknown) => { inserted(row); return { select: () => ({ single: () => Promise.resolve({ data: { id: 'j-new' }, error: null }) }) }; },
        update: (patch: unknown) => { updated(patch); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; },
      };
    },
  },
}));

import ExperienceCvCard from './ExperienceCvCard';

const dialogInputs = () => within(screen.getByRole('dialog')).getAllByRole('textbox') as HTMLInputElement[];

describe('ExperienceCvCard dialog', () => {
  beforeEach(() => { inserted.mockClear(); updated.mockClear(); jobs = []; vi.restoreAllMocks(); });

  it('lets the consultant discard a half-filled new entry with Close', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ExperienceCvCard />);
    await screen.findByText(/No experience added yet/);
    fireEvent.click(screen.getByRole('button', { name: /Add experience/ }));
    fireEvent.change(dialogInputs()[1], { target: { value: 'Acme' } }); // company only
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(inserted).not.toHaveBeenCalled();
  });

  it('offers a Discard changes button that closes without saving', async () => {
    render(<ExperienceCvCard />);
    await screen.findByText(/No experience added yet/);
    fireEvent.click(screen.getByRole('button', { name: /Add experience/ }));
    fireEvent.change(dialogInputs()[1], { target: { value: 'Acme' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(inserted).not.toHaveBeenCalled();
  });

  it('sends null, not an empty string, when a saved date is cleared', async () => {
    jobs = [{ id: 'j1', company_name: 'Acme', job_title: 'SAP Consultant', start_date: '2020-01-01', end_date: null, is_current: true, description: '' }];
    render(<ExperienceCvCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit experience' }));
    const start = screen.getByRole('dialog').querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ start_date: null }));
  });
});
