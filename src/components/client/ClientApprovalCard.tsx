import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Clock, History, Loader2, Send, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useClientApproval, useResubmitForApproval } from '@/hooks/useClientApproval';
import { useClientProfileData } from '@/hooks/useClientProfile';
import { APPROVAL_EVENT_LABEL, APPROVAL_STATUS_LABEL, STATUS_BADGE_CLASS } from '@/lib/clientApproval';
import { cn } from '@/lib/utils';

/** Account approval on the company page: status, what the administrator asked, what is still missing, "Send again" and the history. */
export default function ClientApprovalCard() {
  const { t } = useTranslation();
  const { data } = useClientApproval();
  const { data: profile, refetch: refetchProfile } = useClientProfileData();
  const resubmit = useResubmitForApproval();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  // The setup wizard saves the profile without telling this page: read the latest values when the page opens.
  useEffect(() => {
    void refetchProfile();
  }, [refetchProfile]);

  if (!data || !data.required) return null;

  const status = data.status;
  const checklist = [
    { key: 'company', label: t('client_approval.item_company', 'Company name'), ok: !!profile?.company_name?.trim(), required: true, to: '/client/company' },
    { key: 'modules', label: t('client_approval.item_modules', 'SAP modules'), ok: (profile?.sap_modules?.length ?? 0) > 0, required: true, to: '/client/onboarding?step=1' },
    { key: 'industry', label: t('client_approval.item_industry', 'Industry'), ok: !!profile?.industry?.trim(), required: false, to: '/client/company' },
    { key: 'size', label: t('client_approval.item_size', 'Company size'), ok: !!profile?.company_size?.trim(), required: false, to: '/client/company' },
    { key: 'phone', label: t('client_approval.item_phone', 'Phone'), ok: !!profile?.phone?.trim(), required: false, to: '/client/onboarding?step=0' },
  ];
  const ready = checklist[0].ok && checklist[1].ok;
  const showComment = !!data.comment && status !== 'awaiting_confirmation' && status !== 'draft';

  const send = () => {
    resubmit.mutate(message, {
      onSuccess: () => {
        setOpen(false);
        setMessage('');
      },
    });
  };

  return (
    <Card id="approval" className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-primary" /> {t('client_approval.card_title', 'Account approval')}
          </CardTitle>
          <Badge variant="outline" className={cn('text-[11px]', STATUS_BADGE_CLASS[status])}>
            {t(`client_approval.status_${status}`, APPROVAL_STATUS_LABEL[status])}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'approved' ? (
          <p className="text-sm text-muted-foreground">
            {t('client_approval.approved_text', 'Your account is approved. You can create requests and book sessions.')}
          </p>
        ) : null}

        {showComment ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t('client_approval.admin_message', 'Message from the administrator')}</p>
            <blockquote className="max-h-40 overflow-auto whitespace-pre-line rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground">
              {data.comment}
            </blockquote>
          </div>
        ) : null}

        {status !== 'approved' ? (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t('client_approval.checklist_title', 'What the administrator looks at')}</p>
            <ul className="divide-y divide-border/50 rounded-xl border border-border/50">
              {checklist.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  {item.ok ? (
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                  {!item.ok && item.required ? (
                    <span className="text-[11px] font-medium text-warning">{t('client_approval.required', 'required')}</span>
                  ) : null}
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <Link to={item.to}>{t('client_approval.edit', 'Edit')}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {status === 'changes_requested' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setOpen(true)} disabled={!ready} className="gap-2">
              <Send aria-hidden="true" className="h-4 w-4" /> {t('client_approval.send_again', 'Send again')}
            </Button>
            {!ready ? (
              <p className="text-xs text-muted-foreground">{t('client_approval.send_hint', 'Add your company name and at least one SAP module first.')}</p>
            ) : null}
          </div>
        ) : null}

        {status === 'awaiting_confirmation' && data.submitted_at ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock aria-hidden="true" className="h-3.5 w-3.5" /> {t('client_approval.sent_on', 'Sent on')} {new Date(data.submitted_at).toLocaleString()}
          </p>
        ) : null}

        {data.events.length > 0 ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <History aria-hidden="true" className="h-3.5 w-3.5" /> {t('client_approval.history_title', 'History')}
            </p>
            <ol className="space-y-2">
              {data.events.map((e, i) => (
                <li key={`${e.created_at}-${i}`} className="rounded-lg border border-border/50 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{t(`client_approval.event_${e.event}`, APPROVAL_EVENT_LABEL[e.event] ?? e.event)}</span>
                    <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                  </div>
                  {e.comment ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{e.comment}</p> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('client_approval.send_title', 'Send your information again')}</DialogTitle>
            <DialogDescription>
              {t('client_approval.send_desc', 'An administrator will review it again. You can add a short note about what you changed.')}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder={t('client_approval.send_placeholder', 'What did you change? (optional)')}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={resubmit.isPending}>
              {t('client_approval.cancel', 'Cancel')}
            </Button>
            <Button onClick={send} disabled={resubmit.isPending} className="gap-2">
              {resubmit.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              {t('client_approval.send_confirm', 'Send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
