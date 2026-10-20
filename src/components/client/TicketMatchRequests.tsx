import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Clock, Gavel, Hourglass, Loader2, Send, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import ConsultantLocation from '@/components/consultant/ConsultantLocation';
import { extendAssignmentRequest, useAssignmentPolicy } from '@/hooks/useAssignmentPolicy';
import { clientRequestView, durationLabel, timeLeftLabel } from '../../../supabase/functions/_shared/assignmentPolicy';
import ResponsivenessChip from '@/components/consultant/ResponsivenessChip';

interface Props {
  ticketId: string;
  clientId: string;
  /** The ticket is resolved or closed: no more "Wait longer". */
  ticketClosed?: boolean;
  /** "Invite another": opens the best-match picker. */
  onInviteAnother?: () => void;
  /** "Open for bids": opens the bidding dialog. */
  onOpenBids?: () => void;
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-muted text-muted-foreground',
  expired: 'bg-orange-100 text-orange-700',
};

type Row = {
  id: string; consultant_id: string; status: string; created_at: string;
  response_due_at?: string | null; extended_at?: string | null;
  consultant_name: string; city: string | null; country: string | null;
};

export default function TicketMatchRequests({ ticketId, clientId, ticketClosed = false, onInviteAnother, onOpenBids }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const queryClient = useQueryClient();
  const policy = useAssignmentPolicy();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmWait, setConfirmWait] = useState<Row | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [params, setParams] = useSearchParams();
  const handledLink = useRef<string | null>(null);

  const { data: me } = useQuery({
    queryKey: ['current-user-id-match-requests'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });

  const { data: requests, isLoading } = useQuery({
    queryKey: ['ticket-match-requests', ticketId],
    queryFn: async (): Promise<Row[]> => {
      // '*' so the reply deadline shows once docs/sql/assignment-response.sql adds it (and nothing breaks before).
      const { data, error } = await supabase
        .from('ticket_match_requests')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, any>>;
      const names = new Map<string, string>();
      const places = new Map<string, { city: string | null; country: string | null }>();
      const consultantIds = [...new Set(rows.map((r) => r.consultant_id as string))];
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase.from('consultants').select('id, user_id, city, country').in('id', consultantIds);
        (consultants ?? []).forEach((c: any) => places.set(c.id, { city: c.city ?? null, country: c.country ?? null }));
        const userIds = (consultants ?? []).map((c) => c.user_id);
        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from('profile_directory').select('user_id, display_name').in('user_id', userIds);
          const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name || 'Consultant']));
          (consultants ?? []).forEach((c) => names.set(c.id, byUser.get(c.user_id) || 'Consultant'));
        }
      }
      return rows.map((r) => ({
        id: r.id, consultant_id: r.consultant_id, status: String(r.status), created_at: r.created_at,
        response_due_at: r.response_due_at ?? null, extended_at: r.extended_at ?? null,
        consultant_name: names.get(r.consultant_id) || 'Consultant',
        city: places.get(r.consultant_id)?.city ?? null, country: places.get(r.consultant_id)?.country ?? null,
      }));
    },
    enabled: !!ticketId,
  });

  const anyWaiting = (requests ?? []).some((r) => r.status === 'pending' && r.response_due_at);
  useEffect(() => {
    if (!anyWaiting) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [anyWaiting]);

  const isOwner = !!me && me === clientId;

  // E-mail links: ?noresponse=<id>&action=invite|bids|wait
  useEffect(() => {
    const id = params.get('noresponse');
    const action = params.get('action');
    if (!id || !requests || !isOwner || handledLink.current === `${id}:${action}`) return;
    handledLink.current = `${id}:${action}`;
    const row = requests.find((r) => r.id === id);
    document.getElementById(`match-request-${id}`)?.scrollIntoView({ block: 'center' });
    const next = new URLSearchParams(params); next.delete('action'); setParams(next, { replace: true });
    if (action === 'invite') onInviteAnother?.();
    else if (action === 'bids') onOpenBids?.();
    else if (action === 'wait' && row && clientRequestView(row, ticketClosed).kind === 'no_response') setConfirmWait(row);
  }, [params, requests, isOwner, ticketClosed, onInviteAnother, onOpenBids, setParams]);

  const withdraw = async (id: string) => {
    setBusyId(id);
    const { data, error } = await supabase
      .from('ticket_match_requests')
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .select('id');
    setBusyId(null);
    if (error || !data || data.length === 0) {
      toast.error(error?.message || 'The request could not be withdrawn');
      return;
    }
    toast.success('Request withdrawn. The consultant has been told.');
    queryClient.invalidateQueries({ queryKey: ['ticket-match-requests', ticketId] });
  };

  const waitLonger = async (row: Row) => {
    setBusyId(row.id);
    try {
      await extendAssignmentRequest(row.id);
      toast.success(t('assignment_client.extended', '{{name}} has {{time}} more to reply.', { name: row.consultant_name, time: durationLabel(policy.extend, lang, false) }));
      queryClient.invalidateQueries({ queryKey: ['ticket-match-requests', ticketId] });
    } catch {
      toast.error(t('assignment_client.extend_failed', 'More time could not be given. The request may already have had more time once.'));
    } finally {
      setBusyId(null);
      setConfirmWait(null);
    }
  };

  if (isLoading) return <Skeleton className="h-16 rounded-2xl" />;
  if (!requests || requests.length === 0) return null;

  const statusLabel = (s: string) =>
    s === 'expired' ? t('assignment_client.status_expired', 'No response')
      : s === 'pending' ? t('assignment_client.status_pending', 'Waiting')
        : s;

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" aria-hidden="true" /> {t('assignment_client.title', 'Sent match requests')}
        </p>
        <div className="space-y-2">
          {requests.map((r) => {
            const view = clientRequestView(r, ticketClosed);
            return (
              <div
                key={r.id}
                id={`match-request-${r.id}`}
                className={`rounded-xl border p-3 space-y-2 ${view.kind === 'no_response' ? 'border-orange-300/70 bg-orange-50/50 dark:bg-orange-950/20' : 'border-border/40'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.consultant_name}</p>
                    <ConsultantLocation audience="client" city={r.city} country={r.country} className="text-[11px] text-muted-foreground" />
                    <ResponsivenessChip consultantId={r.consultant_id} className="mt-0.5" />
                    <p className="text-[11px] text-muted-foreground">Sent {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</p>
                  </div>
                  <Badge variant="secondary" className={`text-[10px] capitalize ${statusStyles[r.status] || ''}`}>{statusLabel(r.status)}</Badge>
                  {isOwner && r.status === 'pending' && (
                    <Button size="sm" variant="outline" className="gap-1 text-xs" disabled={busyId === r.id} onClick={() => withdraw(r.id)}>
                      {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Withdraw
                    </Button>
                  )}
                </div>

                {view.kind === 'waiting' && view.deadline != null && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                    <span>
                      {t('assignment_client.waiting', 'Request sent to {{name}}, waiting for reply.', { name: r.consultant_name })}{' '}
                      <span className="font-medium text-foreground">{timeLeftLabel(view.deadline, now, lang)}</span>
                    </span>
                  </p>
                )}

                {view.kind === 'no_response' && (
                  <div className="space-y-2">
                    <p className="text-xs text-foreground">
                      {t('assignment_client.no_response', '{{name}} did not respond within the time limit.', { name: r.consultant_name })}
                    </p>
                    {isOwner && (
                      <div className="flex flex-wrap gap-2">
                        {onInviteAnother && (
                          <Button size="sm" className="gap-1 text-xs" onClick={onInviteAnother}>
                            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> {t('assignment_client.invite_another', 'Invite another')}
                          </Button>
                        )}
                        {onOpenBids && (
                          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={onOpenBids}>
                            <Gavel className="h-3.5 w-3.5" aria-hidden="true" /> {t('assignment_client.open_bids', 'Open for bids')}
                          </Button>
                        )}
                        {view.canExtend && (
                          <Button size="sm" variant="outline" className="gap-1 text-xs" disabled={busyId === r.id} onClick={() => setConfirmWait(r)}>
                            {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />}
                            {t('assignment_client.wait_longer', 'Wait longer ({{time}}, once)', { time: durationLabel(policy.extend, lang, false) })}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      <AlertDialog open={!!confirmWait} onOpenChange={(o) => { if (!o) setConfirmWait(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assignment_client.wait_title', 'Give {{name}} more time?', { name: confirmWait?.consultant_name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assignment_client.wait_body', 'The request opens again for {{time}}. You can do this once per request; you can still invite someone else meanwhile.', { time: durationLabel(policy.extend, lang, false) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (confirmWait) void waitLonger(confirmWait); }} disabled={!!busyId}>
              {t('assignment_client.wait_confirm', 'Give more time')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
