import { Kanban, UserCheck, FileText, Handshake, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminTickets } from '@/hooks/useAdminData';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

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
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Kanban className="w-5 h-5 text-primary" /> Ticket Management
          </h2>
          <p className="text-sm text-muted-foreground">{allTickets.length} tickets total</p>
        </div>
        <Link to="/admin/tickets">
          <Button variant="outline" size="sm" className="gap-1">
            <Kanban className="w-3.5 h-3.5" /> Kanban View <ExternalLink className="w-3 h-3" />
          </Button>
        </Link>
      </div>

      {/* Status Summary */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {['new', 'in_progress', 'resolved', 'closed'].map((status) => (
          <Card key={status} className="rounded-xl">
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground capitalize">{status.replace('_', ' ')}</p>
              <p className="text-2xl font-bold text-foreground">
                {tickets ? (tickets as any)[status]?.length || 0 : 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardContent className="pt-4 overflow-x-auto">
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
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No tickets found.</TableCell></TableRow>
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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-primary" /> Consultant Approvals
        </h2>
        <p className="text-sm text-muted-foreground">Review and approve consultant applications</p>
      </div>
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center text-muted-foreground">
          Consultant approval queue. Review verification status, interview scores, and certifications.
        </CardContent>
      </Card>
    </div>
  );
}

export function NDAManagementSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" /> NDA Management
        </h2>
        <p className="text-sm text-muted-foreground">Manage non-disclosure agreements</p>
      </div>
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center text-muted-foreground">
          NDA template editor and signed agreements tracking. View, revoke, and manage all NDAs.
        </CardContent>
      </Card>
    </div>
  );
}

export function MatchRequestsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Handshake className="w-5 h-5 text-primary" /> Match Requests
        </h2>
        <p className="text-sm text-muted-foreground">Track client-consultant matching</p>
      </div>
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center text-muted-foreground">
          Match request overview. Monitor pending, accepted, and rejected match requests across all tickets.
        </CardContent>
      </Card>
    </div>
  );
}

export function ProjectsMilestonesSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" /> Projects & Milestones
        </h2>
        <p className="text-sm text-muted-foreground">Oversee all client projects and milestone escrow</p>
      </div>
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center text-muted-foreground">
          Project management overview. Track active projects, milestone funding, and delivery status.
        </CardContent>
      </Card>
    </div>
  );
}
