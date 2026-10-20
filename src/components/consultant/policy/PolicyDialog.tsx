import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DEFAULT_POLICY_GRACE_DAYS, type PolicyStatus, type PolicyVersion } from '@/lib/consultantPolicy';
import PolicyDocument from './PolicyDocument';
import PolicyAcceptForm from './PolicyAcceptForm';

/** One sentence about the deadline and what happens after it (shared by the pop-up, banner and inline step). */
export function usePolicyStatusText(status: PolicyStatus, graceDays: number | null | undefined): string {
  const { t } = useTranslation();
  if (status.state === 'blocked') return t('consultantPolicy.blocked', 'Until you confirm, you cannot accept new assignments or place new bids, and you are not shown in search, matching or Critical alerts. Your current tickets continue.');
  if (status.state === 'grace' && status.deadline) return t('consultantPolicy.graceUntil', 'Please confirm by {{date}}. Until then nothing changes for you.', { date: format(new Date(status.deadline), 'd MMM yyyy') });
  return t('consultantPolicy.graceDays', 'Please confirm within {{n}} days. Until then nothing changes for you.', { n: graceDays ?? DEFAULT_POLICY_GRACE_DAYS });
}

export function policyLang(language: string | undefined): 'en' | 'ar' {
  return language?.startsWith('ar') ? 'ar' : 'en';
}

interface Props {
  open: boolean;
  /** Closing (Escape, outside click, "Remind me later" or "Close") counts as "later" for this sign-in. */
  onLater: () => void;
  policy: PolicyVersion;
  status: PolicyStatus;
  graceDays: number | null | undefined;
  isNew: boolean;
  onAccept: (version: number) => Promise<void>;
}

/** "Please confirm our updated service policy": summary, the full text in a scrollable panel, checkbox + Confirm. */
export default function PolicyDialog({ open, onLater, policy, status, graceDays, isNew, onAccept }: Props) {
  const { t, i18n } = useTranslation();
  const lang = policyLang(i18n.language);
  const statusText = usePolicyStatusText(status, graceDays);
  const text = lang === 'ar' ? policy.ar : policy.en;
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onLater(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" data-testid="policy-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            {isNew ? t('consultantPolicy.titleNew', 'Please confirm the Consultant Service Policy') : t('consultantPolicy.titleUpdated', 'Please confirm our updated service policy')}
          </DialogTitle>
          <DialogDescription className={status.state === 'blocked' ? 'text-destructive' : undefined}>{statusText}</DialogDescription>
        </DialogHeader>
        <section aria-label={t('consultantPolicy.summary', 'Summary')} lang={lang} className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <p className="mb-1 text-sm font-semibold text-foreground">{text.title} · {t('consultantPolicy.version', 'version {{v}}', { v: policy.version })}</p>
          <p className="text-sm leading-6 text-foreground">{text.summary}</p>
        </section>
        <div role="region" tabIndex={0} aria-label={t('consultantPolicy.fullText', 'Full policy text')}
          className="max-h-64 overflow-y-auto rounded-xl border border-border p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <PolicyDocument policy={policy} lang={lang} showTitle={false} showSummary={false} headingLevel={3} />
        </div>
        <a href={`/consultant-policy?version=${policy.version}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline">
          {t('consultantPolicy.readFull', 'Read the full policy (printable)')}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <PolicyAcceptForm version={policy.version} onAccept={onAccept} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onLater}>
            {status.canSnooze ? t('consultantPolicy.later', 'Remind me later') : t('consultantPolicy.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
