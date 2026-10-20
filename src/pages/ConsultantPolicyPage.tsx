import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyPolicy, usePolicyVersion } from '@/hooks/useConsultantPolicy';
import { needsAcknowledgement } from '@/lib/consultantPolicy';
import PolicyDocument from '@/components/consultant/policy/PolicyDocument';
import PolicyAcceptForm from '@/components/consultant/policy/PolicyAcceptForm';
import { policyLang } from '@/components/consultant/policy/PolicyDialog';

/** Public, printable Consultant Service Policy (/consultant-policy, optional ?version=N). Signed-in consultants can confirm here too. */
export default function ConsultantPolicyPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const requested = Number(params.get('version')) || null;
  const policyQ = usePolicyVersion(requested);
  const my = useMyPolicy();
  const [lang, setLang] = useState<'en' | 'ar'>(policyLang(i18n.language));
  const policy = policyQ.data?.policy;
  const canConfirm = !!policy && policyQ.data?.ready && my.ready && my.isConsultant
    && needsAcknowledgement(my.status.state) && my.raw?.current_version === policy.version;

  return (
    <div className="min-h-screen bg-background flex flex-col" data-policy-print>
      <main className="flex-1 container mx-auto px-4 pb-16 print:p-0" style={{ paddingTop: 'calc(var(--public-header-h, 6rem) + 2rem)' }}>
        <article className="mx-auto max-w-3xl rounded-2xl border border-border/50 bg-card p-6 shadow-sm sm:p-10 print:border-0 print:shadow-none">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div role="group" aria-label={t('consultantPolicy.language', 'Language')} className="inline-flex rounded-xl border border-border p-1">
              {(['en', 'ar'] as const).map(l => (
                <Button key={l} type="button" size="sm" variant={lang === l ? 'default' : 'ghost'} aria-pressed={lang === l} onClick={() => setLang(l)}>
                  {l === 'en' ? 'English' : 'العربية'}
                </Button>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" />{t('consultantPolicy.print', 'Print')}
            </Button>
          </div>
          <h1 className="sr-only">{policy ? (lang === 'ar' ? policy.ar.title : policy.en.title) : 'Consultant Service Policy'}</h1>
          {policyQ.isLoading || !policy ? <Skeleton className="h-96 w-full" /> : <PolicyDocument policy={policy} lang={lang} />}
          {canConfirm && policy && (
            <div className="mt-8 border-t border-border pt-6 print:hidden">
              <PolicyAcceptForm version={policy.version} onAccept={async v => {
                await my.accept.mutateAsync({ version: v, lang, source: 'page' });
                toast.success(t('consultantPolicy.thanks', 'Thank you - the policy is confirmed.'));
              }} />
            </div>
          )}
          <p className="mt-8 text-sm text-muted-foreground print:hidden">
            <Link to="/for-consultants" className="text-primary underline">{t('consultantPolicy.forConsultants', 'Working as a consultant on AI Support 360')}</Link>
            {' · '}
            <Link to="/terms-and-conditions" className="text-primary underline">{t('footer.terms', 'Terms & Conditions')}</Link>
          </p>
        </article>
      </main>
    </div>
  );
}
