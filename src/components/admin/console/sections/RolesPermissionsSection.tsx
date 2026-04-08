import { Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { Skeleton } from '@/components/ui/skeleton';

const PERMISSION_LABELS: Record<string, string> = {
  view_dashboard: 'View Dashboard',
  manage_tickets: 'Manage Tickets',
  create_tickets: 'Create Tickets',
  assign_tickets: 'Assign Tickets',
  view_users: 'View Users',
  manage_users: 'Manage Users',
  change_roles: 'Change Roles',
  suspend_users: 'Suspend Users',
  view_reports: 'View Reports',
  export_reports: 'Export Reports',
  view_payments: 'View Payments',
  manage_payments: 'Manage Payments',
  issue_refunds: 'Issue Refunds',
  manage_settings: 'Manage Settings',
  manage_integrations: 'Manage Integrations',
  view_audit_logs: 'View Audit Logs',
  manage_nda: 'Manage NDA',
  approve_consultants: 'Approve Consultants',
  manage_environments: 'Manage Environments',
};

const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS);
const ROLES = ['admin', 'consultant', 'client'];

export default function RolesPermissionsSection() {
  const { rolePerms, loading, togglePermission, savePermissions } = useRolePermissions();

  if (loading) return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Roles & Permissions
          </h2>
          <p className="text-sm text-muted-foreground">Configure what each role can access</p>
        </div>
        <Button onClick={savePermissions}>Save Permissions</Button>
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Permission</th>
                {ROLES.map((role) => (
                  <th key={role} className="text-center py-2 px-3 text-xs font-semibold text-muted-foreground capitalize">{role}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-3 text-sm text-foreground">{PERMISSION_LABELS[perm]}</td>
                  {ROLES.map((role) => (
                    <td key={role} className="text-center py-2 px-3">
                      <Checkbox
                        checked={(rolePerms[role] || []).includes(perm)}
                        onCheckedChange={() => togglePermission(role, perm)}
                        disabled={role === 'admin'}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
