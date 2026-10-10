import { ExternalLink, FileText, Kanban, UserCheck } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminTickets } from '@/hooks/useAdminData';
import { LinkCard, SectionShell } from './shared';

const urgencyColor: Record<string, string> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
};

export function TicketManagementSection() {
  const { data: tickets, isLoading } = useAdminTickets();

  const allTickets = tickets
    ? Object.entries(tickets).flatMap(([status, items]) =>
        (items as any[]).map((t) => ({ ...t, status }))
      )
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Kanban className="h-5 w-5 text-primary" /> Ticket Management
          </h2>
          <p className="text-sm text-muted-foreground">{allTickets.length} tickets total</p>
        </div>
        <Link to="/admin/tickets">
          <Button variant="outline" size="sm" className="gap-1">
            <Kanban className="h-3.5 w-3.5" /> Kanban View <ExternalLink className="h-3 w-3" />
          </Button>
        </Link>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {['new', 'in_progress', 'resolved', 'closed'].map((status) => (
          <Card key={status} className="rounded-xl">
            <CardContent className="pb-3 pt-4 text-center">
              <p className="text-xs capitalize text-muted-foreground">{status.replace('_', ' ')}</p>
              <p className="text-2xl font-bold text-foreground">
                {tickets ? (tickets as any)[status]?.length || 0 : 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardContent className="overflow-x-auto pt-4">
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs">Module</TableHead>
                  <TableHead className="text-xs">Urgency</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allTickets.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No tickets found.</TableCell></TableRow>
                )}
                {allTickets.slice(0, 15).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.id}</TableCell>
                    <TableCell className="text-sm font-medium">{t.title}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{t.module}</Badge></TableCell>
                    <TableCell><Badge variant={(urgencyColor[t.urgency] || 'outline') as any} className="text-[10px]">{t.urgency}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px] capitalize">{t.status.replace('_', ' ')}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.created}</TableCell>
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

export function ConsultantApprovalsSection() {
  return (
    <SectionShell icon={UserCheck} title="Consultant Approvals" description="Review and approve consultant applications">
      <LinkCard
        to="/admin/approvals"
        label="The approval queue, with verification, interview scores, certificates and the LinkedIn and Credly checks, is on its own page."
        cta="Open Consultant Approvals"
      />
    </SectionShell>
  );
}

export function NDAManagementSection() {
  return (
    <SectionShell icon={FileText} title="NDA Management" description="Manage non-disclosure agreements">
      <LinkCard
        to="/admin/nda-management"
        label="Signed agreements, revoking an NDA and the lifecycle of each NDA are on their own page. The NDA template text is edited in Platform Settings."
        cta="Open NDA Management"
      />
    </SectionShell>
  );
}

/** There is no page behind this section, so the old placeholder was removed. */
export function MatchRequestsSection() {
  return <Navigate to="/admin/console" replace />;
}

/** There is no page behind this section, so the old placeholder was removed. */
export function ProjectsMilestonesSection() {
  return <Navigate to="/admin/console" replace />;
}
