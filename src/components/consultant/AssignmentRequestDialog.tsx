import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Check, Eye, FileText, HelpCircle, X, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { policyText, timeLeftLabel, type PolicyMinutes } from '../../../supabase/functions/_shared/assignmentPolicy';

export interface AssignmentPopupItem {
  id: string;
  ticket_title: string;
  sap_area: string;
  urgency: string;
  critical: boolean;
  bid: boolean;
  response_due_at: string | null;
  reminders_sent: number;
  proposed_rate: number | null;
  currency: string | null;
  /** The client answered the consultant's information request (the clock runs again). */
  info_answered?: boolean;
}

interface Props {
  item: AssignmentPopupItem | null;
  policy: PolicyMinutes;
  now: number;
  /** Other requests still waiting behind this one. */
  waitingCount: number;
  busy: boolean;
  acceptDisabled?: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onView: () => void;
  /** Close without answering (also Escape and the close button): the popup returns after the next reminder or sign-in. */
  onLater: () => void;
  /** Feature L addition is live: "Open ticket description" and "Request more information" are offered. */
  infoReady?: boolean;
  onPreview?: () => void;
  onAskInfo?: () => void;
  /** Why another information request is not possible (one open, or 3 used); the button is disabled with this hint. */
  askBlockedText?: string | null;
  children?: ReactNode;
}

/** The "New assignment request" popup. Presentational: data, acknowledgement and answers live in MatchRequestPopup. */
export default function AssignmentRequestDialog({
  item, policy, now, waitingCount, busy, acceptDisabled, onAccept, onDecline, onView, onLater,
  infoReady = false, onPreview, onAskInfo, askBlockedText, children,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const reminder = (item?.reminders_sent ?? 0) > 0;
  const deadline = item?.response_due_at ? Date.parse(item.response_due_at) : null;
  const deadlineText = deadline
    ? new Date(deadline).toLocaleString(lang === 'ar' ? 'ar' : undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const title = item?.info_answered
    ? t('assignment_info.answered_popup_title', 'The client answered your question')
    : reminder
      ? t('assignment_policy.popup_reminder_title', 'Reminder: assignment request waiting')
      : t('assignment_policy.popup_title', 'New assignment request');

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onLater(); }}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby="assignment-popup-desc"
      >
        {item && (
          <>
            <DialogHeader className="text-start">
              <div className="mb-1 flex items-center gap-3">
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full gradient-primary">
                  <span className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping" aria-hidden="true" />
                  <BellRing className="relative h-5 w-5 text-primary-foreground" aria-hidden="true" />
                </span>
                <DialogTitle className="text-lg">{title}</DialogTitle>
              </div>
              <DialogDescription id="assignment-popup-desc" className="text-start font-medium text-foreground">
                {item.ticket_title}
              </DialogDescription>
            </DialogHeader>

            <div role="status" aria-live="polite" className="sr-only">
              {title}: {item.ticket_title}
              {deadline ? `. ${timeLeftLabel(deadline, now, lang)}` : ''}
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <dt className="sr-only">{t('assignment_policy.area', 'SAP area')}</dt>
                <dd><Badge variant="secondary">{item.sap_area || 'SAP'}</Badge></dd>
                <dt className="sr-only">{t('assignment_policy.urgency', 'Urgency')}</dt>
                <dd>
                  <Badge variant="secondary" className={item.critical ? 'bg-destructive/10 text-destructive' : 'capitalize'}>
                    {item.critical && <Zap className="me-1 h-3 w-3" aria-hidden="true" />}
                    {item.critical ? t('assignment_policy.critical', 'Critical') : item.urgency}
                  </Badge>
                </dd>
                {item.bid && <dd><Badge variant="outline">{t('assignment_policy.bid_invite', 'Bid invitation')}</Badge></dd>}
              </div>
              {item.proposed_rate != null && item.proposed_rate > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t('assignment_policy.proposed_rate', 'Proposed rate')}</dt>
                  <dd className="font-medium">{item.proposed_rate} {item.currency || 'USD'} / {t('assignment_policy.hour', 'hour')}</dd>
                </div>
              )}
              {deadlineText && deadline && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t('assignment_policy.reply_by', 'Reply by')}</dt>
                  <dd className="text-end">
                    <span className="font-medium">{deadlineText}</span>
                    <span className="block text-xs font-semibold text-warning">{timeLeftLabel(deadline, now, lang)}</span>
                  </dd>
                </div>
              )}
            </dl>

            <p className="rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
              {policyText(policy, lang, { info: infoReady })}
            </p>
            {waitingCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('assignment_policy.more_waiting', '{{count}} more request(s) waiting after this one.', { count: waitingCount })}
              </p>
            )}
            {children}

            {infoReady && onPreview && (
              <Button variant="secondary" className="w-full" onClick={onPreview} disabled={busy}>
                <FileText className="me-1 h-4 w-4" aria-hidden="true" /> {t('assignment_info.preview_button', 'Open ticket description')}
              </Button>
            )}
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2">
              <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={onDecline} disabled={busy}>
                <X className="me-1 h-4 w-4" aria-hidden="true" /> {t('assignment_policy.decline', 'Decline')}
              </Button>
              {infoReady && onAskInfo ? (
                <Button
                  variant="outline"
                  onClick={onAskInfo}
                  disabled={busy || !!askBlockedText}
                  title={askBlockedText ?? undefined}
                  aria-describedby={askBlockedText ? 'assignment-ask-blocked' : undefined}
                >
                  <HelpCircle className="me-1 h-4 w-4" aria-hidden="true" /> {t('assignment_info.ask_button', 'Request more information')}
                </Button>
              ) : (
                <Button variant="outline" onClick={onView} disabled={busy}>
                  <Eye className="me-1 h-4 w-4" aria-hidden="true" /> {t('assignment_policy.view', 'View details')}
                </Button>
              )}
              <Button className="gradient-primary border-0" onClick={onAccept} disabled={busy || acceptDisabled}>
                <Check className="me-1 h-4 w-4" aria-hidden="true" /> {t('assignment_policy.accept', 'Accept')}
              </Button>
            </DialogFooter>
            {infoReady && askBlockedText && (
              <p id="assignment-ask-blocked" className="text-center text-xs text-muted-foreground">{askBlockedText}</p>
            )}
            {infoReady && onAskInfo && (
              <button type="button" onClick={onView} className="mx-auto block text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                {t('assignment_policy.view', 'View details')}
              </button>
            )}
            <button type="button" onClick={onLater} className="mx-auto block text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              {t('assignment_policy.later', 'Remind me later')}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
