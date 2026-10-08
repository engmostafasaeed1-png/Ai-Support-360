import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ClipboardCheck, Clock, ShieldX, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useClientApproval } from '@/hooks/useClientApproval';
import type { ClientApprovalStatus } from '@/lib/clientApproval';

interface View {
  icon: LucideIcon;
  tone: string;
  iconTone: string;
  title: string;
  body: string;
  cta: string;
  to: string;
  primary: boolean;
  showComment: boolean;
}

const VIEWS: Record<Exclude<ClientApprovalStatus, 'approved'>, View> = {
  draft: {
    icon: ClipboardCheck,
    tone: 'border-info/30 bg-info/10',
    iconTone: 'text-info',
    title: 'Finish your company setup',
    body: 'Add your company name and your SAP modules. We then send them to an administrator for review. Until it is approved you can look around, but you cannot create requests or book sessions.',
    cta: 'Complete setup',
    to: '/client/onboarding',
    primary: true,
    showComment: false,
  },
  awaiting_confirmation: {
    icon: Clock,
    tone: 'border-info/30 bg-info/10',
    iconTone: 'text-info',
    title: 'Your account is awaiting confirmation',
    body: 'An administrator is reviewing your company information. You can look around and keep your company profile up to date. Requests and sessions open as soon as it is approved.',
    cta: 'View company profile',
    to: '/client/company',
    primary: false,
    showComment: false,
  },
  changes_requested: {
    icon: AlertTriangle,
    tone: 'border-warning/40 bg-warning/10',
    iconTone: 'text-warning',
    title: 'The administrator asked for changes',
    body: 'Please update your company information and send it again. Requests and sessions stay closed until it is approved.',
    cta: 'Update and send again',
    to: '/client/company#approval',
    primary: true,
    showComment: true,
  },
  rejected: {
    icon: ShieldX,
    tone: 'border-destructive/30 bg-destructive/10',
    iconTone: 'text-destructive',
    title: 'Your account was not approved',
    body: 'You cannot create requests or book sessions. Contact support if you think this is a mistake.',
    cta: 'Contact support',
    to: '/client/support',
    primary: false,
    showComment: true,
  },
};

/** Shown above every client page until an administrator has approved the account. */
export default function ClientApprovalBanner() {
  const { t } = useTranslation();
  const { data } = useClientApproval();

  if (!data || !data.required) return null;
  const status = data.status;
  if (status === 'approved') return null;

  const v = VIEWS[status];
  const Icon = v.icon;
  const comment = v.showComment ? data.comment?.trim() : '';

  return (
    <div role="status" className={cn('mb-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start', v.tone)}>
      <Icon aria-hidden="true" className={cn('h-5 w-5 shrink-0 sm:mt-0.5', v.iconTone)} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold text-foreground">{t(`client_approval.${status}_title`, v.title)}</p>
        <p className="text-sm text-muted-foreground">{t(`client_approval.${status}_body`, v.body)}</p>
        {comment ? (
          <blockquote className="max-h-28 overflow-auto whitespace-pre-line rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground">
            {comment}
          </blockquote>
        ) : null}
      </div>
      <Button asChild size="sm" variant={v.primary ? 'default' : 'outline'} className="shrink-0">
        <Link to={v.to}>{t(`client_approval.${status}_cta`, v.cta)}</Link>
      </Button>
    </div>
  );
}
