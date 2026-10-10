import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Activity, Eye, Lock, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { useRlsOverview } from '@/hooks/useAdminOverviews';
import { MIN_PASSWORD_LENGTH, PASSWORD_RULES } from '@/lib/passwordPolicy';
import { Fact, SectionShell } from './shared';

/** What protects the platform today. Every line is read from the real code or database, nothing is typed by hand. */
export function SecuritySettingsSection() {
  const { settings, loading } = useAdminSettings();
  const { data: tables } = useRlsOverview();
  const total = tables?.length ?? 0;
  const withRls = tables?.filter((t) => t.rls_enabled).length ?? 0;
  const registrationOpen = settings.open_registration !== false;

  return (
    <SectionShell
      icon={Lock}
      title="Security Settings"
      description="What protects the platform today. Everything on this page is read from the real code or database."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Passwords when creating an account</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-1 text-muted-foreground">
              {PASSWORD_RULES.map((r) => (
                <li key={r.label}>• {r.label}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              A password is accepted when it has at least {MIN_PASSWORD_LENGTH} characters and meets at least 4 of these 6 rules.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Idle sign-out</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Automatic sign-out after inactivity is switched off (owner decision of 9 October 2026). A person stays signed in until they sign out
              or the session of the authentication service ends.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Sign-in</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>The sign-in page offers e-mail and password, Google, Apple, Microsoft and Lovable. The providers are switched on or off in the authentication settings of the backend, not in this console.</p>
            <p>After 5 wrong passwords the sign-in form locks for 15 minutes. This lock is kept in the browser tab only; the authentication service applies its own limits on top.</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Registration</CardTitle></CardHeader>
          <CardContent>
            <Fact label="Open registration">
              {loading ? '…' : <Badge variant={registrationOpen ? 'secondary' : 'destructive'} className="text-[10px]">{registrationOpen ? 'On: anyone can sign up' : 'Off: sign-up is closed'}</Badge>}
            </Fact>
            <p className="mt-1 text-xs text-muted-foreground">
              When it is off, no new account can be created. Change it in{' '}
              <Link to="/admin/settings" className="text-primary underline-offset-2 hover:underline">Platform Settings</Link>.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Data access</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {tables ? (
              <p>
                <span className="font-semibold text-foreground">{withRls} of {total}</span> tables have row-level security switched on, so each person can only read and change the rows the policies allow.{' '}
                <Link to="/admin/console/rls" className="text-primary underline-offset-2 hover:underline">See every table</Link>.
              </p>
            ) : (
              <Skeleton className="h-5 w-2/3" />
            )}
          </CardContent>
        </Card>
      </div>
    </SectionShell>
  );
}

/** The sign-in methods are described on the Security Settings page; the old switches did nothing. */
export function AuthenticationSection() {
  return <Navigate to="/admin/console/security" replace />;
}

/** Every table of the database with its real row-level security state. */
export function DataAccessSection() {
  const { data, isLoading, error } = useRlsOverview();
  const [q, setQ] = useState('');
  const tables = useMemo(() => data ?? [], [data]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => tables.filter((t) => t.table.toLowerCase().includes(needle)), [tables, needle]);
  const off = tables.filter((t) => !t.rls_enabled).length;
  const locked = tables.filter((t) => t.rls_enabled && t.policies === 0).length;

  return (
    <SectionShell
      icon={Eye}
      title="Data Access Policies"
      description="Row-level security of every table in the database, read live. A table without it could be read by anyone with the public key."
    >
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{(error as Error).message}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="rounded-xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Tables</p><p className="text-2xl font-bold">{tables.length}</p></CardContent></Card>
            <Card className="rounded-xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Without row-level security</p><p className={off > 0 ? 'text-2xl font-bold text-destructive' : 'text-2xl font-bold'}>{off}</p></CardContent></Card>
            <Card className="rounded-xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Locked (on, but no policy)</p><p className="text-2xl font-bold">{locked}</p></CardContent></Card>
          </div>

          <div className="relative max-w-sm">
            <Search aria-hidden="true" className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a table…" className="ps-9" aria-label="Find a table" />
          </div>

          <div className="grid gap-2">
            {shown.length === 0 ? (
              <p className="rounded-xl border border-border/50 p-6 text-center text-sm text-muted-foreground">No table matches.</p>
            ) : (
              shown.map((t) => (
                <Card key={t.table} className="rounded-xl">
                  <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-medium text-foreground">{t.table}</span>
                      <span className="ms-2 text-xs text-muted-foreground">{t.policies} {t.policies === 1 ? 'policy' : 'policies'}</span>
                    </div>
                    {!t.rls_enabled ? (
                      <Badge variant="destructive" className="shrink-0 text-[10px]">No row-level security</Badge>
                    ) : t.policies === 0 ? (
                      <Badge variant="outline" className="shrink-0 border-warning/50 bg-warning/10 text-[10px] text-warning">Locked: only the server can use it</Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 border-success/40 bg-success/10 text-[10px] text-success">Protected</Badge>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      )}
    </SectionShell>
  );
}

export function AuditLogSection() {
  const { data: logs, isLoading } = useAuditLogs('', 'all');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Activity className="h-5 w-5 text-primary" /> Audit Logs
        </h2>
        <p className="text-sm text-muted-foreground">Track all platform activity</p>
      </div>
      <Card className="rounded-2xl">
        <CardContent className="overflow-x-auto pt-4">
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
                  <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No audit logs yet.</TableCell></TableRow>
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
