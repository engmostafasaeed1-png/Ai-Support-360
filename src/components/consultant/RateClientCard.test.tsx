import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({ review: null as any, inserts: [] as any[], updates: [] as any[], error: null as any }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => {
  const b: any = {};
  b.select = () => b; b.eq = () => b;
  b.maybeSingle = () => Promise.resolve({ data: db.review, error: null });
  b.insert = (p: any) => { db.inserts.push(p); return Promise.resolve({ error: db.error }); };
  b.update = (p: any) => ({ eq: (...a: any[]) => { db.updates.push({ p, a }); return Promise.resolve({ error: db.error }); } });
  return { supabase: { from: () => b } };
});

import RateClientCard, { canEditReview } from './RateClientCard';

const ui = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RateClientCard ticketId="t1" consultantId="c1" clientId="u1" />
  </QueryClientProvider>,
);

beforeEach(() => { db.review = null; db.inserts = []; db.updates = []; db.error = null; toast.success.mockReset(); toast.error.mockReset(); });

describe('RateClientCard', () => {
  it('requires the overall score', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit rating' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(db.inserts).toHaveLength(0);
  });

  it('inserts the full payload with null for empty optional values', async () => {
    ui();
    await screen.findByText('Rate this client');
    fireEvent.click(screen.getByRole('radiogroup', { name: 'Overall' }).querySelectorAll('[role=radio]')[3]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));
    await waitFor(() => expect(db.inserts).toHaveLength(1));
    expect(db.inserts[0]).toEqual({ ticket_id: 't1', consultant_id: 'c1', client_id: 'u1', score: 4, communication_score: null, clarity_score: null, cooperation_score: null, would_work_again: true, comment: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Thank you. Your rating was saved.'));
  });

  it('shows the database error', async () => {
    db.error = { message: 'Too many attempts. Please wait a while and try again.' };
    ui();
    await screen.findByText('Rate this client');
    fireEvent.click(screen.getByRole('radiogroup', { name: 'Overall' }).querySelectorAll('[role=radio]')[4]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many attempts. Please wait a while and try again.'));
  });

  it('stars are a keyboard radio group with a name per star', async () => {
    ui();
    const group = await screen.findByRole('radiogroup', { name: 'Overall' });
    const stars = group.querySelectorAll('[role=radio]');
    expect(stars[0].getAttribute('aria-label')).toBe('1 star');
    expect(stars[4].getAttribute('aria-label')).toBe('5 stars');
    fireEvent.keyDown(stars[0], { key: 'ArrowRight' });
    expect(stars[1].getAttribute('aria-checked')).toBe('true');
  });

  it('allows editing for 7 days only', async () => {
    const now = Date.now();
    expect(canEditReview(new Date(now - 6 * 864e5).toISOString(), now)).toBe(true);
    expect(canEditReview(new Date(now - 8 * 864e5).toISOString(), now)).toBe(false);
    db.review = { id: 'r1', score: 3, communication_score: null, clarity_score: null, cooperation_score: null, would_work_again: false, comment: 'ok', created_at: new Date(now - 8 * 864e5).toISOString() };
    ui();
    expect(await screen.findByText('Ratings can be edited for 7 days.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit rating' })).toBeNull();
  });

  it('edit updates the saved row', async () => {
    db.review = { id: 'r1', score: 3, communication_score: 2, clarity_score: null, cooperation_score: null, would_work_again: false, comment: 'ok', created_at: new Date().toISOString() };
    ui();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rating' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit rating' }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].a).toEqual(['id', 'r1']);
    expect(db.updates[0].p.score).toBe(3);
    expect(db.updates[0].p.communication_score).toBe(2);
  });
});
