import type { CommentApi } from '@/components/brd/BrdComments';
import { addArchComment, setArchCommentStatus, type ArchState } from '@/lib/architecture/api';
import { docRef, normalizeArchContent, type ArchContent, type ArchMeta } from '../../../../supabase/functions/_shared/archModel';

/** BRD comment threads stored through the architecture functions. */
export const archCommentApi = (docId: string): CommentApi => ({
  add: (v, s, b, p, k, sug) => addArchComment(docId, v, s, b, p, k, sug),
  setStatus: (id, st) => setArchCommentStatus(id, st),
});

export function metaOf(s: ArchState): ArchMeta {
  const d = s.doc!;
  return { title: d.title, type: d.type, status: d.status, confidentiality: d.confidentiality, sap_area: d.sap_area, sap_module: d.sap_module, sap_version: d.sap_version, owner_name: d.owner_name };
}

export const draftOf = (s: ArchState): ArchContent => normalizeArchContent(s.doc?.draft, s.doc?.type);
export const refOf = (s: ArchState) => docRef(s.doc?.id ?? '');
