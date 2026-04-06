import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const ALL_PERMISSIONS = [
  'view_dashboard', 'manage_tickets', 'create_tickets', 'assign_tickets',
  'view_users', 'manage_users', 'change_roles', 'suspend_users',
  'view_reports', 'export_reports', 'view_payments', 'manage_payments',
  'issue_refunds', 'manage_settings', 'manage_integrations', 'view_audit_logs',
  'manage_nda', 'approve_consultants', 'manage_environments',
];

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ALL_PERMISSIONS,
  consultant: ['view_dashboard', 'create_tickets', 'view_reports'],
  client: ['view_dashboard', 'create_tickets', 'view_payments'],
};

const SETTING_KEY = 'role_permissions';

function parsePerms(saved: Record<string, string[]>): Record<string, string[]> {
  return {
    admin: saved.admin ?? DEFAULT_ROLE_PERMISSIONS.admin,
    consultant: saved.consultant ?? DEFAULT_ROLE_PERMISSIONS.consultant,
    client: saved.client ?? DEFAULT_ROLE_PERMISSIONS.client,
  };
}

export function useRolePermissions() {
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>(DEFAULT_ROLE_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', SETTING_KEY)
        .maybeSingle();

      if (data?.value && typeof data.value === 'object' && !Array.isArray(data.value)) {
        setRolePerms(parsePerms(data.value as Record<string, string[]>));
      }
      setLoading(false);
    };
    load();

    // Subscribe to realtime changes
    const channel = supabase
      .channel('role-permissions-sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'platform_settings',
          filter: `key=eq.${SETTING_KEY}`,
        },
        (payload) => {
          const newRow = payload.new as { value?: Record<string, string[]> } | undefined;
          if (newRow?.value && typeof newRow.value === 'object') {
            setRolePerms(parsePerms(newRow.value));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const togglePermission = useCallback((role: string, perm: string) => {
    setRolePerms(prev => {
      const current = prev[role] || [];
      const next = current.includes(perm)
        ? current.filter(p => p !== perm)
        : [...current, perm];
      return { ...prev, [role]: next };
    });
  }, []);

  const savePermissions = useCallback(async () => {
    const { error } = await supabase
      .from('platform_settings')
      .upsert(
        { key: SETTING_KEY, value: rolePerms as unknown as Record<string, unknown> } as any,
        { onConflict: 'key' }
      );

    if (error) {
      toast.error('Failed to save permissions');
    } else {
      toast.success('Permissions saved');
    }
  }, [rolePerms]);

  return { rolePerms, loading, togglePermission, savePermissions };
}
