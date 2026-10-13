import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, renderHook, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  rules: [] as any[],
  enforce: false,
  missing: [] as string[],
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      order: () => Promise.resolve({ data: state.rules, error: null }),
      maybeSingle: () => Promise.resolve({ data: table === 'profile_rules_config' ? { enforce: state.enforce } : null, error: null }),
    };
    return chain;
  };
  return { supabase: { from, rpc: () => Promise.resolve({ data: state.missing, error: null }) } };
});

import { useProfileFieldRules, useMyMissingFields } from './useProfileFieldRules';
import { FieldGate, RequiredMark } from '@/components/consultant/ProfileFieldRule';
import ProfileTodoCard from '@/components/consultant/ProfileTodoCard';

const rule = (field_key: string, mode: string, label = field_key) => ({ field_key, section: 'Basics', label, mode, default_mode: mode, sort_order: 1 });

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
}

beforeEach(() => {
  state.rules = [rule('bio', 'required', 'Bio'), rule('phone', 'hidden', 'Phone'), rule('github_url', 'optional')];
  state.enforce = false;
  state.missing = [];
});
afterEach(() => cleanup());

describe('useProfileFieldRules', () => {
  it('maps each field to its mode and answers the helpers', async () => {
    const { result } = renderHook(() => useProfileFieldRules(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.modes.size).toBe(3));
    expect(result.current.modes.get('bio')).toBe('required');
    expect(result.current.isRequired('bio')).toBe(true);
    expect(result.current.isRequired('github_url')).toBe(false);
    expect(result.current.isHidden('phone')).toBe(true);
    expect(result.current.isVisible('phone')).toBe(false);
    expect(result.current.isVisible('unknown_field')).toBe(true);
  });

  it('returns the missing fields from the server', async () => {
    state.missing = ['bio', 'city'];
    const { result } = renderHook(() => useMyMissingFields(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data).toEqual(['bio', 'city']));
  });
});

describe('form gating', () => {
  it('does not render a hidden field and stars a required one', async () => {
    render(
      <>
        <FieldGate field="phone"><span>phone input</span></FieldGate>
        <FieldGate field="bio"><span>bio input</span><RequiredMark field="bio" /></FieldGate>
        <FieldGate field="github_url"><span>github input</span><RequiredMark field="github_url" /></FieldGate>
      </>,
      { wrapper: wrap() },
    );
    await screen.findByTestId('required-bio');
    expect(screen.queryByText('phone input')).toBeNull();
    expect(screen.getByText('bio input')).toBeTruthy();
    expect(screen.getByTestId('required-bio').textContent).toContain('Required');
    expect(screen.queryByTestId('required-github_url')).toBeNull();
  });
});

describe('ProfileTodoCard', () => {
  it('is not shown when nothing is missing', async () => {
    render(<ProfileTodoCard />, { wrapper: wrap() });
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByTestId('profile-todo')).toBeNull();
  });

  it('lists the missing fields by label, without the amber line while the switch is off', async () => {
    state.missing = ['bio'];
    render(<ProfileTodoCard />, { wrapper: wrap() });
    expect(await screen.findByText('Complete your profile')).toBeTruthy();
    expect(screen.getByText('1 required fields are missing.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Bio' })).toBeTruthy();
    expect(screen.queryByText(/hidden from clients/)).toBeNull();
  });

  it('shows the amber line while the switch is on and scrolls to the section', async () => {
    state.missing = ['bio'];
    state.enforce = true;
    const target = document.createElement('div');
    target.id = 'profile-details';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    render(<ProfileTodoCard />, { wrapper: wrap() });
    expect(await screen.findByText('Until these are filled your profile is hidden from clients and you cannot place new bids.')).toBeTruthy();
    target.remove();
    fireEvent.click(await screen.findByRole('button', { name: 'Bio' }));
  });
});
