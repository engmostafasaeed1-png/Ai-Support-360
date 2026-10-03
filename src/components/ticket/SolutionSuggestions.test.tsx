import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), insert: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: () => ({ insert: mocks.insert }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SolutionSuggestions from './SolutionSuggestions';

const ID = '123e4567-e89b-12d3-a456-426614174000';

const knowledgeAnswer = {
  enabled: true,
  mode: 'knowledge',
  note: '',
  suggestions: [{
    title: 'Open the posting period',
    summary: 'The period is closed.',
    steps: ['Open OB52', 'Post the invoice again'],
    tcodes: ['OB52'],
    confidence: 'high',
    basis: 'past_case',
    source_ids: [ID],
  }],
  sources: [{ id: ID, kind: 'solution', title: 'Posting period closed' }],
};

// each test uses its own description, because the card remembers the answer for a draft
let counter = 0;
function renderCard(over: Record<string, unknown> = {}) {
  counter += 1;
  const onSolved = vi.fn();
  const props = {
    title: 'Vendor invoice fails',
    description: `Test ${counter}: the vendor invoice cannot be posted because the period is closed`,
    areas: ['SAP FI/CO'],
    other: '',
    details: '',
    urgency: 'medium',
    language: 'en',
    onSolved,
    ...over,
  };
  render(<SolutionSuggestions {...(props as React.ComponentProps<typeof SolutionSuggestions>)} />);
  return { onSolved };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.insert.mockReset();
  mocks.insert.mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

describe('SolutionSuggestions', () => {
  it('asks once and shows the suggestion with where it comes from', async () => {
    mocks.invoke.mockResolvedValue({ data: knowledgeAnswer, error: null });
    renderCard();
    expect(await screen.findByText('Open the posting period')).not.toBeNull();
    expect(screen.queryByText('Solved case (anonymous)')).not.toBeNull();
    expect(screen.queryByText('Open OB52')).not.toBeNull();
    expect(screen.queryByText('high confidence')).not.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const [name, options] = mocks.invoke.mock.calls[0];
    expect(name).toBe('ai-suggest');
    expect(options.body.sap_modules).toEqual(['SAP FI/CO']);
  });

  it('says clearly when the answer is general guidance and not from past cases', async () => {
    mocks.invoke.mockResolvedValue({
      data: { ...knowledgeAnswer, mode: 'general', suggestions: [{ ...knowledgeAnswer.suggestions[0], basis: 'general', source_ids: [] }], sources: [] },
      error: null,
    });
    renderCard();
    await screen.findByText('Open the posting period');
    expect(screen.queryAllByText(/General SAP guidance/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/not taken from past cases/)).not.toBeNull();
  });

  it('records "this solved my problem" and tells the page', async () => {
    mocks.invoke.mockResolvedValue({ data: knowledgeAnswer, error: null });
    const { onSolved } = renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /This solved my problem/ }));
    await waitFor(() => expect(onSolved).toHaveBeenCalledTimes(1));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'solved', item_ids: [ID], mode: 'knowledge' }));
  });

  it('records "helpful" once for a suggestion', async () => {
    mocks.invoke.mockResolvedValue({ data: knowledgeAnswer, error: null });
    renderCard();
    const helpful = await screen.findByRole('button', { name: 'Helpful' });
    fireEvent.click(helpful);
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'helpful', item_ids: [ID] })));
    expect((helpful as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(helpful);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the administrator switched suggestions off', async () => {
    mocks.invoke.mockResolvedValue({ data: { enabled: false, mode: 'general', suggestions: [], sources: [] }, error: null });
    renderCard();
    await waitFor(() => expect(screen.queryByTestId('solution-suggestions')).toBeNull());
  });

  it('does not ask for a description that is too short', () => {
    renderCard({ description: 'too short' });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId('solution-suggestions')).toBeNull();
  });

  it('shows a quiet message when the service fails', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('boom') });
    renderCard();
    expect(await screen.findByText(/not available right now/)).not.toBeNull();
  });

  it('shows SAP notes, community discussions and the search link, all opening SAP websites in a new tab', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        ...knowledgeAnswer,
        notes: [{ number: '2270407', url: 'https://me.sap.com/notes/2270407' }],
        references: {
          community_search_url: 'https://community.sap.com/t5/forums/searchpage/tab/message?q=fb60%20posting',
          community: { enabled: true, items: [{ title: 'Posting period closed in FB60', url: 'https://community.sap.com/t5/x/qaq-p/1', solved: true }] },
        },
      },
      error: null,
    });
    renderCard();
    const note = (await screen.findByText('2270407')).closest('a') as HTMLAnchorElement;
    expect(note.getAttribute('href')).toBe('https://me.sap.com/notes/2270407');
    expect(note.getAttribute('target')).toBe('_blank');
    expect(note.getAttribute('rel')).toContain('noopener');
    const discussion = screen.getByText('Posting period closed in FB60').closest('a') as HTMLAnchorElement;
    expect(discussion.getAttribute('href')).toBe('https://community.sap.com/t5/x/qaq-p/1');
    expect(discussion.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByText('Solved')).not.toBeNull();
    const search = screen.getByText(/Search SAP Community for this/).closest('a') as HTMLAnchorElement;
    expect(search.getAttribute('href')).toContain('https://community.sap.com/t5/forums/searchpage/tab/message?q=fb60');
    expect(screen.queryByText(/We do not copy SAP content/)).not.toBeNull();
  });

  it('shows the source, the licence and the change notice for a suggestion from SAP documentation', async () => {
    const page = 'https://github.com/SAP-docs/btp-best-practices-guide/blob/main/docs/set-up-and-plan/setting-up-authorization-cb9f0ac.md';
    mocks.invoke.mockResolvedValue({
      data: {
        enabled: true,
        mode: 'knowledge',
        note: '',
        suggestions: [{
          title: 'Assign the role collection',
          summary: 'The user lacks the role.',
          steps: ['Open the cockpit', 'Assign the role collection to the user'],
          tcodes: [],
          confidence: 'medium',
          basis: 'sap_docs',
          source_ids: [],
          docs: [{ title: 'Setting Up Authorization', url: page, source: 'SAP BTP best practices guide', license: 'CC-BY-4.0' }],
        }],
        sources: [],
      },
      error: null,
    });
    renderCard();
    await screen.findByText('Assign the role collection');
    expect(screen.queryByText('SAP documentation')).not.toBeNull();
    expect(screen.queryByText(/Taken from SAP's open documentation/)).not.toBeNull();
    const source = screen.getByText('Setting Up Authorization').closest('a') as HTMLAnchorElement;
    expect(source.getAttribute('href')).toBe(page);
    expect(source.getAttribute('target')).toBe('_blank');
    expect(source.getAttribute('rel')).toContain('noopener');
    const licence = screen.getByText('CC BY 4.0').closest('a') as HTMLAnchorElement;
    expect(licence.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(screen.queryByTestId('sap-docs-source')?.textContent).toContain('Shortened and reworded');
    expect(screen.queryByTestId('sap-docs-source')?.textContent).toContain('SAP SE');
  });

  it('shows no source block for a suggestion that does not come from SAP documentation', async () => {
    mocks.invoke.mockResolvedValue({ data: knowledgeAnswer, error: null });
    renderCard();
    await screen.findByText('Open the posting period');
    expect(screen.queryByTestId('sap-docs-source')).toBeNull();
  });

  it('shows no SAP block when there is no link to show', async () => {
    mocks.invoke.mockResolvedValue({ data: knowledgeAnswer, error: null });
    renderCard();
    await screen.findByText('Open the posting period');
    expect(screen.queryByTestId('sap-references')).toBeNull();
  });

  it('still offers the SAP Community search when there is nothing to suggest', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        enabled: true,
        mode: 'general',
        suggestions: [],
        sources: [],
        note: 'No stored solution matches your description yet.',
        references: { community_search_url: 'https://community.sap.com/t5/forums/searchpage/tab/message?q=fb60%20posting' },
      },
      error: null,
    });
    renderCard();
    expect(await screen.findByText('No stored solution matches your description yet.')).not.toBeNull();
    expect(screen.queryByText(/Search SAP Community for this/)).not.toBeNull();
  });

  it('says so when nothing fits yet', async () => {
    mocks.invoke.mockResolvedValue({ data: { enabled: true, mode: 'general', suggestions: [], sources: [], note: 'No stored solution matches your description yet.' }, error: null });
    renderCard();
    expect(await screen.findByText('No stored solution matches your description yet.')).not.toBeNull();
  });
});
