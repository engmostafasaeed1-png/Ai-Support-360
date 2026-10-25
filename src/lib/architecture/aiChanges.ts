// AI assist results -> proposed section changes (pure, unit-tested). Never applied without the client's choice.
import type { ArchAiResult } from './api';
import { componentTargets, htmlIsEmpty, type ArchContent, type ArchSectionKey } from '../../../supabase/functions/_shared/archModel';

/** One proposed change: which section, new text, and whether it replaces text the client already wrote. */
export interface AiChange { key: ArchSectionKey; html: string; trace: Array<{ ticket_ref: string; req_id: string }>; replaces: boolean }

/** Turns an AI result into proposed section changes (pure, unit-tested). */
export function proposedChanges(result: ArchAiResult, content: ArchContent): AiChange[] {
  const cur = (k: ArchSectionKey) => content.sections.find((s) => s.key === k);
  if (result.kind === 'draft') {
    return result.sections.flatMap((s) => {
      const c = cur(s.key as ArchSectionKey);
      return c && !htmlIsEmpty(s.html) ? [{ key: c.key, html: s.html, trace: s.trace, replaces: !htmlIsEmpty(c.html) }] : [];
    });
  }
  if (result.kind === 'components') {
    const tg = componentTargets(content.type);
    const out: AiChange[] = [];
    if (tg.components && !htmlIsEmpty(result.components)) out.push({ key: tg.components, html: result.components, trace: [], replaces: !htmlIsEmpty(cur(tg.components)?.html ?? '') });
    if (tg.integrations && !htmlIsEmpty(result.integrations)) out.push({ key: tg.integrations, html: result.integrations, trace: [], replaces: !htmlIsEmpty(cur(tg.integrations)?.html ?? '') });
    return out;
  }
  return [];
}

