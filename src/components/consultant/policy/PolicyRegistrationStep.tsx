import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useMyPolicy, usePolicyVersion } from '@/hooks/useConsultantPolicy';
import { isNewConsultant, needsAcknowledgement } from '@/lib/consultantPolicy';
import PolicyDocument from './PolicyDocument';
import PolicyAcceptForm from './PolicyAcceptForm';
import { policyLang, usePolicyStatusText } from './PolicyDialog';

/**
 * Last step of the consultant profile set-up (after the profile details, before the profile goes to review):
 * the policy in a scrollable panel with its summary, the required checkbox and the submit button.
 * The same for e-mail and Google sign-ups, because it runs after the account exists.
 */
export default function PolicyRegistrationStep({ verificationStatus }: { verificationStatus?: string | null }) {
  const { t, i18n } = useTranslation();
  const lang = policyLang(i18n.language);
  const { isGuest } = useGuestMode();
  const my = useMyPolicy();
  const version = my.raw?.current_version ?? null;
  const policyQ = usePolicyVersion(version);
  const statusText = usePolicyStatusText(my.status, my.raw?.grace_days);
  const marked = useRef<number | null>(null);
  const pending = needsAcknowledgement(my.status.state);

  useEffect(() => {
    if (!pending || !version || marked.current === version) return;
    marked.current = version;
    void my.markShown(version);
  }, [pending, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isGuest || my.loading || !policyQ.data) return null;
  const policy = policyQ.data.policy;
  const isNew = isNewConsultant(my.raw?.signed_up_at, my.raw?.effective_at) || !my.raw?.accepted_version;
  const inReview = !verificationStatus || verificationStatus === 'pending' || verificationStatus === 'under_review' || verificationStatus === 'on_hold';
  const readLink = <a href={`/consultant-policy?version=${policy.version}`} target="_blank" rel="noopener" className="text-sm font-medium text-primary underline">{t('consultantPolicy.readFull', 'Read the full policy (printable)')}</a>;

  return (
    <section id="service-policy" aria-labelledby="service-policy-title" className="scroll-mt-20 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <h2 id="service-policy-title" className="flex items-center gap-2 text-lg font-bold text-foreground">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        {pending && isNew && inReview ? t('consultantPolicy.stepTitleRequired', 'Required step: Consultant Service Policy') : t('consultantPolicy.sectionTitle', 'Consultant Service Policy')}
      </h2>
      {!my.ready || !policyQ.data.ready ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">{t('consultantPolicy.notReady', 'Confirming the policy will be available here shortly. You can already read it.')}</p>
          {readLink}
        </>
      ) : my.status.state === 'accepted' ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-foreground" data-testid="policy-accepted">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
          {t('consultantPolicy.accepted', 'Accepted version {{v}} on {{date}}.', { v: my.raw?.accepted_version, date: my.raw?.accepted_at ? format(new Date(my.raw.accepted_at), 'd MMM yyyy') : '' })}
          {readLink}
        </p>
      ) : pending && version ? (
        <>
          <p className="text-sm text-muted-foreground">
            {isNew && inReview
              ? t('consultantPolicy.stepIntroRequired', 'Read the summary and the policy, then accept it. It is one of the required items before you can submit your profile for review.')
              : t('consultantPolicy.updatedIntro', 'We have updated our service policy. Please read the summary and confirm it.')}
            {' '}{statusText}
          </p>
          <div role="region" tabIndex={0} aria-label={t('consultantPolicy.fullText', 'Full policy text')}
            className="max-h-96 overflow-y-auto rounded-xl border border-border bg-background p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <PolicyDocument policy={policy} lang={lang} headingLevel={3} />
          </div>
          {readLink}
          <PolicyAcceptForm
            version={version}
            submitLabel={isNew && inReview ? t('consultantPolicy.acceptRequired', 'Accept the policy') : t('consultantPolicy.confirm', 'Confirm')}
            onAccept={async v => {
              await my.accept.mutateAsync({ version: v, lang, source: isNew ? 'registration' : 'banner' });
              toast.success(isNew && inReview
                ? t('consultantPolicy.acceptedRequired', 'Policy accepted. Submit your profile below when every required item is complete.')
                : t('consultantPolicy.thanks', 'Thank you - the policy is confirmed.'));
            }}
          />
        </>
      ) : readLink}
    </section>
  );
}
