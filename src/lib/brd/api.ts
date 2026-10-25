// Every BRD read and write goes through the database functions in docs/sql/ticket-brd.sql (they check the caller,
// the NDA rule and mask contact details) or the ticket-brd server function (AI). No table is read directly.
import { supabase } from '@/integrations/supabase/client';
import { safeRpc, isMissingRpc, type RpcError } from '@/lib/safeRpc';
import type { BrdContent, BrdLanguage, BrdTemplate, SectionKey } from '../../../supabase/functions/_shared/brdModel';
import type { BrdRole } from '../../../supabase/functions/_shared/brdAccess';
import type { IncludeFlags } from '../../../supabase/functions/_shared/brdTicketParts';

export const BRD_BUCKET = 'ticket-documents';

export interface BrdVersionRow {
  version: number; status: 'draft' | 'final'; change_note: string; restored_from: number | null; created_at: string;
  author: string; archived_at: string | null; archive_reason?: string | null; attached: boolean;
}
export interface BrdAttachmentRow {
  id: string; version: number; file_name: string; file_url: string; file_size: number | null; attached_at: string;
  attached_by: string; superseded_at: string | null; unattached_at: string | null;
}
export interface BrdCommentRow {
  id: string; version: number; section_key: string; parent_id: string | null; kind: 'comment' | 'suggestion'; body: string;
  suggested_text: string | null; status: 'open' | 'resolved' | 'accepted' | 'declined'; created_at: string;
  author_role: BrdRole; mine: boolean; author: string;
}
export interface BrdAccessRow { viewer: string; role: BrdRole; version: number; action: 'view' | 'download'; at: string }
export interface BrdSettingsView {
  enabled?: boolean; require_nda?: boolean; ai_calls_per_ticket_per_day?: number; ai_calls_per_client_per_day?: number;
  deep_calls_per_ticket_per_day?: number; max_attachments?: number; max_attachment_chars?: number; comments_per_user_per_day?: number;
}
export interface BrdState {
  role: BrdRole | null;
  enabled: boolean;
  can_write?: boolean;
  settings?: BrdSettingsView;
  ticket?: { id: string; title: string; status: string; ref: string; sap_module: string | null; urgency: string | null; company: string | null; requester: string | null; created_at: string };
  brd?: {
    id: string; language: BrdLanguage; template: BrdTemplate; latest_version: number; shared_version: number | null; edit_unlocked: boolean;
    created_at: string; draft: unknown | null; draft_rev: number | null; draft_saved_at: string | null;
  } | null;
  versions?: BrdVersionRow[];
  attachments?: BrdAttachmentRow[];
  comments?: BrdCommentRow[];
  access_log?: BrdAccessRow[];
  last_client_update?: string | null;
  usage?: { ticket_today: number; deep_today: number };
}

export type BrdResult<T> = { data: T | null; error: RpcError | null; notReady?: boolean };

const wrap = async <T,>(fn: string, args: Record<string, unknown>): Promise<BrdResult<T>> => {
  const r = await safeRpc<T>(fn, args);
  return { ...r, notReady: isMissingRpc(r.error) };
};

export const getBrd = (ticketId: string) => wrap<BrdState>('brd_get', { _ticket: ticketId });
export const getBrdVersion = (ticketId: string, version: number) =>
  wrap<{ version: number; status: string; change_note: string; created_at: string; archived_at: string | null; content: unknown }>('brd_get_version', { _ticket: ticketId, _version: version });
export const saveBrdDraft = (ticketId: string, content: BrdContent, rev: number | null) =>
  wrap<{ rev: number; saved_at: string; masked: boolean; content: unknown | null }>('brd_save_draft', { _ticket: ticketId, _content: content, _rev: rev });
export const saveBrdVersion = (ticketId: string, content: BrdContent, note: string, status: 'draft' | 'final', rev: number | null) =>
  wrap<{ version: number; rev: number; status: string; content: unknown }>('brd_save_version', { _ticket: ticketId, _content: content, _note: note, _status: status, _rev: rev });
export const restoreBrdVersion = (ticketId: string, version: number, note: string) =>
  wrap<{ version: number; rev: number; content: unknown }>('brd_restore_version', { _ticket: ticketId, _version: version, _note: note });
export const archiveBrdVersion = (ticketId: string, version: number, reason: string) =>
  wrap<boolean>('brd_archive_version', { _ticket: ticketId, _version: version, _reason: reason });
export const unattachBrd = (documentId: string, reason: string) => wrap<boolean>('brd_unattach', { _document_id: documentId, _reason: reason });
export const logBrdAccess = (ticketId: string, version: number, action: 'view' | 'download') =>
  wrap<boolean>('brd_log_access', { _ticket: ticketId, _version: version, _action: action });
