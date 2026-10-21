import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const user = {
  id: 'u-target', email: 'pending@example.com', name: 'Pending Person', roles: ['consultant'], status: 'pending',
  providers: ['email'], email_verified: false, mfa_enabled: false, tags: [],
};
vi.mock('@/hooks/useUserAdmin', () => ({
  useUserDetail: () => ({ data: { user, legacy: true }, isLoading: false, error: null, refetch: vi.fn() }),
  callRpc: vi.fn(), callEdge: vi.fn(), useInvalidateUsers: () => vi.fn(),
}));

import UserDetailSheet from './UserDetailSheet';

function renderAs(roles: string[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <UserDetailSheet userId="u-target" installed={false} perms={['users.read', 'users.edit']} me={{ id: 'me', roles }}
        superAdminCount={1} fourEyes={false} onClose={() => {}} onOpenConsultant={() => {}} />
    </MemoryRouter></QueryClientProvider>,
  );
}

describe('unconfirmed accounts in the Users console', () => {
  it('admins can resend the confirmation e-mail but cannot mark it confirmed', () => {
    renderAs(['admin']);
    expect(screen.getByTestId('um-unconfirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend confirmation e-mail' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark e-mail as confirmed' })).toBeNull();
  });

  it('super admins also get "Mark e-mail as confirmed"', () => {
    renderAs(['super_admin']);
    expect(screen.getByRole('button', { name: 'Mark e-mail as confirmed' })).toBeInTheDocument();
  });
});
