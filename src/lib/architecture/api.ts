// Every architecture read and write goes through the sa_* database functions in docs/sql/solution-architecture.sql
// (they check the caller, the company, the sharing rule, the NDA and mask contact details) or the architecture-ai
// server function. No table is read directly. Files live in the private ticket-documents bucket:
//   arch/<document id>/<random>.<png|jpg|svg>   diagram pictures (company readers + shared consultants)
//   <ticket id>/architecture/<file>.pdf         PDF attached to a ticket (same flow as the BRD)
import { supabase } from '@/integrations/supabase/client';
import { safeRpc, isMissingRpc, type RpcError } from '@/lib/safeRpc';
import { runBrdAi, type AiReport, type AiStep, type AiError } from '@/lib/brd/api';
import type { BrdCommentRow } from '@/lib/brd/api';
import type {
  ArchConfidentiality, ArchContent, ArchMeta, ArchRole, ArchStatus, ArchType, BrdRequirementRef, DiagramMime, LandscapeSystem,
} from '../../../supabase/functions/_shared/archModel';
import { DIAGRAM_EXT } from '../../../supabase/functions/_shared/archModel';

export const ARCH_BUCKET = 'ticket-documents';

export interface ArchLink { ticket_id: string; ref: string; title: string; status: string }
export interface ArchProjectLink { project_id: string; title: string }
export interface ArchListRow {
  id: string; type: ArchType; title: string; status: ArchStatus; confidentiality: ArchConfidentiality;
  sap_area: string; sap_module: string; sap_version: string; owner_name: string;
  latest_version: number; approved_version: number | null; created_at: string; updated_at: string; archived_at: string | null;
  links: ArchLink[]; projects: ArchProjectLink[]; open_comments: number;
}
export interface ArchVersionRow { version: number; status: ArchStatus; change_note: string; restored_from: number | null; created_at: string; author: string; attached: boolean }
export interface ArchAttachmentRow { id: string; ticket_id: string; ticket_ref: string; version: number; file_name: string; file_url: string; attached_at: string; unattached_at: string | null }
export interface ArchAsset { id: string; file_name: string; mime: DiagramMime; size: number; path: string }
export interface ArchAccessRow { viewer: string; role: ArchRole; version: number; action: 'view' | 'download'; at: string }
export interface ArchEvent { action: string; version: number | null; at: string; actor: string }
export interface ArchPublicSettings { enabled: boolean; ai_enabled: boolean }
export interface ArchState extends ArchPublicSettings {
  role: ArchRole | null;
  can_write: boolean;
  doc?: ArchListRow & { tenant_id: string | null; draft: unknown | null; draft_rev: number | null; draft_saved_at: string | null };
  versions?: ArchVersionRow[];
  comments?: BrdCommentRow[];
  access_log?: ArchAccessRow[];
  attachments?: ArchAttachmentRow[];
  assets?: ArchAsset[];
  systems?: LandscapeSystem[];
  requirements?: BrdRequirementRef[];
  events?: ArchEvent[];
  usage?: { doc_today: number; org_today: number; doc_limit: number; org_limit: number };
}
export interface ArchTimelineRow { at: string; kind: 'doc' | 'ticket'; action: string; doc_id: string | null; doc_title: string | null; doc_type: ArchType | null; version: number | null; ticket_id: string | null; ticket_ref: string | null; ticket_title: string | null; actor: string | null }
export interface CaseArchDoc { id: string; type: ArchType; title: string; status: ArchStatus; latest_version: number; updated_at: string }

export type ArchResult<T> = { data: T | null; error: RpcError | null; notReady?: boolean };
const wrap = async <T,>(fn: string, args: Record<string, unknown>): Promise<ArchResult<T>> => {
  const r = await safeRpc<T>(fn, args);
  return { ...r, notReady: isMissingRpc(r.error) };
};

