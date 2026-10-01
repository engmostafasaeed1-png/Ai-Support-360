import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsultantMatchRequests, useRespondToMatch } from '@/hooks/useMatchRequests';
import { Check, X, Inbox, Clock, ShieldCheck, FileSignature, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import NDASigningModal from '@/components/consultant/NDASigningModal';
import { exportNDAAsPDF } from '@/lib/ndaPdfExport';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusBadge: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700' },
  accepted: { label: 'Accepted', className: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
};

export default function RequestsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: requests, isLoading } = useConsultantMatchRequests();
  const respond = useRespondToMatch();
  const [filter, setFilter] = useState<string>('all');
  const [ndaModalOpen, setNdaModalOpen] = useState(false);
  const [pendingAcceptId, setPendingAcceptId] = useState<string | null>(null);
  const [ndaClientId, setNdaClientId] = useState<string | null>(null);
  const [ndaClientName, setNdaClientName] = useState<string>('');

  // Get current consultant
  const { data: consultantData } = useQuery({
    queryKey: ['my-consultant-id'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      return data;
    },
  });

  // Get NDA status for all unique client_ids from ticket data
  const { data: ndaMap } = useQuery({
    queryKey: ['consultant-nda-map', consultantData?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('nda_agreements')
        .select('client_id, id, signed_at, signature_data, signature_type, nda_content, revoked_at')
        .eq('consultant_id', consultantData!.id)
        .is('revoked_at', null)
        .order('signed_at', { ascending: false });
      const map = new Map<string, any>();
      (data || []).forEach(a => { if (!map.has(a.client_id)) map.set(a.client_id, a); });
      return map;
    },
    enabled: !!consultantData?.id,
  });

  // Get ticket → client_id mapping for enrichment
  const { data: ticketClientMap } = useQuery({
    queryKey: ['request-ticket-clients', requests?.map(r => r.ticket_id)],
    queryFn: async () => {
      const ticketIds = (requests || []).map(r => r.ticket_id);
      if (!ticketIds.length) return new Map<string, { client_id: string; client_name: string }>();
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, client_id')
        .in('id', ticketIds);
      const clientIds = [...new Set((tickets || []).map(t => t.client_id))];
      const { data: profiles } = await supabase
        .from('profile_directory')
        .select('user_id, display_name')
        .in('user_id', clientIds.length ? clientIds : ['none']);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p.display_name]));
      const map = new Map<string, { client_id: string; client_name: string }>();
      (tickets || []).forEach(t => map.set(t.id, { client_id: t.client_id, client_name: profileMap.get(t.client_id) || 'Client' }));
      return map;
    },
    enabled: !!requests && requests.length > 0,
  });

  const handleAccept = (requestId: string, ticketId: string) => {
    const clientInfo = ticketClientMap?.get(ticketId);
    const clientId = clientInfo?.client_id;
    if (!clientId) return;

    const hasNda = ndaMap?.has(clientId);
    if (!hasNda) {
      // Need NDA first
      setPendingAcceptId(requestId);
      setNdaClientId(clientId);
      setNdaClientName(clientInfo?.client_name || 'Client');
      setNdaModalOpen(true);
      return;
    }

    // NDA already signed, proceed
    doAccept(requestId);
  };

  const doAccept = (requestId: string) => {
    respond.mutate({ requestId, status: 'accepted' }, {
      onSuccess: () => toast.success('Match accepted!'),
      onError: () => toast.error('Failed to respond. Please try again.'),
    });
  };

  const handleNdaSigned = () => {
    queryClient.invalidateQueries({ queryKey: ['consultant-nda-map'] });
    setNdaModalOpen(false);
    if (pendingAcceptId) {
      doAccept(pendingAcceptId);
      setPendingAcceptId(null);
    }
  };

  const handleDecline = (requestId: string) => {
    respond.mutate({ requestId, status: 'rejected' }, {
      onSuccess: () => toast.success('Match declined.'),
      onError: () => toast.error('Failed to respond. Please try again.'),
    });
  };

  const handleExportNDA = async (ticketId: string) => {
    const clientInfo = ticketClientMap?.get(ticketId);
    if (!clientInfo) return;
    const nda = ndaMap?.get(clientInfo.client_id);
    if (!nda) return;
    const { data: profile } = await supabase.from('profiles').select('display_name').eq('user_id', (await supabase.auth.getUser()).data.user?.id || '').maybeSingle();
    await exportNDAAsPDF({
      ndaContent: nda.nda_content || '',
      signatureData: nda.signature_data || '',
      signatureType: nda.signature_type || 'type',
      signedAt: nda.signed_at,
      consultantName: profile?.display_name || 'Consultant',
      clientName: clientInfo.client_name,
    });
  };

  const filtered = (requests || []).filter(r => filter === 'all' || r.status === filter);
  const pendingCount = (requests || []).filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Match Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and respond to ticket match invitations.
          {pendingCount > 0 && <span className="text-amber-600 font-medium ms-1">({pendingCount} pending)</span>}
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {['all', 'pending', 'accepted', 'rejected'].map(s => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? 'default' : 'outline'}
            className={`text-xs rounded-full h-8 ${filter === s ? 'gradient-primary border-0' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No match requests found.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((req: any) => {
            const badge = statusBadge[req.status] || statusBadge.pending;
            const clientInfo = ticketClientMap?.get(req.ticket_id);
            const hasNda = clientInfo ? ndaMap?.has(clientInfo.client_id) : false;
            return (
              <Card key={req.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{req.ticket_title}</h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                        <span>{req.sap_module}</span>
                        <span className="text-xs">•</span>
                        <span>{new Date(req.created_at).toLocaleDateString()}</span>
                        {clientInfo && (
                          <>
                            <span className="text-xs">•</span>
                            <span>{clientInfo.client_name}</span>
                          </>
                        )}
                      </div>
                      {req.message && (
                        <p className="text-xs text-muted-foreground mt-2 italic">"{req.message}"</p>
                      )}
                      {req.status === 'pending' && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                          <Clock className="w-3 h-3" />
                          Awaiting your response
                        </div>
                      )}
                      {/* NDA status indicator */}
                      {hasNda && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-green-600">
                          <ShieldCheck className="w-3 h-3" />
                          NDA Signed
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() => handleExportNDA(req.ticket_id)}
                          >
                            <Download className="w-3 h-3 me-0.5" /> PDF
                          </Button>
                        </div>
                      )}
                      {req.status === 'pending' && !hasNda && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                          <FileSignature className="w-3 h-3" />
                          NDA required before accepting
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={`text-[10px] ${urgencyColors[req.urgency]}`}>
                          {req.urgency}
                        </Badge>
                        <Badge variant="secondary" className={`text-[10px] ${badge.className}`}>
                          {badge.label}
                        </Badge>
                      </div>
                      {req.status === 'pending' && (
                        <div className="flex items-center gap-2 mt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => handleDecline(req.id)}
                            disabled={respond.isPending}
                          >
                            <X className="w-3.5 h-3.5 me-1" /> Decline
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 text-xs gradient-primary border-0"
                            onClick={() => handleAccept(req.id, req.ticket_id)}
                            disabled={respond.isPending}
                          >
                            {hasNda ? <Check className="w-3.5 h-3.5 me-1" /> : <FileSignature className="w-3.5 h-3.5 me-1" />}
                            {hasNda ? 'Accept' : 'Sign NDA & Accept'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* NDA Modal */}
      {consultantData?.id && ndaClientId && (
        <NDASigningModal
          open={ndaModalOpen}
          onOpenChange={(open) => {
            setNdaModalOpen(open);
            if (!open) { setPendingAcceptId(null); setNdaClientId(null); }
          }}
          consultantId={consultantData.id}
          clientId={ndaClientId}
          clientName={ndaClientName}
          onSigned={handleNdaSigned}
        />
      )}
    </div>
  );
}
