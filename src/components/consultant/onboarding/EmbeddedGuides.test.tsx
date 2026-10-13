import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { profileCompleteness } from '@/lib/profileCompleteness';
import { EmbeddedGuideProvider, EmbeddedGuideSwitch, EmbeddedGuideCard, EmbeddedSetupMessages, embeddedChecklist, useEmbeddedGuides } from './EmbeddedGuides';

const empty = { displayName: '', bio: '', hourlyRate: 0, skills: [], certifications: [], workHistory: [], education: [], projects: [], availability: [], interviewDone: false };
function Strength({ percent }: { percent: number }) {
  const { setCompleteness } = useEmbeddedGuides();
  useEffect(() => { setCompleteness({ ...profileCompleteness({}), percent }); }, [percent, setCompleteness]);
  return null;
}
function Location() { return <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>; }
function View({ setup = false, percent = 80, userId = 'user-a' }: { setup?: boolean; percent?: number; userId?: string }) {
  return <MemoryRouter><EmbeddedGuideProvider setup={setup}><Strength percent={percent} /><EmbeddedGuideSwitch />
    <EmbeddedSetupMessages data={empty} userId={userId} />
    <EmbeddedGuideCard section="profile-details" stepKey="profile" /><EmbeddedGuideCard section="expertise" stepKey="skills" /><Location />
  </EmbeddedGuideProvider></MemoryRouter>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('embedded profile guides', () => {
  it('expands guides in setup even at 80%', async () => {
    render(<View setup percent={80} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Hide guide' })).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'Hide guide' })[0]).toHaveAttribute('aria-expanded', 'true');
  });
  it('expands below 80% outside setup', async () => {
    render(<View percent={79} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Hide guide' })).toHaveLength(2));
  });
  it('collapses at 80% outside setup', () => {
    render(<View percent={80} />);
    expect(screen.getAllByRole('button', { name: 'Show guide' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Show guide' })[0]).toHaveAttribute('aria-expanded', 'false');
  });
  it('remembers an explicit choice separately for each section', () => {
    const view = render(<View setup percent={79} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide guide' })[0]);
    expect(localStorage.getItem('consultant-step-guide:profile-details')).toBe('0');
    expect(localStorage.getItem('consultant-step-guide:expertise')).toBeNull();
    view.unmount(); render(<View setup percent={79} />);
    expect(screen.getAllByRole('button', { name: 'Show guide' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Hide guide' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show guide' }));
    expect(localStorage.getItem('consultant-step-guide:profile-details')).toBe('1');
  });
  it('globally hides guides and remembers the switch without erasing section choices', () => {
    localStorage.setItem('consultant-step-guide:expertise', '0');
    const view = render(<View setup percent={79} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show step guides' }));
    expect(screen.queryByRole('button', { name: 'Hide guide' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show guide' })).toBeNull();
    expect(localStorage.getItem('consultant-step-guide:expertise')).toBe('0');
    view.unmount(); render(<View setup percent={79} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('button', { name: 'Show guide' })).toBeTruthy();
  });
  it('shows welcome and checklist only below 80% in setup, and scrolls to the clicked section', async () => {
    const element = document.createElement('section'); element.id = 'expertise'; element.scrollIntoView = vi.fn(); document.body.appendChild(element);
    const view = render(<View setup percent={79} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Expertise: Not done' }));
    expect(element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    view.rerender(<View setup percent={80} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Expertise: Not done' })).toBeNull());
    element.remove();
  });
  it('does not show setup messages outside setup', () => {
    render(<View percent={79} />);
    expect(screen.queryByRole('button', { name: 'Profile: Not done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull();
  });
  it('dismisses completion persistently per user at 80%', async () => {
    const view = render(<View setup percent={79} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    view.rerender(<View setup percent={80} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem('consultant-setup-complete:user-a')).toBe('1');
    view.unmount(); const second = render(<View setup percent={80} />);
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull();
    second.rerender(<View setup percent={80} userId="user-b" />);
    expect(await screen.findByRole('button', { name: 'Take the tour' })).toBeTruthy();
  });
  it('opens the tour destination and remembers completion', async () => {
    render(<View setup percent={80} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take the tour' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/consultant?welcome=true');
    expect(localStorage.getItem('consultant-setup-complete:user-a')).toBe('1');
  });
  it('still works when localStorage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<View setup percent={79} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide guide' })[0]);
    expect(screen.getByRole('button', { name: 'Show guide' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
  it('derives all eight done states from loaded section data', () => {
    expect(embeddedChecklist(empty).map(item => item.done)).toEqual([false, false, false, false, false, false, false, false]);
    expect(embeddedChecklist({ displayName: 'Consultant', bio: 'SAP experience', hourlyRate: 100, skills: [{}], certifications: [{}], workHistory: [{}], education: [{}], projects: [{}], availability: [{}], interviewDone: true }).map(item => item.done)).toEqual([true, true, true, true, true, true, true, true]);
  });
});