export const getArchSettings = () => wrap<ArchPublicSettings>('sa_public_settings', {});
export const listArchDocs = (tenant: string | null, includeArchived = false) => wrap<ArchListRow[]>('sa_list', { _tenant: tenant, _include_archived: includeArchived });
export const getArch = (doc: string) => wrap<ArchState>('sa_get', { _doc: doc });
export const getArchVersion = (doc: string, version: number) =>
  wrap<{ version: number; status: ArchStatus; change_note: string; created_at: string; content: unknown; meta: Partial<ArchMeta> }>('sa_get_version', { _doc: doc, _version: version });
export interface ArchCreateInput {
  type: ArchType; title: string; sap_area: string; sap_module: string; sap_version: string; owner_name: string;
  status: ArchStatus; confidentiality: ArchConfidentiality; language: 'en' | 'ar'; tickets: string[]; projects: string[]; content: ArchContent;
}
export const createArch = (tenant: string | null, input: ArchCreateInput) => wrap<string>('sa_create', { _tenant: tenant, _input: input });
export const saveArchDraft = (doc: string, content: ArchContent, rev: number | null) =>
  wrap<{ rev: number; saved_at: string; masked: boolean; content: unknown | null }>('sa_save_draft', { _doc: doc, _content: content, _rev: rev });
export const saveArchVersion = (doc: string, content: ArchContent, note: string, rev: number | null) =>
  wrap<{ version: number; rev: number; status: ArchStatus; content: unknown }>('sa_save_version', { _doc: doc, _content: content, _note: note, _rev: rev });
export const restoreArchVersion = (doc: string, version: number, note: string) =>
  wrap<{ version: number; rev: number; content: unknown }>('sa_restore_version', { _doc: doc, _version: version, _note: note });
export const updateArchMeta = (doc: string, patch: Partial<Pick<ArchMeta, 'title' | 'sap_area' | 'sap_module' | 'sap_version' | 'owner_name' | 'confidentiality'>>) =>
  wrap<boolean>('sa_update_meta', { _doc: doc, _patch: patch });
export const setArchStatus = (doc: string, status: ArchStatus, note: string) => wrap<{ status: ArchStatus; approved_version: number | null }>('sa_set_status', { _doc: doc, _status: status, _note: note });
export const setArchLinks = (doc: string, tickets: string[], projects: string[]) => wrap<boolean>('sa_set_links', { _doc: doc, _tickets: tickets, _projects: projects });
export const logArchAccess = (doc: string, version: number, action: 'view' | 'download') => wrap<boolean>('sa_log_access', { _doc: doc, _version: version, _action: action });
export const addArchComment = (doc: string, version: number, section: string, body: string, parent: string | null, kind: 'comment' | 'suggestion' = 'comment', suggested: string | null = null) =>
  wrap<string>('sa_add_comment', { _doc: doc, _version: version, _section: section, _body: body, _parent: parent, _kind: kind, _suggested: suggested });
export const setArchCommentStatus = (comment: string, status: BrdCommentRow['status']) => wrap<boolean>('sa_set_comment_status', { _comment: comment, _status: status });
export const archTimeline = (tenant: string | null) => wrap<ArchTimelineRow[]>('sa_timeline', { _tenant: tenant, _limit: 200 });
export const archForTicket = (ticket: string) => wrap<CaseArchDoc[]>('sa_for_ticket', { _ticket: ticket });
export const unattachArch = (documentId: string, reason: string) => wrap<boolean>('sa_unattach', { _document_id: documentId, _reason: reason });

// Landscape register
export const listLandscape = (tenant: string | null) => wrap<Array<LandscapeSystem & { id: string; updated_at: string }>>('sa_landscape_list', { _tenant: tenant });
export const saveLandscape = (tenant: string | null, row: LandscapeSystem) => wrap<string>('sa_landscape_save', { _tenant: tenant, _row: row });
export const archiveLandscape = (id: string, reason: string) => wrap<boolean>('sa_landscape_archive', { _id: id, _reason: reason });
export const ticketSystems = (ticket: string) => wrap<{ can_edit: boolean; systems: Array<LandscapeSystem & { id: string }>; available: Array<LandscapeSystem & { id: string }> }>('sa_ticket_systems', { _ticket: ticket });
export const setTicketSystems = (ticket: string, ids: string[]) => wrap<boolean>('sa_set_ticket_systems', { _ticket: ticket, _systems: ids });

