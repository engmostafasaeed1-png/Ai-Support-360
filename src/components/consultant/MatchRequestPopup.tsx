import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useRespondToMatch } from '@/hooks/useMatchRequests';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useAssignmentPolicy } from '@/hooks/useAssignmentPolicy';
import { toastWithLocationFix } from '@/lib/locationErrors';
import { readAcks, sessionIdOf, writeAck } from '@/lib/assignmentPopupAcks';
import { LocationBlockedNotice, useLocationBlocked } from '@/components/consultant/LocationBanner';
import { PolicyBlockedNotice, usePolicyBlocked } from '@/components/consultant/policy/PolicyBanner';
import AssignmentRequestDialog, { type AssignmentPopupItem } from '@/components/consultant/AssignmentRequestDialog';
import DecisionPreviewDialog from '@/components/consultant/assignment/DecisionPreviewDialog';
import RequestInfoDialog from '@/components/consultant/assignment/RequestInfoDialog';
import DeclineReasonDialog from '@/components/consultant/assignment/DeclineReasonDialog';
import { useAssignmentInfoReady, useInfoRequests } from '@/hooks/useAssignmentInfo';
import { Button } from '@/components/ui/button';
import { nextPopup, popupKey, type PopupRequest } from '../../../supabase/functions/_shared/assignmentPolicy';
import { infoRequestBlock } from '../../../supabase/functions/_shared/assignmentInfo';

type PendingRequest = PopupRequest & AssignmentPopupItem & { ticket_id: string; client_id: string | null };

const QUERY_KEY = ['assignment-popup-requests'];

/** Pending assignment requests of the signed-in consultant, with the ticket facts the popup may show (no client contact data). */
async function loadPending(): Promise<PendingRequest[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: c } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
  if (!c) return [];
  // '*' keeps working before and after docs/sql/assignment-response.sql adds the deadline columns.
  const { data: rows, error } = await supabase.from('ticket_match_requests').select('*').eq('consultant_id', c.id).eq('status', 'pending');
  if (error) throw error;
  // Requests from before the response policy (no deadline) only pop up during their first week.
  const weekAgo = Date.now() - 7 * 24 * 3_600_000;
  const list = ((rows ?? []) as Array<Record<string, any>>).filter((r) => r.response_due_at || Date.parse(r.created_at) >= weekAgo);
  if (list.length === 0) return [];
  const ticketIds = [...new Set(list.map((r) => r.ticket_id as string))];
  const [{ data: tickets }, { data: rates }] = await Promise.all([
    supabase.from('tickets').select('id, title, sap_module, sap_modules, urgency, client_id, critical_response').in('id', ticketIds),
    supabase.from('ticket_rates').select('ticket_id, hourly_rate, currency, status, created_at').eq('consultant_id', c.id).in('ticket_id', ticketIds),
  ]);
  const tMap = new Map((tickets ?? []).map((t: any) => [t.id, t]));
  const rMap = new Map<string, any>();
  [...(rates ?? [])].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
    .forEach((r: any) => { if (r.status !== 'rejected' && !rMap.has(r.ticket_id)) rMap.set(r.ticket_id, r); });
  return list.map((r) => {
    const t: any = tMap.get(r.ticket_id) ?? {};
    const rate = rMap.get(r.ticket_id);
    const areas: string[] = Array.isArray(t.sap_modules) ? t.sap_modules : [];
    return {
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      response_due_at: r.response_due_at ?? null,
      reminders_sent: r.reminders_sent ?? 0,
      extended_at: r.extended_at ?? null,
      info_paused_at: r.info_paused_at ?? null,
      info_resumed_at: r.info_resumed_at ?? null,
      info_answered: !!r.info_resumed_at,
      ticket_id: r.ticket_id,
      client_id: t.client_id ?? null,
      ticket_title: t.title || 'New request',
      sap_area: t.sap_module || areas.join(', ') || 'SAP',
      urgency: t.urgency || 'medium',
      critical: r.is_critical === true || t.urgency === 'critical' || t.critical_response === true,
      bid: r.response_kind === 'bid' || String(r.message ?? '').startsWith('Private bid invitation'),
      proposed_rate: rate ? Number(rate.hourly_rate) || null : null,
      currency: rate?.currency ?? null,
    };
  });
}

/**
 * Feature L popup: shown on every consultant portal page for each pending assignment request, one at a time, until it is
 * answered or acknowledged ("Remind me later"); it returns after every reminder, after an extension and at the next sign-in.
 * Accepting keeps the existing NDA step (consultants without a signed NDA for the client finish on the Requests page).
 */
