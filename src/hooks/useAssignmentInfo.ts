import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import { validateAttachment } from '@/lib/attachments';
import { safeFileName } from '@/lib/storagePath';
import { sanitizePreview, type DecisionPreview, type InfoRow } from '../../supabase/functions/_shared/assignmentInfo';

/**
 * Feature L addition: decision preview, "Request more information" and decline reasons.
 * Everything runs through the SECURITY DEFINER functions of docs/sql/assignment-info-requests.sql; until that file is
 * applied useAssignmentInfoReady() is false and the screens keep the plain Accept / Decline.
 */

type DbError = { message: string; code?: string };
type RpcResult = { data: unknown; error: DbError | null };
// Called as a method: supabase.rpc reads `this`, so a detached reference throws.
const rpc = (fn: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<RpcResult> }).rpc(fn, args);
// The new table is not in the generated types until the SQL is applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string) => (supabase as any).from(name);

export const INFO_READY_KEY = ['assignment-info-ready'];

/** True once the prepared SQL is live (the three options, preview and reasons are shown only then). */
export function useAssignmentInfoReady(): boolean {
  const { signedIn } = useSessionReady();
  const q = useQuery({
    queryKey: INFO_READY_KEY,
    queryFn: async () => {
      const { data, error } = await rpc('assignment_info_ready');
      return !error && data === true;
    },
    enabled: signedIn,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return q.data === true;
}

/** Opening the preview logs "Viewed" once; it is not an answer and does not stop the clock. */
export function useDecisionPreview(requestId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['assignment-preview', requestId],
    queryFn: async (): Promise<DecisionPreview> => {
      const { data, error } = await rpc('assignment_request_preview', { _request_id: requestId });
      if (error) throw error;
      const preview = sanitizePreview(data);
      if (!preview) throw new Error('The ticket description could not be loaded.');
      queryClient.invalidateQueries({ queryKey: ['consultant-match-requests'] });
      return preview;
    },
    enabled: !!requestId,
    // Fresh every time it is opened: the view is logged by the call and texts may change.
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

export type InfoRequestRow = InfoRow & { ticket_id: string; consultant_id: string; timed_out_at: string | null };

/** Information requests of some assignment requests (consultant) or of one ticket (client). */
export function useInfoRequests(filter: { requestIds?: string[]; ticketId?: string }, enabled = true) {
  const key = filter.ticketId ? ['assignment-info', 'ticket', filter.ticketId] : ['assignment-info', 'requests', ...(filter.requestIds ?? []).slice().sort()];
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<InfoRequestRow[]> => {
      let q = table('assignment_info_requests')
        .select('id, request_id, ticket_id, consultant_id, status, topics, question, asked_at, client_due_at, answer, answered_at, timed_out_at, answer_file_name, answer_file_type')
        .order('asked_at', { ascending: true });
      if (filter.ticketId) q = q.eq('ticket_id', filter.ticketId);
      else q = q.in('request_id', filter.requestIds ?? []);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({ ...r, attachment_name: r.answer_file_name ?? null, attachment_type: r.answer_file_type ?? null })) as InfoRequestRow[];
    },
    enabled: enabled && (!!filter.ticketId || (filter.requestIds?.length ?? 0) > 0),
    retry: false,
  });
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['assignment-info'] });
  queryClient.invalidateQueries({ queryKey: ['consultant-match-requests'] });
  queryClient.invalidateQueries({ queryKey: ['assignment-popup-requests'] });
  queryClient.invalidateQueries({ queryKey: ['ticket-match-requests'] });
}

export function useAskForInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { requestId: string; topics: string[]; question: string }) => {
      const { data, error } = await rpc('consultant_request_assignment_info', { _request_id: v.requestId, _topics: v.topics, _question: v.question.trim() });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/** Decline with optional reasons; before the SQL is applied the plain decline (no reasons) is used. */
export function useDeclineAssignment(ready: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { requestId: string; reasons: string[] }) => {
      if (ready) {
        const { error } = await rpc('consultant_decline_assignment', { _request_id: v.requestId, _reasons: v.reasons });
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from('ticket_match_requests')
        .update({ status: 'rejected' as never, responded_at: new Date().toISOString() })
        .eq('id', v.requestId);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/** The client's answer: text plus an optional file uploaded through the normal ticket document upload. */
export function useAnswerInfo(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { infoId: string; answer: string; file?: File | null }) => {
      let documentId: string | null = null;
      if (v.file) {
        const problem = validateAttachment(v.file);
        if (problem) throw new Error(problem);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Your session has ended. Please sign in again.');
        const path = `${ticketId}/${session.user.id}/${Date.now()}_${safeFileName(v.file.name)}`;
        const { error: upErr } = await supabase.storage.from('ticket-documents').upload(path, v.file);
        if (upErr) throw upErr;
        const { data: doc, error: docErr } = await supabase
          .from('ticket_documents')
          .insert({
            ticket_id: ticketId, uploaded_by: session.user.id, file_name: v.file.name, file_url: path,
            file_size: v.file.size, mime_type: v.file.type || null, version: 1, comment: 'Answer to a consultant question',
          } as never)
          .select('id')
          .single();
        if (docErr) throw docErr;
        documentId = (doc as { id: string }).id;
        queryClient.invalidateQueries({ queryKey: ['ticket-documents', ticketId] });
      }
      const { data, error } = await rpc('client_answer_assignment_info', { _info_id: v.infoId, _answer: v.answer.trim(), _document_id: documentId });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/** Anonymous decline reasons of a ticket for the client's "next best" tips (never who gave them). */
export function useDeclineHints(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['assignment-decline-hints', ticketId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await rpc('assignment_decline_hints', { _ticket_id: ticketId });
      if (error) return [];
      return Array.isArray(data) ? (data as string[]) : [];
    },
    enabled: enabled && !!ticketId,
    retry: false,
  });
}

/** Readable reason of a refused action: our own database rules are written for people, anything else gets the fallback. */
export function infoActionMessage(error: unknown, fallback: string): string {
  const e = error as DbError | null;
  const msg = typeof e?.message === 'string' ? e.message : '';
  if (e?.code && /^(P0001|22023)$/.test(e.code) && msg.length < 240) return msg;
  if (!e?.code && msg && msg.length < 240 && /(files of type|too large|not allowed|is empty)/i.test(msg)) return msg;
  return fallback;
}
