import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useClientApproval } from '@/hooks/useClientApproval';
import { canCreateRequests } from '@/lib/clientApproval';

const COPY = {
  draft: 'Finish your company setup first. We then send it to an administrator for review.',
  awaiting_confirmation: 'Your account is awaiting confirmation from an administrator. As soon as it is approved you can create requests and book sessions.',
  changes_requested: 'An administrator asked for changes to your company information. Update it and send it again.',
  rejected: 'Your account was not approved. Contact support if you think this is a mistake.',
} as const;

/** Keeps the "New request" form closed until an administrator has approved the account (the database enforces the same rule). */
export default function ApprovalGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data, isLoading } = useClientApproval();

  if (isLoading) {
    return (
      <div role="status" className="flex min-h-[30vh] items-center justify-center">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (!data || canCreateRequests(data)) return <>{children}</>;

  const status = data.status === 'approved' ? 'awaiting_confirmation' : data.status;
  return (
    <div className="mx-auto max-w-xl py-8">
      <Card className="rounded-2xl border-border/50">
        <CardContent className="space-y-4 p-6 text-center">
          <ShieldAlert aria-hidden="true" className="mx-auto h-10 w-10 text-warning" />
          <h1 className="text-xl font-bold text-foreground">{t('client_approval.gate_title', 'Requests open after approval')}</h1>
          <p className="text-sm text-muted-foreground">{t(`client_approval.gate_${status}`, COPY[status])}</p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild>
              <Link to={status === 'draft' ? '/client/onboarding' : '/client/company'}>{t('client_approval.gate_open_status', 'Open account status')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/client">{t('client_approval.gate_back', 'Back to dashboard')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
