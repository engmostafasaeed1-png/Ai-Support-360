import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const consultantsSelect = vi.fn();
const consultantsUpdate = vi.fn();
const skillsSelect = vi.fn();
let updateError: { message: string } | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table: string) => {
      if (table === 'consultants') {
        return {
          select: (cols: string) => {
            consultantsSelect(cols);
            return {
              eq: (_c: string, v: string) => ({
                maybeSingle: () => {
                  if (v === 'u1') return Promise.resolve({ data: { id: 'c1' } });
                  return Promise.resolve({
                    data: {
                      id: 'c1',
                      languages: ['en', 'ar'],
                      industries: ['Utilities'],
                      customer_segments: [],
                      vertical_solutions: [],
                      localization_countries: [],
                      localization_solutions: [],
                      project_types: [],
                      deployment_experience: [],
                      project_scale: null,
                      work_modes: [],
                      onsite_countries: [],
                      working_week: null,
                      language_levels: { en: 'Native' },
                      sap_roles: ['functional'],
                      seniority_level: 'senior',
                      total_sap_years: 8,
                      sap_technologies: ['ABAP'],
                    },
                  });
                },
              }),
            };
          },
          update: (payload: unknown) => {
            consultantsUpdate(payload);
            return { eq: () => Promise.resolve({ error: updateError }) };
          },
        };
      }
      if (table === 'consultant_skills') {
        return {
          select: (cols: string, opts: unknown) => {
            skillsSelect(cols, opts);
            return { eq: () => Promise.resolve({ count: 3 }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }));

import ProfileExperienceCard from './ProfileExperienceCard';

describe('ProfileExperienceCard', () => {
  beforeEach(() => {
    consultantsSelect.mockClear();
    consultantsUpdate.mockClear();
    skillsSelect.mockClear();
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it('loads with an explicit column list (no *) and shows saved selections', async () => {
    render(<ProfileExperienceCard />);
    await waitFor(() => expect(screen.getByText('Industry, customer and solution experience')).toBeTruthy());
    const cols = consultantsSelect.mock.calls.map((c) => c[0]).find((c) => c.includes('customer_segments'));
    expect(cols).toBeTruthy();
    expect(cols).not.toContain('*');
    expect(cols).toContain('language_levels');
    expect(screen.getByText('Utilities')).toBeTruthy();
  });

  it('shows the completeness meter and updates it when a list is filled', async () => {
    render(<ProfileExperienceCard />);
    await waitFor(() => expect(screen.getByText(/Profile completeness:/)).toBeTruthy());
    const before = screen.getByText(/Profile completeness:/).textContent;
    // fill customer segments via its Other entry
    const sections = screen.getAllByLabelText('Other (type and press Add)');
    fireEvent.click(screen.getByText('Government & public sector'));
    fireEvent.change(sections[1], { target: { value: 'Semi-government' } });
    fireEvent.keyDown(sections[1], { key: 'Enter' });
    await waitFor(() => {
      const after = screen.getByText(/Profile completeness:/).textContent;
      expect(after).not.toBe(before);
    });
  });

  it('saves the changed columns with one update and shows the success toast', async () => {
    render(<ProfileExperienceCard />);
    await waitFor(() => expect(screen.getByText('Utilities')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Experience saved'));
    const payload = consultantsUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('industries', ['Utilities']);
    expect(payload).toHaveProperty('project_scale', null);
    expect(payload).toHaveProperty('working_week', null);
    expect(payload).toHaveProperty('language_levels', { en: 'Native' });
    expect(payload).not.toHaveProperty('id');
  });

  it('shows the database error message in a toast', async () => {
    consultantsUpdate.mockImplementationOnce(() => ({ eq: () => Promise.resolve({ error: { message: 'contact details are not allowed' } }) }));
    render(<ProfileExperienceCard />);
    await waitFor(() => expect(screen.getByText('Utilities')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('contact details are not allowed'));
  });

  it('language level selects follow the consultant languages', async () => {
    render(<ProfileExperienceCard />);
    await waitFor(() => expect(screen.getByText('Language levels')).toBeTruthy());
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Arabic')).toBeTruthy();
  });
});
