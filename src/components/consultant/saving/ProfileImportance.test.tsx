import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ProfileImportance, { claimSavePrompt, useProfileSavePrompt } from './ProfileImportance';
const data = vi.hoisted(() => ({ interview: null as string | null, badge: null as string | null }));
vi.mock('@/hooks/useConsultantProfile', () => ({ useConsultantProfile: () => ({ data: { user_id: 'u1', ai_interview_completed_at: data.interview, ai_interview_badge: data.badge } }) }));
vi.mock('../onboarding/EmbeddedGuides', () => ({ useEmbeddedGuides: () => ({ completeness: { percent: 60, items: [{ key: 'bio', label: 'Bio', done: false }] }, setup: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { dir: () => 'ltr' } }) }));
function SaveTrigger({ save }: { save: () => void }) {
  const before = useProfileSavePrompt();
  return <button onClick={() => before?.(save)}>Save draft</button>;
}
function CurrentPath() { const location = useLocation(); return <output data-testid="path">{location.pathname}{location.search}</output>; }
describe('manual save guidance frequency', () => {
  beforeEach(() => { cleanup(); sessionStorage.clear(); data.interview = null; data.badge = null; });
  it('appears once per user session for an incomplete profile', () => {
    expect(claimSavePrompt('u1', false, true, false)).toBe(true);
    expect(claimSavePrompt('u1', false, true, false)).toBe(false);
  });
  it('autosaving never consumes or shows the dialog', () => {
    expect(claimSavePrompt('u1', true, true, false)).toBe(false);
    expect(claimSavePrompt('u1', false, true, false)).toBe(true);
  });
  it('complete profiles with completed interviews need no dialog', () => {
    expect(claimSavePrompt('u1', false, false, true)).toBe(false);
  });
  it('saving later executes the pending save and the second save has no prompt', () => {
    const save = vi.fn();
    render(<MemoryRouter><ProfileImportance><SaveTrigger save={save} /></ProfileImportance></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('60');
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue later' }));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('the interview action also saves the draft before leaving', () => {
    const save = vi.fn();
    render(<MemoryRouter><CurrentPath /><ProfileImportance><SaveTrigger save={save} /></ProfileImportance></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take the AI interview now' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('path').textContent).toBe('/consultant/interviews?start=1');
  });
  it('completed interviews offer profile completion and preserve saving', () => {
    data.interview = '2026-10-18T12:00:00Z'; data.badge = 'Gold';
    const save = vi.fn();
    render(<MemoryRouter><ProfileImportance><SaveTrigger save={save} /></ProfileImportance></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete my profile' }));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
