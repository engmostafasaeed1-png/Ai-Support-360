import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import type { AiError, AiReport } from '@/lib/brd/api';

/** Tells the client what the safety checks changed in the AI text (never silently). */
export function announceReport(t: TFunction, r: AiReport | null | undefined): void {
  if (!r) return;
  if (r.secrets > 0) toast.warning(t('brd.ai.removedSecrets', { count: r.secrets }));
  if (r.contacts > 0) toast.info(t('brd.ai.hiddenContacts', { count: r.contacts }));
  if (r.dropped > 0) toast.info(t('brd.ai.droppedLines', { count: r.dropped }));
  if (r.truncated) toast.info(t('brd.ai.truncated'));
}

export function aiErrorText(t: TFunction, e: AiError): string {
  switch (e.code) {
    case 'ticket_limit': return t('brd.ai.err.ticketLimit');
    case 'client_limit': return t('brd.ai.err.clientLimit');
    case 'deep_limit': return t('brd.ai.err.deepLimit');
    case 'not_allowed': return t('brd.ai.err.notAllowed');
    case 'credits': return e.message || t('brd.ai.err.credits');
    case 'busy': return t('brd.ai.err.busy');
    case 'stopped': return t('brd.ai.err.stopped');
    case 'network': return t('brd.ai.err.network');
    default: return e.message || t('brd.ai.err.generic');
  }
}
