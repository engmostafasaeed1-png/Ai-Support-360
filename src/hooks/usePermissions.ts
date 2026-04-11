import { useTenant } from '@/contexts/TenantContext';

type Permission =
  | 'tickets.create' | 'tickets.delete' | 'tickets.export'
  | 'consultants.match' | 'sessions.record' | 'sessions.video'
  | 'nda.sign' | 'nda.view' | 'nda.revoke'
  | 'reports.export' | 'admin.users' | 'admin.billing'
  | 'vmware.access' | 'api.integrations';

const TIER_PERMISSIONS: Record<string, Permission[]> = {
  basic: ['tickets.create', 'consultants.match', 'nda.sign'],
  professional: ['tickets.create', 'tickets.export', 'consultants.match', 'sessions.video', 'sessions.record', 'nda.sign', 'nda.view', 'reports.export', 'api.integrations'],
  enterprise: ['tickets.create', 'tickets.delete', 'tickets.export', 'consultants.match', 'sessions.video', 'sessions.record', 'nda.sign', 'nda.view', 'nda.revoke', 'reports.export', 'admin.users', 'admin.billing', 'vmware.access', 'api.integrations'],
};

export function usePermissions() {
  const { tenant, membership } = useTenant();
  const tier = (tenant as any)?.subscription_tier || 'basic';
  const orgRole = membership?.org_role || 'member';

  const can = (permission: Permission): boolean => {
    if (orgRole === 'owner' || orgRole === 'admin') return true;
    return TIER_PERMISSIONS[tier]?.includes(permission) ?? false;
  };

  return { can };
}