export const addBrdComment = (ticketId: string, version: number, section: string, body: string, parent: string | null, kind: 'comment' | 'suggestion' = 'comment', suggested: string | null = null) =>
  wrap<string>('brd_add_comment', { _ticket: ticketId, _version: version, _section: section, _body: body, _parent: parent, _kind: kind, _suggested: suggested });
export const setBrdCommentStatus = (commentId: string, status: BrdCommentRow['status']) => wrap<boolean>('brd_set_comment_status', { _comment: commentId, _status: status });
export const adminBrdOverview = () => wrap<Record<string, any>>('admin_brd_overview', {});
export const adminBrdSetSettings = (value: Record<string, unknown>) => wrap<Record<string, any>>('admin_brd_set_settings', { _value: value });
export const adminBrdUnlock = (ticketId: string, unlocked: boolean, reason: string) => wrap<boolean>('admin_brd_unlock', { _ticket: ticketId, _unlocked: unlocked, _reason: reason });

/** Uploads the PDF under <ticket>/brd/ and records it as the ticket's BRD document (older ones become superseded). */
export async function attachBrdPdf(ticketId: string, version: number, pdf: Blob, notify: boolean): Promise<BrdResult<{ document_id: string; file_name: string; notified: number }>> {
  const path = `${ticketId}/brd/BRD_v${version}_${Date.now()}.pdf`;
  try {
    const { error: upErr } = await supabase.storage.from(BRD_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false });
    if (upErr) return { data: null, error: { message: upErr.message } };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : 'Upload failed' } };
  }
  return wrap('brd_attach', { _ticket: ticketId, _version: version, _path: path, _size: pdf.size, _notify: notify });
}

/** Logs the download first (the database refuses people without access), then opens a 60-second link. */
export async function downloadAttachedBrd(ticketId: string, row: Pick<BrdAttachmentRow, 'file_url' | 'file_name' | 'version'>): Promise<string | null> {
  const log = await logBrdAccess(ticketId, row.version, 'download');
  if (log.error) return log.error.message;
  const { data, error } = await supabase.storage.from(BRD_BUCKET).createSignedUrl(row.file_url, 60, { download: row.file_name });
  if (error || !data?.signedUrl) return error?.message ?? 'Download failed';
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  return null;
}

export async function notifyBrdByEmail(documentId: string): Promise<void> {
  try {
    await supabase.functions.invoke('ticket-brd', { body: { action: 'notify', documentId } });
  } catch { /* the in-app notice is already there; e-mail is best effort */ }
}

// ------------------------------------------------------------------ AI (streamed NDJSON)

export type AiStep = 'reading' | 'thinking' | 'writing' | 'checking';
export interface AiReport { secrets: number; contacts: number; dropped: number; truncated: boolean }
export interface AiError { code: string; status: number; message: string }

export interface DraftRequest {
  action: 'draft'; ticketId: string; language: BrdLanguage; template: BrdTemplate; include: IncludeFlags;
  attachments: Array<{ name: string; text: string }>; clientAnswers?: Array<{ question: string; answer: string }>; deep?: boolean;
}
export interface SectionRequest {
  action: 'section'; ticketId: string; language: BrdLanguage; section: SectionKey; mode: 'regenerate' | 'improve' | 'shorter';
  currentHtml: string; currentHtmlAr?: string; include: IncludeFlags; attachments: Array<{ name: string; text: string }>; deep?: boolean;
}

export async function runBrdAi<T>(body: DraftRequest | SectionRequest, onStep: (s: AiStep) => void, signal?: AbortSignal):
  Promise<{ result: (T & { report: AiReport }) | null; error: AiError | null }> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) return { result: null, error: { code: 'auth', status: 401, message: 'Please sign in again.' } };
    const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/ticket-brd`;
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      let j: any = null;
      try { j = await res.json(); } catch { /* not json */ }
      return { result: null, error: { code: String(j?.code ?? j?.error ?? 'error'), status: res.status, message: String(j?.error ?? 'The document assistant is not available.') } };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'progress') onStep(ev.step);
        else if (ev.type === 'result') return { result: ev as T & { report: AiReport }, error: null };
        else if (ev.type === 'error') return { result: null, error: { code: ev.code, status: ev.status, message: ev.message } };
      }
    }
    return { result: null, error: { code: 'incomplete', status: 502, message: 'The answer was cut off. Please try again later.' } };
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return { result: null, error: { code: 'stopped', status: 499, message: 'Stopped.' } };
    return { result: null, error: { code: 'network', status: 0, message: 'Network problem. Please check your connection.' } };
  }
}
