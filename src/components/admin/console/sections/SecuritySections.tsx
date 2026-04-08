import { Lock, Key, Eye, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

export function SecuritySettingsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary" /> Security Settings
        </h2>
        <p className="text-sm text-muted-foreground">Platform-wide security policies and access controls</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { title: 'Password Policy', items: ['Min 8 characters', 'Require uppercase', 'Require number', 'Require special char'] },
          { title: 'Session Security', items: ['60 min timeout', '5 max login attempts', '15 min lockout', 'Remember me enabled'] },
          { title: 'Data Protection', items: ['Encrypted at rest', '365 day retention', 'PII masking in logs', 'GDPR mode available'] },
          { title: 'Access Control', items: ['IP whitelist available', 'RLS on all tables', 'Audit logging active', 'Role-based access'] },
        ].map((group) => (
          <Card key={group.title} className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{group.title}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {group.items.map((item) => (
                <div key={item} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item}</span>
                  <Badge variant="outline" className="text-[10px]">Active</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AuthenticationSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Key className="w-5 h-5 text-primary" /> Authentication
        </h2>
        <p className="text-sm text-muted-foreground">Configure authentication providers and settings</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { provider: 'Email/Password', enabled: true, desc: 'Standard email and password authentication' },
          { provider: 'Google OAuth', enabled: true, desc: 'Sign in with Google accounts' },
          { provider: 'Magic Link', enabled: false, desc: 'Passwordless email authentication' },
          { provider: 'Phone OTP', enabled: false, desc: 'SMS-based authentication' },
        ].map((p) => (
          <Card key={p.provider} className="rounded-2xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-foreground">{p.provider}</span>
                <Switch checked={p.enabled} disabled />
              </div>
              <p className="text-xs text-muted-foreground">{p.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DataAccessSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Eye className="w-5 h-5 text-primary" /> Data Access Policies
        </h2>
        <p className="text-sm text-muted-foreground">Row-Level Security policies overview</p>
      </div>
      <div className="grid gap-3">
        {[
          { table: 'tickets', policies: 4, status: 'Protected' },
          { table: 'profiles', policies: 3, status: 'Protected' },
          { table: 'payments', policies: 3, status: 'Protected' },
          { table: 'sessions', policies: 3, status: 'Protected' },
          { table: 'messages', policies: 3, status: 'Protected' },
          { table: 'notifications', policies: 4, status: 'Protected' },
          { table: 'consultants', policies: 4, status: 'Protected' },
          { table: 'nda_agreements', policies: 5, status: 'Protected' },
        ].map((t) => (
          <Card key={t.table} className="rounded-xl">
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <div>
                <span className="font-mono text-sm font-medium text-foreground">{t.table}</span>
                <span className="text-xs text-muted-foreground ml-2">{t.policies} policies</span>
              </div>
              <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                {t.status}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AuditLogSection() {
  const { data: logs, isLoading } = useAuditLogs('', 'all');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> Audit Logs
        </h2>
        <p className="text-sm text-muted-foreground">Track all platform activity</p>
      </div>
      <Card className="rounded-2xl">
        <CardContent className="pt-4 overflow-x-auto">
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">Entity</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!logs || logs.length === 0) && (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No audit logs yet.</TableCell></TableRow>
                )}
                {(logs || []).slice(0, 20).map((log: any) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm font-medium">{log.action}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.entity_type || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(log.created_at), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
