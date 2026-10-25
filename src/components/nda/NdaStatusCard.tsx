import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, CheckCircle2, Clock, Download, FileSignature, IdCard, Loader2, PenTool, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useNdaStatus, useRefreshNda } from '@/hooks/useNdaSigning';
import { errorKey, ndaView, sendNdaReminder, type NdaEvidence, type NdaParty, type NdaStatus } from '@/lib/nda/api';
import { downloadNdaById } from '@/lib/nda/download';
import NdaSignDialog from './NdaSignDialog';

interface Props {
  ndaId?: string | null;
  consultantId?: string | null;
  clientId?: string | null;
  consultantName?: string;
  clientName?: string;
  /** Opens the signing step for the party who still has to sign (consultant first signature / client countersignature). */
  onReviewAndSign?: (s: NdaStatus) => void;
  /** Shown when the stricter signing is not installed (legacy box). */
  fallback?: React.ReactNode;
  className?: string;
  /** Element id for in-page links (ticket pages use "nda"). */
  anchorId?: string;
}

const fmt = (iso: string | null | undefined, lang: string) =>
  iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';

/**
 * The NDA box after the stricter signing (ticket page, NDA agreements pages, engagement checklist): "Review and sign"
 * for the party who still has to sign, "You signed on ..." + download for the signer, "Waiting for ... to sign" with a
 * rate-limited reminder, "Fully signed" + download for both, legacy marks and "Add my signature details".
 */
