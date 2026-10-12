import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({ row: null as any }));
vi.mock('@/integrations/supabase/client', () => {
  const b: any = {}; b.select = () => b; b.eq = () => b;
  b.maybeSingle = () => Promise.resolve({ data: db.row, error: null });
  return { supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) }, from: () => b } };
});
import ClientCollaborationRatingCard from './ClientCollaborationRatingCard';

const ui = () => render(<QueryClientProvider client={new QueryClient()}><ClientCollaborationRatingCard /></QueryClientProvider>);

describe('ClientCollaborationRatingCard', () => {
  it('shows the averages', async () => {
    db.row = { avg_score: '4.20', review_count: 5, communication_avg: '4.00', clarity_avg: null, cooperation_avg: '4.50', would_work_again_pct: 80 };
    ui();
    expect(await screen.findByText('How consultants rate your collaboration')).toBeTruthy();
    expect(screen.getByText('Communication')).toBeTruthy();
    expect(screen.queryByText('Clarity of requirements')).toBeNull();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('would work with you again')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    db.row = null;
    ui();
    expect(await screen.findByText('No ratings yet. Consultants can rate you after a request is finished.')).toBeTruthy();
  });
});
