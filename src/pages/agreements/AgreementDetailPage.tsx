import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgreement, useAgreementsMine, useRefreshAgreements } from '@/hooks/useAgreements';
import { NotReadyCard } from '@/components/agreements/AgreementBits';
import AgreementWorkspace from '@/components/agreements/AgreementWorkspace';
import AgreementRequestForm from '@/components/agreements/AgreementRequestForm';
import type { SaError } from '@/lib/agreements/api';
import { emptyTerms } from '@/lib/agreements/model';

export default function AgreementDetailPage({ portal }: { portal: 'client' | 'consultant' }) {
  const { t } = useTranslation();
  const { agreementId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const mine = useAgreementsMine();
  const q = useAgreement(agreementId);
  const refresh = useRefreshAgreements();
  const back = <Button variant="ghost" size="sm" asChild><Link to={`/${portal}/agreements`}><ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" />{t('agreements.back')}</Link></Button>;

  if (q.isLoading || mine.isLoading) return <div className="p-6"><Skeleton className="h-64 w-full rounded-2xl" /></div>;
  if (!mine.data?.ready || !mine.data.enabled) return <div className="space-y-4 p-4 md:p-6">{back}<NotReadyCard disabled={mine.data?.ready} /></div>;
  if (q.error || !q.data) {
    const code = (q.error as SaError | null)?.code;
    return <div className="space-y-4 p-4 md:p-6">{back}<p className="rounded-2xl border p-6 text-sm">{code === 'sa_forbidden' ? t('agreements.err.sa_forbidden') : t('agreements.err.generic')}</p></div>;
  }
  const a = q.data;
  if (params.get('edit') === '1' && a.role === 'client' && ['draft', 'open'].includes(a.status) && a.terms) {
    return (
      <div className="space-y-4 p-4 md:p-6">{back}
        <AgreementRequestForm settings={mine.data.settings} agreementId={a.id} initial={{ request: a.request as never, terms: { ...emptyTerms(a.terms.model), ...a.terms } }}
          onCancel={() => setParams({})} onSaved={() => { setParams({}); refresh(); nav(`/client/agreements/${a.id}`); }} />
      </div>
    );
  }
  return <div className="space-y-4 p-4 md:p-6">{back}<AgreementWorkspace a={a} settings={mine.data.settings} portal={portal} /></div>;
}