export default function NdaStatusCard({ ndaId, consultantId, clientId, consultantName, clientName, onReviewAndSign, fallback = null, className, anchorId }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const q = useNdaStatus({ ndaId, consultantId, clientId });
  const refresh = useRefreshNda();
  const [reminding, setReminding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [details, setDetails] = useState(false);

  if (q.isLoading) return <Skeleton className={`h-24 w-full rounded-2xl ${className ?? ''}`} />;
  const s = q.data;
  if (!s) return <>{fallback}</>;
  const v = ndaView(s);
  const roleLabel = (p: NdaParty | null) => (p ? t(`ndaSign.role.${p}`) : '');
  const otherName = v.other === 'consultant' ? consultantName : clientName;

  const download = async () => {
    if (!s.nda_id) return;
    setDownloading(true);
    try { await downloadNdaById(s.nda_id, { consultantName, clientName }, lang); }
    catch { toast.error(t('ndaSign.err.download')); }
    finally { setDownloading(false); }
  };
  const remind = async () => {
    setReminding(true);
    const r = await sendNdaReminder(s.nda_id ? { ndaId: s.nda_id } : { consultantId: s.consultant_id, clientId: s.client_id });
    setReminding(false);
    if (r.ok) { toast.success(t('ndaSign.card.reminderSent', { role: roleLabel(v.other) })); void refresh(); }
    else toast.error(t(errorKey(r.code)));
  };

  const evidenceLine = (p: NdaParty, e: NdaEvidence | null) => e && (
    <li key={p} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <IdCard className="h-3.5 w-3.5 text-primary" aria-hidden />
      <span className="font-medium text-foreground">{roleLabel(p)}:</span>
      <span>{e.signer_name}</span>
      <span aria-label={t('ndaSign.card.maskedId')} dir="ltr" className="font-mono">{t(`ndaSign.idType.${e.id_type}`)} · {e.id_country} · {e.id_masked}</span>
      <span>· {fmt(e.signed_at, lang)}</span>
      {e.kind === 'supplement' && <Badge variant="outline" className="text-[10px]">{t('ndaSign.card.detailsAddedLater')}</Badge>}
    </li>
  );

  const tone = v.kind === 'fully_signed' ? 'border-success/40' : v.kind === 'revoked' ? 'border-destructive/40' : 'border-warning/40';
  return (
    <div className={`space-y-3 rounded-2xl border bg-card p-4 ${tone} ${className ?? ''}`} data-testid="nda-status-card" id={anchorId}>
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileSignature className="h-4 w-4 text-primary" aria-hidden /> {t('ndaSign.card.title')}
      </div>

      {v.kind === 'sign' && (
        <div className="space-y-2 rounded-xl bg-warning/10 p-3" role="status">
          <p className="text-sm font-medium text-foreground">{t('ndaSign.card.yourTurn')}</p>
          <p className="text-xs text-muted-foreground">
            {v.me === 'client' && s.consultant.signed_at
              ? t('ndaSign.card.otherSigned', { name: consultantName || roleLabel('consultant'), date: fmt(s.consultant.signed_at, lang) })
              : t('ndaSign.card.signFirst')}
          </p>
          {onReviewAndSign && (
            <Button size="lg" className="w-full gap-2 sm:w-auto" onClick={() => onReviewAndSign(s)}><PenTool className="h-4 w-4" aria-hidden /> {t('ndaSign.card.reviewAndSign')}</Button>
          )}
        </div>
      )}

      {v.kind === 'waiting_other' && (
        <div className="space-y-3">
          {v.mySignedAt && (
            <div className="flex flex-col gap-2 rounded-xl bg-success/10 p-3 sm:flex-row sm:items-center sm:justify-between" role="status">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> {t('ndaSign.card.youSigned', { date: fmt(v.mySignedAt, lang) })}</p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={download} disabled={downloading || !s.nda_id}>
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />} {t('ndaSign.card.downloadMine')}
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4 text-warning" aria-hidden />
              {otherName ? t('ndaSign.card.waitingNamed', { role: roleLabel(v.other), name: otherName }) : t('ndaSign.card.waiting', { role: roleLabel(v.other) })}</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={remind} disabled={!v.canRemind || reminding}>
              {reminding ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BellRing className="h-3.5 w-3.5" aria-hidden />} {t('ndaSign.card.remind')}
            </Button>
          </div>
          {v.nextReminderAt && <p className="text-[11px] text-muted-foreground">{t('ndaSign.card.nextReminder', { date: fmt(v.nextReminderAt, lang) })}</p>}
        </div>
      )}

      {v.kind === 'fully_signed' && (
        <div className="flex flex-col gap-2 rounded-xl bg-success/10 p-3 sm:flex-row sm:items-center sm:justify-between" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground"><ShieldCheck className="h-4 w-4 text-success" aria-hidden /> {t('ndaSign.card.fully')}</p>
          <Button size="sm" className="gap-1.5" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />} {t('ndaSign.card.downloadFull')}
          </Button>
        </div>
      )}

      {v.kind === 'revoked' && (
        <div className="space-y-2 rounded-xl bg-destructive/10 p-3" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-destructive"><ShieldX className="h-4 w-4" aria-hidden /> {t('ndaSign.card.revoked', { date: fmt(s.revoked_at, lang) })}</p>
          {v.me === 'consultant' && onReviewAndSign && <Button size="sm" onClick={() => onReviewAndSign(s)}>{t('ndaSign.card.signNew')}</Button>}
        </div>
      )}

      {(s.consultant.evidence || s.client.evidence) && (
        <ul className="space-y-1">{evidenceLine('consultant', s.consultant.evidence)}{evidenceLine('client', s.client.evidence)}</ul>
      )}
      {v.legacy.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {v.legacy.map((p) => (
            <Badge key={p} variant="secondary" className="text-[10px]">{roleLabel(p)}: {t('ndaSign.card.legacy')}</Badge>
          ))}
          {v.canAddDetails && v.kind !== 'revoked' && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setDetails(true)}><IdCard className="h-3.5 w-3.5" aria-hidden /> {t('ndaSign.card.addDetails')}</Button>
          )}
        </div>
      )}
      {v.canAddDetails && v.me && s.nda_id && details && (
        <NdaSignDialog open={details} onOpenChange={setDetails} party={v.me} action="supplement" ndaId={s.nda_id} onDone={() => void refresh()} />
      )}
    </div>
  );
}