// Admin
export const adminArchOverview = () => wrap<Record<string, any>>('admin_sa_overview', {});
export const adminArchSetSettings = (value: Record<string, unknown>) => wrap<Record<string, any>>('admin_sa_set_settings', { _value: value });

// ------------------------------------------------------------------ files

const randomName = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Uploads a cleaned diagram picture under arch/<doc>/ and registers it (the database checks type, size and count). */
export async function uploadArchAsset(doc: string, blob: Blob, mime: DiagramMime, fileName: string): Promise<ArchResult<ArchAsset>> {
  const path = `arch/${doc}/${randomName()}.${DIAGRAM_EXT[mime]}`;
  try {
    const { error } = await supabase.storage.from(ARCH_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
    if (error) return { data: null, error: { message: error.message } };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : 'Upload failed' } };
  }
  return wrap<ArchAsset>('sa_asset_register', { _doc: doc, _path: path, _name: fileName.slice(0, 120), _mime: mime, _size: blob.size });
}

const urlCache = new Map<string, { url: string; until: number }>();
/** Short-lived link to a diagram picture (the storage rule checks the reader). */
export async function assetUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  try {
    const { data, error } = await supabase.storage.from(ARCH_BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return null;
    urlCache.set(path, { url: data.signedUrl, until: Date.now() + 240_000 });
    return data.signedUrl;
  } catch { return null; }
}

/** Same flow as the BRD: upload the PDF under <ticket>/architecture/ and record it as a ticket document. */
export async function attachArchPdf(doc: string, ticket: string, version: number, pdf: Blob, notify: boolean): Promise<ArchResult<{ document_id: string; file_name: string; notified: number }>> {
  const path = `${ticket}/architecture/ARCH_${randomName()}.pdf`;
  try {
    const { error } = await supabase.storage.from(ARCH_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false });
    if (error) return { data: null, error: { message: error.message } };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : 'Upload failed' } };
  }
  return wrap('sa_attach', { _doc: doc, _ticket: ticket, _version: version, _path: path, _size: pdf.size, _notify: notify });
}

export async function downloadAttachedArch(doc: string, row: Pick<ArchAttachmentRow, 'file_url' | 'file_name' | 'version'>): Promise<string | null> {
  const log = await logArchAccess(doc, row.version, 'download');
  if (log.error) return log.error.message;
  const { data, error } = await supabase.storage.from(ARCH_BUCKET).createSignedUrl(row.file_url, 60, { download: row.file_name });
  if (error || !data?.signedUrl) return error?.message ?? 'Download failed';
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  return null;
}

// ------------------------------------------------------------------ AI (same streamed format and guardrails as the BRD)

export type ArchAiAction = 'arch_draft' | 'arch_components' | 'arch_review';
export interface ArchAiRequest { action: ArchAiAction; docId: string; ticketId?: string | null; content: ArchContent; language: 'en' | 'ar' }
export interface ArchFinding { severity: 'high' | 'medium' | 'low'; section: string; finding: string; suggestion: string }
export type ArchAiResult =
  | { kind: 'draft'; sections: Array<{ key: string; html: string; trace: Array<{ ticket_ref: string; req_id: string }> }> }
  | { kind: 'components'; components: string; integrations: string }
  | { kind: 'review'; findings: ArchFinding[] };

export function runArchAi(body: ArchAiRequest, onStep: (s: AiStep) => void, signal?: AbortSignal):
  Promise<{ result: (ArchAiResult & { report: AiReport }) | null; error: AiError | null }> {
  return runBrdAi<ArchAiResult>(body as never, onStep, signal, 'architecture-ai');
}
