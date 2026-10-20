import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsultantMatchRequests, useRespondToMatch } from '@/hooks/useMatchRequests';
import { Check, X, Inbox, Clock, ShieldCheck, FileSignature, Download, FileText, HelpCircle, PauseCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { toastWithLocationFix } from '@/lib/locationErrors';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAssignmentPolicy } from '@/hooks/useAssignmentPolicy';
import { policyText, timeLeftLabel } from '../../../supabase/functions/_shared/assignmentPolicy';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import NDASigningModal from '@/components/consultant/NDASigningModal';
import { exportNDAAsPDF } from '@/lib/ndaPdfExport';
import { useAssignmentInfoReady, useInfoRequests } from '@/hooks/useAssignmentInfo';
import DecisionPreviewDialog from '@/components/consultant/assignment/DecisionPreviewDialog';
import RequestInfoDialog from '@/components/consultant/assignment/RequestInfoDialog';
import DeclineReasonDialog from '@/components/consultant/assignment/DeclineReasonDialog';
import InfoThread from '@/components/consultant/assignment/InfoThread';
import { infoRequestBlock } from '../../../supabase/functions/_shared/assignmentInfo';

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
  expired: { label: 'No response', className: 'bg-muted text-muted-foreground' },
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
  const infoReady = useAssignmentInfoReady();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [askId, setAskId] = useState<string | null>(null);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const pendingIds = (requests || []).filter((r: any) => r.status === 'pending' || r.info_requests_count > 0).map((r: any) => r.id as string);
  const { data: infoRows = [] } = useInfoRequests({ requestIds: pendingIds }, infoReady);
  const infoFor = (id: string) => infoRows.filter((r) => r.request_id === id);

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
        .select('client_id, id, signed_at, signature_data, signature_type, nda_content, revoked_at, client_signature_data, client_signature_type, client_signer_name, client_signed_at')
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
      onError: (e) => toastWithLocationFix(e, 'Failed to respond. Please try again.', { useMessage: false }),
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
    if (infoReady) { setDeclineId(requestId); return; }
    respond.mutate({ requestId, status: 'rejected' }, {
      onSuccess: () => toast.success('Match declined.'),
      onError: (e) => toastWithLocationFix(e, 'Failed to respond. Please try again.', { useMessage: false }),
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
      clientSignatureData: nda.client_signature_data,
      clientSignatureType: nda.client_signature_type,
      clientSignerName: nda.client_signer_name,
      clientSignedAt: nda.client_signed_at,
      agreementId: nda.id,
    });
  };

  // Popup / e-mail links: ?accept=<id> continues an accept (NDA first when needed), ?request=<id> highlights the card.
  const [params, setParams] = useSearchParams();
  const policy = useAssignmentPolicy();
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const handledAccept = useRef<string | null>(null);
  const focusId = params.get('request') || params.get('accept');
  useEffect(() => {
    const id = params.get('accept');
    if (!id || handledAccept.current === id || !requests || !ticketClientMap || !ndaMap) return;
    const req = requests.find((r: any) => r.id === id && r.status === 'pending');
    handledAccept.current = id;
    const next = new URLSearchParams(params); next.delete('accept'); next.set('request', id); setParams(next, { replace: true });
    if (req) handleAccept(req.id, req.ticket_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, requests, ticketClientMap, ndaMap]);
  // E-mail link "Open ticket description": ?request=<id>&preview=1 opens the preview once.
  const handledPreview = useRef<string | null>(null);
  useEffect(() => {
    const id = params.get('request');
    if (!infoReady || !id || params.get('preview') !== '1' || handledPreview.current === id || !requests) return;
    handledPreview.current = id;
    const next = new URLSearchParams(params); next.delete('preview'); setParams(next, { replace: true });
    if (requests.some((r: any) => r.id === id && r.status === 'pending')) setPreviewId(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, requests, infoReady]);
  useEffect(() => {
    if (focusId) document.getElementById(`request-${focusId}`)?.scrollIntoView({ block: 'center' });
  }, [focusId, requests]);

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

      <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">{policyText(policy, lang, { info: infoReady })}</p>

      <div className="flex gap-1.5 flex-wrap">
        {['all', 'pending', 'accepted', 'rejected', 'expired'].map(s => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? 'default' : 'outline'}
            className={`text-xs rounded-full h-8 ${filter === s ? 'gradient-primary border-0' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? 'All' : s === 'expired' ? 'No response' : s.charAt(0).toUpperCase() + s.slice(1)}
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
            const paused = req.status === 'pending' && !!req.info_paused_at;
            const badge = paused
              ? { label: t('assignment_info.status_pending_info', 'Pending information'), className: 'bg-sky-100 text-sky-700' }
              : statusBadge[req.status] || statusBadge.pending;
            const thread = infoFor(req.id);
            const askBlock = infoRequestBlock(req.status, thread);
            const askBlockedText = askBlock === 'open'
              ? t('assignment_info.block_open', "Waiting for the client's answer to your question.")
              : askBlock === 'limit' ? t('assignment_info.block_limit', 'You have asked 3 times on this request.') : null;
            const clientInfo = ticketClientMap?.get(req.ticket_id);
            const hasNda = clientInfo ? ndaMap?.has(clientInfo.client_id) : false;
            return (
              <Card key={req.id} id={`request-${req.id}`} className={`rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all ${focusId === req.id ? 'ring-2 ring-primary' : ''}`}>
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
                      {req.status === 'pending' && !paused && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                          <Clock className="w-3 h-3" />
                          Awaiting your response{req.response_due_at ? ` · ${timeLeftLabel(Date.parse(req.response_due_at), Date.now(), lang)}` : ''}
                        </div>
                      )}
                      {paused && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-sky-700 dark:text-sky-400">
                          <PauseCircle className="w-3 h-3" aria-hidden="true" />
                          {t('assignment_info.paused_consultant', "Waiting for the client's answer · reply clock paused")}
                        </div>
                      )}
                      {infoReady && <InfoThread rows={thread} />}
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
                        <div className="flex flex-wrap items-center justify-end gap-2 mt-1">
                          {infoReady && (
                            <>
                              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreviewId(req.id)}>
                                <FileText className="w-3.5 h-3.5 me-1" aria-hidden="true" /> {t('assignment_info.preview_button', 'Open ticket description')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => setAskId(req.id)}
                                disabled={!!askBlockedText}
                                title={askBlockedText ?? undefined}
                              >
                                <HelpCircle className="w-3.5 h-3.5 me-1" aria-hidden="true" /> {t('assignment_info.ask_button', 'Request more information')}
                              </Button>
                            </>
                          )}
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

      {(() => {
        const req: any = (requests || []).find((r: any) => r.id === previewId);
        const thread = previewId ? infoFor(previewId) : [];
        const blocked = req ? infoRequestBlock(req.status, thread) : 'not_pending';
        const actions = req && req.status === 'pending' ? (
          <>
            <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => { setPreviewId(null); setDeclineId(req.id); }}>
              {t('assignment_policy.decline', 'Decline')}
            </Button>
            <Button variant="outline" disabled={!!blocked} onClick={() => { setPreviewId(null); setAskId(req.id); }}>
              {t('assignment_info.ask_button', 'Request more information')}
            </Button>
            <Button className="gradient-primary border-0" disabled={respond.isPending} onClick={() => { setPreviewId(null); handleAccept(req.id, req.ticket_id); }}>
              {t('assignment_policy.accept', 'Accept')}
            </Button>
          </>
        ) : null;
        return <DecisionPreviewDialog requestId={previewId} onClose={() => setPreviewId(null)} actions={actions} />;
      })()}
      <RequestInfoDialog requestId={askId} used={askId ? infoFor(askId).length : 0} onClose={() => setAskId(null)} />
      <DeclineReasonDialog requestId={declineId} ready={infoReady} onClose={() => setDeclineId(null)} />

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
