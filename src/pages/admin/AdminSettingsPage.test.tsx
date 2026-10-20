import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ settings: {} as Record<string, boolean>, update: vi.fn(), count: { data: 7, isError: false, isPending: false } }));
vi.mock('@/hooks/useAdminSettings', () => ({ useAdminSettings: () => ({ settings: state.settings, loading: false, updateSetting: state.update }) }));
vi.mock('@/hooks/useAdminEmailCount', () => ({ useAdminEmailCount: () => state.count }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string, values?: { count?: number }) => fallback.replace('{{count}}', String(values?.count ?? '')) }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) } }));
vi.mock('@/components/admin/NDATemplateEditor', () => ({ default: () => null }));
vi.mock('@/components/admin/CriticalServiceSettingsCard', () => ({ default: () => null }));
vi.mock('@/components/admin/CriticalRequestsLive', () => ({ default: () => null }));
vi.mock('@/components/admin/TelegramAdminCard', () => ({ default: () => null }));
vi.mock('@/components/admin/PushAdminCard', () => ({ default: () => null }));
vi.mock('@/components/admin/FoundingSettings', () => ({ default: () => null }));
vi.mock('@/components/admin/ProfileRemindersCard', () => ({ default: () => null }));
vi.mock('@/components/admin/MatchWeightsCard', () => ({ default: () => null }));
import AdminSettingsPage from './AdminSettingsPage';
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => { cleanup(); state.settings = {}; state.update.mockClear(); });
describe('administrator email switch', () => {
  it('defaults on and saves to the existing settings store', () => {
    render(<AdminSettingsPage />);
    const toggle = screen.getByRole('switch', { name: 'E-mail every administrator notification' });
    expect(toggle).toHaveAttribute('aria-checked', 'true'); fireEvent.click(toggle);
    expect(state.update).toHaveBeenCalledExactlyOnceWith('admin_email_alerts', false);
  });
  it('respects a stored false setting', () => {
    state.settings = { admin_email_alerts: false }; render(<AdminSettingsPage />);
    expect(screen.getByRole('switch', { name: 'E-mail every administrator notification' })).toHaveAttribute('aria-checked', 'false');
  });
});