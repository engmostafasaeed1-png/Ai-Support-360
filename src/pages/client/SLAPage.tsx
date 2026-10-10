import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Clock, CheckCircle2, AlertTriangle, Settings2, BarChart3 } from 'lucide-react';
import SLAPolicyManager from '@/components/client/SLAPolicyManager';
import { slaState, summarize, formatHours, type SlaState, type SlaTicket } from '@/lib/slaOverview';

const stateStyle: Record<SlaState, { label: string; className: string }> = {
  met: { label: 'Met', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-200' },
  on_track: { label: 'On track', className: 'bg-blue-500/10 text-blue-600 border-blue-200' },
  at_risk: { label: 'At risk', className: 'bg-amber-500/10 text-amber-600 border-amber-200' },
  breached: { label: 'Breached', className: 'bg-destructive/10 text-destructive border-destructive/20' },
};

const urgencyColors: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive',
  high: 'bg-amber-500/10 text-amber-600',
  medium: 'bg-blue-500/10 text-blue-600',
  low: 'bg-muted text-muted-foreground',
};

/** The tickets of the active company (or of the user) with the columns that the SLA numbers are measured from. */
function useSlaTickets() {
  const { tenant, loading } = useTenant();
  return useQuery({
    queryKey: ['client-sla-tickets', tenant?.id ?? null],
    enabled: !loading,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as SlaTicket[];
      let query = supabase
        .from('tickets')
        .select('id, title, urgency, status, created_at, sla_response_deadline, sla_deadline, first_response_at, resolved_at, sla_breached')
        .order('created_at', { ascending: false })
        .limit(500);
      query = tenant?.id ? query.eq('tenant_id', tenant.id) : query.eq('client_id', user.id);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as SlaTicket[];
    },
  });
}

export default function SLAPage() {
  const { t } = useTranslation();
  const { data: tickets = [], isLoading } = useSlaTickets();
  const now = Date.now();
  const summary = summarize(tickets, now);
  const tracked = tickets.filter((x) => x.sla_deadline).slice(0, 50);
  const plural = (n: number) => (n === 1 ? '' : 's');

  const cards = [
    {
      label: 'Average first response',
      value: formatHours(summary.avgFirstResponseHours),
      note: `${summary.firstResponseCount} ticket${plural(summary.firstResponseCount)} measured`,
      ok: true,
    },
    {
      label: 'Average resolution time',
      value: formatHours(summary.avgResolutionHours),
      note: `${summary.resolutionCount} ticket${plural(summary.resolutionCount)} measured`,
      ok: true,
    },
    {
      label: 'Missed their SLA',
      value: summary.breachRate === null ? '—' : `${summary.breachRate.toFixed(1)}%`,
      note: `${summary.breached} of ${summary.tracked} ticket${plural(summary.tracked)} with an SLA`,
      ok: summary.breached === 0,
    },
    {
      label: 'Tickets with an SLA',
      value: String(summary.tracked),
      note: 'Deadlines are set when a ticket is created',
      ok: true,
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.sla', 'Service Level Agreements')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Measured from your own tickets. Configure the response and resolution times that apply to them.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="configure" className="gap-1.5"><Settings2 className="w-3.5 h-3.5" /> Configure</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((card) => (
                  <Card key={card.label}>
                    <CardContent className="pt-5 pb-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{card.label}</span>
                        {card.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        )}
                      </div>
                      <p className="text-2xl font-bold">{card.value}</p>
                      <p className="text-[10px] text-muted-foreground">{card.note}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Ticket SLA Tracking
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {tracked.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No ticket has an SLA deadline yet. A new ticket gets its deadlines automatically when it is created, from your policy for its urgency or from the platform default.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Ticket</th>
                            <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Urgency</th>
                            <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">First response</th>
                            <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Resolution due</th>
                            <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {tracked.map((tk) => {
                            const state = slaState(tk, now);
                            const style = state ? stateStyle[state] : null;
                            const responseHours = tk.first_response_at
                              ? (new Date(tk.first_response_at).getTime() - new Date(tk.created_at).getTime()) / 3600000
                              : null;
                            return (
                              <tr key={tk.id} className="hover:bg-muted/20">
                                <td className="px-4 py-3">
                                  <Link to={`/client/tickets/${tk.id}`} className="font-medium hover:text-primary">{tk.title}</Link>
                                  <p className="text-xs text-muted-foreground">{format(new Date(tk.created_at), 'MMM d, yyyy')}</p>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge variant="outline" className={urgencyColors[tk.urgency] || ''}>{tk.urgency}</Badge>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <Clock className="w-3.5 h-3.5" />
                                    <span>
                                      {responseHours !== null
                                        ? formatHours(responseHours)
                                        : tk.sla_response_deadline
                                          ? `waiting, due ${format(new Date(tk.sla_response_deadline), 'MMM d, HH:mm')}`
                                          : 'waiting'}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  {tk.sla_deadline ? format(new Date(tk.sla_deadline), 'MMM d, HH:mm') : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  {style && <Badge variant="outline" className={style.className}>{style.label}</Badge>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="configure">
          <SLAPolicyManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
