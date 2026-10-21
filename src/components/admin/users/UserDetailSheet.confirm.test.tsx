import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { normalizeUserDetail, UUID_RE } from '@/lib/userAdmin';

const AUTH_ID = 'ececf669-f7d0-49f8-a974-487afb5447ac';
// Shape returned by the database detail (admin_user_detail): the account id is `user_id`, there is no `id`.
const rawUser = {
  user_id: AUTH_ID, consultant_id: '11111111-2222-4333-8444-555555555555', email: 'pending@example.com', name: 'Pending Person',
  roles: ['consultant'], status: 'pending', providers: ['email'], email_verified: false, mfa_enabled: false, tags: [],
};
let detail: Record<string, unknown> = normalizeUserDetail({ user: { ...rawUser } });
const callEdge = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/hooks/useUserAdmin', () => ({
  useUserDetail: () => ({ data: detail, isLoading: false, error: null, refetch: vi.fn() }),
  callRpc: vi.fn(), callEdge: (...a: unknown[]) => callEdge(...a), useInvalidateUsers: () => vi.fn(),
}));

import UserDetailSheet from './UserDetailSheet';

function renderAs(roles: string[], perms = ['users.read', 'users.edit']) {
  return render(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <UserDetailSheet userId={AUTH_ID} installed perms={perms} me={{ id: '99999999-9999-4999-8999-999999999999', roles }}
        superAdminCount={1} fourEyes={false} onClose={() => {}} onOpenConsultant={() => {}} />
    </MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => { callEdge.mockClear(); detail = normalizeUserDetail({ user: { ...rawUser } }); });

describe('unconfirmed accounts in the Users console', () => {
  it('admins can resend the confirmation e-mail but cannot mark it confirmed', () => {
    renderAs(['admin']);
    expect(screen.getByTestId('um-unconfirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend confirmation e-mail' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Mark e-mail as confirmed' })).toBeNull();
  });

  it('super admins also get "Mark e-mail as confirmed"', () => {
    renderAs(['super_admin']);
    expect(screen.getByRole('button', { name: 'Mark e-mail as confirmed' })).toBeInTheDocument();
  });

  it('the drawer sends the auth user id as user_id when resending (database detail without `id`)', async () => {
    renderAs(['admin']);
    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation e-mail' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(callEdge).toHaveBeenCalledTimes(1));
    const [fn, body] = callEdge.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('admin-manage-user');
    expect(body.action).toBe('resend_verification');
    expect(body.user_id).toBe(AUTH_ID);
    expect(String(body.user_id)).toMatch(UUID_RE);
  });

  it('keeps the e-mail buttons disabled while the account id is unknown and sends nothing', () => {
    detail = { user: { ...rawUser, user_id: undefined } };
    renderAs(['super_admin']);
    expect(screen.getByRole('button', { name: 'Resend confirmation e-mail' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mark e-mail as confirmed' })).toBeDisabled();
    expect(callEdge).not.toHaveBeenCalled();
  });
});
