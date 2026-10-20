import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useMyPolicy, usePolicyVersion } from '@/hooks/useConsultantPolicy';
import { isNewConsultant, needsAcknowledgement } from '@/lib/consultantPolicy';
import PolicyDialog, { policyLang, usePolicyStatusText } from './PolicyDialog';

/** Opens the same dialog as the pop-up from a banner or an inline notice. */
function usePolicyDialogLauncher(source: 'banner') {
  const { t, i18n } = useTranslation();
  const my = useMyPolicy();
  const policyQ = usePolicyVersion(my.raw?.current_version ?? null);
  const [open, setOpen] = useState(false);
  const launch = () => { setOpen(true); if (my.raw?.current_version) void my.markShown(my.raw.current_version); };
  const dialog = open && policyQ.data?.ready ? (
    <PolicyDialog open onLater={() => setOpen(false)} policy={policyQ.data.policy} status={my.status} graceDays={my.raw?.grace_days}
      isNew={isNewConsultant(my.raw?.signed_up_at, my.raw?.effective_at)}
      onAccept={async v => {
        await my.accept.mutateAsync({ version: v, lang: policyLang(i18n.language), source });
        setOpen(false);
        toast.success(t('consultantPolicy.thanks', 'Thank you - the policy is confirmed.'));
      }} />
  ) : null;
  return { my, launch, dialog };
}

/** Persistent banner (dashboard; profile links to the inline step) until the current version is confirmed. */
export default function PolicyBanner({ inlineAnchor = false }: { inlineAnchor?: boolean }) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const { my, launch, dialog } = usePolicyDialogLauncher('banner');
  const statusText = usePolicyStatusText(my.status, my.raw?.grace_days);
  if (isGuest || !my.ready || !my.isConsultant || !needsAcknowledgement(my.status.state)) return null;
  const blocked = my.status.state === 'blocked';
  return (
    <>
      <div role={blocked ? 'alert' : 'status'} data-testid="policy-banner"
        className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${blocked ? 'border-destructive/40 bg-destructive/10' : 'border-primary/30 bg-primary/5'}`}>
        {blocked ? <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-destructive" /> : <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />}
        <div className="flex-1 text-sm text-foreground">
          <p className="font-semibold">{t('consultantPolicy.bannerTitle', 'Please confirm the Consultant Service Policy (version {{v}})', { v: my.raw?.current_version })}</p>
          <p className="text-muted-foreground">{statusText}</p>
        </div>
        {inlineAnchor
          ? <Button size="sm" asChild className="gradient-primary text-primary-foreground"><a href="#service-policy">{t('consultantPolicy.review', 'Review and confirm')}</a></Button>
          : <Button size="sm" className="gradient-primary text-primary-foreground" onClick={launch}>{t('consultantPolicy.review', 'Review and confirm')}</Button>}
      </div>
      {dialog}
    </>
  );
}

/** Inline notice on bid and assignment screens after the grace period, with the fix. */
export function PolicyBlockedNotice() {
  const { t } = useTranslation();
  const { my, launch, dialog } = usePolicyDialogLauncher('banner');
  if (my.status.state !== 'blocked') return null;
  return (
    <>
      <div role="alert" data-testid="policy-blocked" className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 text-destructive" />
        <span className="flex-1">{t('consultantPolicy.blockedAction', 'Confirm the Consultant Service Policy to place new bids and accept new assignments.')}</span>
        <Button size="sm" variant="outline" onClick={launch}>{t('consultantPolicy.review', 'Review and confirm')}</Button>
      </div>
      {dialog}
    </>
  );
}

export function usePolicyBlocked(): boolean {
  return useMyPolicy().status.state === 'blocked';
}