export default function MatchRequestPopup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isGuest } = useGuestMode();
  const { signedIn } = useSessionReady();
  const policy = useAssignmentPolicy();
  const respond = useRespondToMatch();
  const locationBlocked = useLocationBlocked();
  const policyBlocked = usePolicyBlocked();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [checkingNda, setCheckingNda] = useState(false);
  const infoReady = useAssignmentInfoReady();
  // Only one window at a time: the popup steps aside while the preview, question or decline window is open.
  const [sub, setSub] = useState<null | { kind: 'preview' | 'ask' | 'decline'; id: string }>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSessionId(sessionIdOf(data.session)); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessionId(sessionIdOf(s)));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { setAcked(readAcks(sessionId)); }, [sessionId]);

  const enabled = signedIn && !isGuest;
  const { data: pending = [] } = useQuery({ queryKey: QUERY_KEY, queryFn: loadPending, enabled, refetchInterval: 60_000, retry: false });

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel('assignment-popup')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_match_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [enabled, queryClient]);

  const current = useMemo(() => nextPopup(pending, acked), [pending, acked]);
  const { data: infoRows = [] } = useInfoRequests({ requestIds: current ? [current.id] : [] }, infoReady && !!current);
  const askBlock = current ? infoRequestBlock(current.status, infoRows) : null;
  const askBlockedText = askBlock === 'open'
    ? t('assignment_info.block_open', "Waiting for the client's answer to your question.")
    : askBlock === 'limit' ? t('assignment_info.block_limit', 'You have asked 3 times on this request.') : null;
  const waiting = useMemo(() => pending.filter((r) => r.id !== current?.id && !acked.has(popupKey(r))).length, [pending, acked, current]);

  useEffect(() => {
    if (!current) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    setNow(Date.now());
    return () => window.clearInterval(id);
  }, [current]);

  const acknowledge = useCallback(() => {
    if (current) setAcked(writeAck(sessionId, popupKey(current)));
  }, [current, sessionId]);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['consultant-match-requests'] });
  };

  const answer = (status: 'accepted' | 'rejected') => {
    if (!current) return;
    respond.mutate({ requestId: current.id, status }, {
      onSuccess: () => {
        toast.success(status === 'accepted' ? t('assignment_policy.accepted', 'Request accepted.') : t('assignment_policy.declined', 'Request declined.'));
        acknowledge();
        done();
      },
      onError: (e) => toastWithLocationFix(e, t('assignment_policy.answer_failed', 'Your answer could not be saved. Please try again.'), { useMessage: false }),
    });
  };

  const accept = async () => {
    if (!current) return;
    // Same NDA gate as the Requests page: without a signed NDA for this client the answer is finished there.
    setCheckingNda(true);
    let hasNda = false;
    try {
      const { data: c } = await supabase.from('consultants').select('id').eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '').maybeSingle();
      if (c && current.client_id) {
        const { data } = await supabase.from('nda_agreements').select('id').eq('consultant_id', c.id).eq('client_id', current.client_id).is('revoked_at', null).limit(1);
        hasNda = (data ?? []).length > 0;
      }
    } finally {
      setCheckingNda(false);
    }
    if (hasNda) {
      answer('accepted');
      return;
    }
    acknowledge();
    navigate(`/consultant/requests?accept=${current.id}`);
  };

  const view = () => {
    if (!current) return;
    acknowledge();
    navigate(`/consultant/requests?request=${current.id}`);
  };

  if (!enabled) return null;

  const subId = sub?.id ?? null;
  const previewActions = current && sub?.kind === 'preview' ? (
    <>
      <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => setSub({ kind: 'decline', id: current.id })}>
        {t('assignment_policy.decline', 'Decline')}
      </Button>
      <Button variant="outline" disabled={!!askBlockedText} title={askBlockedText ?? undefined} onClick={() => setSub({ kind: 'ask', id: current.id })}>
        {t('assignment_info.ask_button', 'Request more information')}
      </Button>
      <Button className="gradient-primary border-0" disabled={respond.isPending || checkingNda || locationBlocked || policyBlocked} onClick={() => { setSub(null); void accept(); }}>
        {t('assignment_policy.accept', 'Accept')}
      </Button>
    </>
  ) : null;

  return (
    <>
    <DecisionPreviewDialog requestId={sub?.kind === 'preview' ? subId : null} onClose={() => setSub(null)} actions={previewActions} />
    <RequestInfoDialog requestId={sub?.kind === 'ask' ? subId : null} used={infoRows.length} onClose={() => setSub(null)} onSent={() => { acknowledge(); done(); }} />
    <DeclineReasonDialog
      requestId={sub?.kind === 'decline' ? subId : null}
      ready={infoReady}
      onClose={() => setSub(null)}
      onDeclined={() => { acknowledge(); done(); }}
    />
    <AssignmentRequestDialog
      item={sub ? null : current}
      infoReady={infoReady}
      onPreview={() => current && setSub({ kind: 'preview', id: current.id })}
      onAskInfo={() => current && setSub({ kind: 'ask', id: current.id })}
      askBlockedText={askBlockedText}
      policy={policy}
      now={now}
      waitingCount={waiting}
      busy={respond.isPending || checkingNda}
      acceptDisabled={locationBlocked || policyBlocked}
      onAccept={() => void accept()}
      onDecline={() => (infoReady && current ? setSub({ kind: 'decline', id: current.id }) : answer('rejected'))}
      onView={view}
      onLater={acknowledge}
    >
      <LocationBlockedNotice />
      <PolicyBlockedNotice />
    </AssignmentRequestDialog>
    </>
  );
}
