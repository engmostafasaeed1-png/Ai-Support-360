import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Clock, Calendar, User, Tag, AlertTriangle,
  CheckCircle2, MessageSquare, FileText, Activity, Circle,
  Database, Server, HardDrive, Cpu, Code, Link2, Package, Building2,
  ShieldCheck, Lock, Download,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import NDASigningModal from '@/components/consultant/NDASigningModal';
import TicketQuickActions from '@/components/tickets/TicketQuickActions';
import RemoteAccessStatusPanel from '@/components/tickets/RemoteAccessStatusPanel';
import ScheduleMeetingDialog from '@/components/client/ScheduleMeetingDialog';
import { exportNDAAsPDF } from '@/lib/ndaPdfExport';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  under_review: 'bg-indigo-100 text-indigo-700',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_for_client: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
};

const statusIcons: Record<string, typeof Circle> = {
  new: Circle,
  under_review: Activity,
  matched: User,
  in_progress: Activity,
  waiting_for_client: Clock,
  resolved: CheckCircle2,
  closed: CheckCircle2,
};

interface TimelineEvent {
  id: string;
  type: 'status' | 'session' | 'message' | 'document' | 'created';
  title: string;
  description?: string;
  date: string;
  icon: typeof Circle;
  color: string;
}

export default function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const queryClient = useQueryClient();
  const [ndaModalOpen, setNdaModalOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);

  // Get current consultant ID
  const { data: consultantData } = useQuery({
    queryKey: ['my-consultant-id'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      return data;
    },
  });

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['case-detail', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('id', caseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  // Fetch client system landscape
  const { data: clientProfile } = useQuery({
    queryKey: ['case-client-profile', ticket?.client_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_profiles')
        .select('company_name, industry, company_size, sap_landscape, sap_hosting_type, sap_modules, sap_system_ids, sap_product, sap_version, sap_database_type, sap_os_type, sap_support_pack, sap_go_live_date, sap_user_count, sap_custom_dev_count, sap_interfaces, sap_third_party_tools, sap_landscape_notes')
        .eq('user_id', ticket!.client_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!ticket?.client_id,
  });

  // Check NDA status for this client
  const { data: ndaStatus } = useQuery({
    queryKey: ['case-nda-status', consultantData?.id, ticket?.client_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('nda_agreements')
        .select('id, revoked_at, signed_at, signature_data, signature_type, nda_content')
        .eq('consultant_id', consultantData!.id)
        .eq('client_id', ticket!.client_id)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      return data ? { signed: true, ...data } : { signed: false };
    },
    enabled: !!consultantData?.id && !!ticket?.client_id,
  });

  const ndaSigned = ndaStatus?.signed ?? false;

  const { data: sessions } = useQuery({
    queryKey: ['case-sessions', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, scheduled_at, started_at, ended_at, status, session_type, duration_minutes, notes')
        .eq('ticket_id', caseId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!caseId,
  });

  const { data: documents } = useQuery({
    queryKey: ['case-documents', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_documents')
        .select('id, file_name, created_at, version')
        .eq('ticket_id', caseId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!caseId,
  });

  // Build timeline
  const timeline: TimelineEvent[] = [];
  if (ticket) {
    timeline.push({
      id: 'created',
      type: 'created',
      title: 'Case Created',
      description: `Ticket "${ticket.title}" was submitted`,
      date: ticket.created_at,
      icon: Circle,
      color: 'text-accent',
    });

    if (ticket.resolved_at) {
      timeline.push({
        id: 'resolved',
        type: 'status',
        title: 'Case Resolved',
        date: ticket.resolved_at,
        icon: CheckCircle2,
        color: 'text-green-500',
      });
    }
  }

  (sessions || []).forEach((s) => {
    timeline.push({
      id: `session-${s.id}`,
      type: 'session',
      title: `Session ${s.session_type || 'scheduled'}`,
      description: s.notes || `Duration: ${s.duration_minutes || 0} min — Status: ${s.status}`,
      date: s.scheduled_at || s.started_at || '',
      icon: MessageSquare,
      color: 'text-blue-500',
    });
  });

  (documents || []).forEach((d) => {
    timeline.push({
      id: `doc-${d.id}`,
      type: 'document',
      title: `Document uploaded: ${d.file_name}`,
      description: `Version ${d.version}`,
      date: d.created_at,
      icon: FileText,
      color: 'text-purple-500',
    });
  });

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Case not found.</p>
        <Link to="/consultant/cases">
          <Button variant="outline" className="mt-4">Back to Cases</Button>
        </Link>
      </div>
    );
  }

  const slaTime = ticket.sla_deadline ? new Date(ticket.sla_deadline) : null;
  const isOverdue = slaTime && slaTime < new Date() && ticket.status !== 'resolved' && ticket.status !== 'closed';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Link to="/consultant/cases">
          <Button variant="ghost" size="icon" className="rounded-xl">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground truncate">{ticket.title}</h1>
          <p className="text-xs text-muted-foreground">
            Created {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
          </p>
        </div>
        <Badge className={`${statusColors[ticket.status || 'new']} text-xs`}>
          {(ticket.status || 'new').replace(/_/g, ' ')}
        </Badge>
      </div>

      {/* Quick Actions: Documents · Remote Access · Request Meeting */}
      {ticket.consultant_id && (
        <TicketQuickActions
          ticketId={ticket.id}
          role="consultant"
          onScheduleMeeting={() => setMeetingOpen(true)}
        />
      )}

      {/* Remote Access Status */}
      {ticket.consultant_id && (
        <RemoteAccessStatusPanel ticketId={ticket.id} role="consultant" />
      )}

      {/* Inline Schedule Meeting Dialog */}
      <ScheduleMeetingDialog
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        ticketId={ticket.id}
        ticketTitle={ticket.title}
        clientId={ticket.client_id}
        consultantId={ticket.consultant_id}
      />

      {/* Details Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Case Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Tag className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">SAP Module:</span>
              <span className="font-medium">{ticket.sap_module}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Urgency:</span>
              <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency || 'medium']}`}>
                {ticket.urgency || 'medium'}
              </Badge>
            </div>
            {slaTime && (
              <div className={`flex items-center gap-2 text-sm ${isOverdue ? 'text-red-600' : ''}`}>
                <Clock className="w-4 h-4" />
                <span className="text-muted-foreground">SLA Deadline:</span>
                <span className={isOverdue ? 'font-semibold text-red-600' : 'font-medium'}>
                  {format(slaTime, 'MMM d, yyyy h:mm a')}
                  {isOverdue && ' (Overdue)'}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Created:</span>
              <span className="font-medium">{format(new Date(ticket.created_at), 'MMM d, yyyy')}</span>
            </div>
            {ticket.preferred_language && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Language:</span>
                <span className="font-medium">{ticket.preferred_language}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {ticket.description || 'No description provided.'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Client System Landscape — gated behind NDA */}
      {clientProfile && !ndaSigned && (
        <Card className="rounded-2xl border-border/50 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <Lock className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">NDA Required</h3>
              <p className="text-xs text-muted-foreground max-w-sm mt-1">
                You must sign a Non-Disclosure Agreement before accessing the client's system landscape, server details, and confidential infrastructure information.
              </p>
            </div>
            <Button
              onClick={() => setNdaModalOpen(true)}
              className="gap-2 gradient-primary border-0"
              size="sm"
            >
              <ShieldCheck className="w-4 h-4" />
              Sign NDA & Disclaimer
            </Button>
          </CardContent>
        </Card>
      )}
      {clientProfile && ndaSigned && (
        <Card className="rounded-2xl border-border/50 border-green-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              <Building2 className="w-4 h-4 text-primary" />
              Client System Landscape
              <Badge variant="outline" className="text-[10px] gap-1 text-green-600 border-green-500/30"><ShieldCheck className="w-3 h-3" /> NDA Signed</Badge>
              {clientProfile.company_name && <span className="text-muted-foreground font-normal">— {clientProfile.company_name}</span>}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground ms-auto"
                onClick={async () => {
                  if (ndaStatus && 'nda_content' in ndaStatus) {
                    const { data: profile } = await supabase.from('profiles').select('display_name').eq('user_id', (await supabase.auth.getUser()).data.user?.id || '').maybeSingle();
                    await exportNDAAsPDF({
                      ndaContent: (ndaStatus as any).nda_content || '',
                      signatureData: (ndaStatus as any).signature_data || '',
                      signatureType: (ndaStatus as any).signature_type || 'type',
                      signedAt: (ndaStatus as any).signed_at,
                      consultantName: profile?.display_name || 'Consultant',
                      clientName: clientProfile?.company_name || 'Client',
                    });
                  }
                }}
              >
                <Download className="w-3 h-3 me-0.5" /> Export NDA
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Company & SAP Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {clientProfile.industry && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Industry</p>
                  <p className="text-sm font-medium">{clientProfile.industry}</p>
                </div>
              )}
              {clientProfile.company_size && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Company Size</p>
                  <p className="text-sm font-medium">{clientProfile.company_size} employees</p>
                </div>
              )}
              {(clientProfile as any).sap_product && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Package className="w-3 h-3" /> SAP Product</p>
                  <p className="text-sm font-medium">{(clientProfile as any).sap_product} {(clientProfile as any).sap_version && `(${(clientProfile as any).sap_version})`}</p>
                </div>
              )}
              {clientProfile.sap_hosting_type && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Server className="w-3 h-3" /> Hosting</p>
                  <p className="text-sm font-medium capitalize">{clientProfile.sap_hosting_type}</p>
                </div>
              )}
              {(clientProfile as any).sap_database_type && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><HardDrive className="w-3 h-3" /> Database</p>
                  <p className="text-sm font-medium">{(clientProfile as any).sap_database_type}</p>
                </div>
              )}
              {(clientProfile as any).sap_os_type && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Cpu className="w-3 h-3" /> OS</p>
                  <p className="text-sm font-medium">{(clientProfile as any).sap_os_type}</p>
                </div>
              )}
              {(clientProfile as any).sap_support_pack && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Support Pack</p>
                  <p className="text-sm font-medium">{(clientProfile as any).sap_support_pack}</p>
                </div>
              )}
              {(clientProfile as any).sap_go_live_date && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" /> Go-Live</p>
                  <p className="text-sm font-medium">{format(new Date((clientProfile as any).sap_go_live_date), 'MMM yyyy')}</p>
                </div>
              )}
              {(clientProfile as any).sap_user_count != null && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Users</p>
                  <p className="text-sm font-medium">{(clientProfile as any).sap_user_count.toLocaleString()}</p>
                </div>
              )}
              {(clientProfile as any).sap_custom_dev_count != null && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Code className="w-3 h-3" /> Custom Dev (Z/Y)</p>
                  <p className="text-sm font-medium">{(clientProfile as any).sap_custom_dev_count.toLocaleString()}</p>
                </div>
              )}
            </div>

            {/* SAP Modules */}
            {clientProfile.sap_modules && clientProfile.sap_modules.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">SAP Modules</p>
                <div className="flex flex-wrap gap-1.5">
                  {clientProfile.sap_modules.map(m => (
                    <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* System IDs */}
            {clientProfile.sap_system_ids && clientProfile.sap_system_ids.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1"><Database className="w-3 h-3" /> System IDs</p>
                <div className="flex flex-wrap gap-1.5">
                  {clientProfile.sap_system_ids.map(s => (
                    <Badge key={s} variant="outline" className="text-[10px] font-mono">{s}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Interfaces & Tools */}
            {(clientProfile as any).sap_interfaces?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1"><Link2 className="w-3 h-3" /> Interfaces / Middleware</p>
                <div className="flex flex-wrap gap-1.5">
                  {(clientProfile as any).sap_interfaces.map((i: string) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{i}</Badge>
                  ))}
                </div>
              </div>
            )}
            {(clientProfile as any).sap_third_party_tools?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Third-Party Tools</p>
                <div className="flex flex-wrap gap-1.5">
                  {(clientProfile as any).sap_third_party_tools.map((t: string) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Landscape notes */}
            {(clientProfile as any).sap_landscape_notes && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Landscape Notes</p>
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">{(clientProfile as any).sap_landscape_notes}</p>
              </div>
            )}

            {clientProfile.sap_landscape && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Landscape Summary</p>
                <p className="text-xs text-muted-foreground">{clientProfile.sap_landscape}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{sessions?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Sessions</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{documents?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Documents</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {(sessions || []).reduce((sum, s) => sum + (s.duration_minutes || 0), 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total Minutes</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{timeline.length}</p>
            <p className="text-xs text-muted-foreground">Events</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline / History */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Case History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No activity yet.</p>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-5">
                {timeline.map((event) => {
                  const Icon = event.icon;
                  return (
                    <div key={event.id} className="flex gap-4 relative">
                      <div className={`w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center shrink-0 z-10 ${event.color}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 pb-1">
                        <p className="text-sm font-medium text-foreground">{event.title}</p>
                        {event.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {event.date ? formatDistanceToNow(new Date(event.date), { addSuffix: true }) : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {/* NDA Signing Modal */}
      {consultantData?.id && ticket?.client_id && (
        <NDASigningModal
          open={ndaModalOpen}
          onOpenChange={setNdaModalOpen}
          consultantId={consultantData.id}
          clientId={ticket.client_id}
          clientName={clientProfile?.company_name || 'Client'}
          onSigned={() => {
            queryClient.invalidateQueries({ queryKey: ['case-nda-status'] });
            setNdaModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
