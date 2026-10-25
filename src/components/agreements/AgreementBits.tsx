import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Circle, FileSignature, Handshake, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHIP, ICON } from '@/components/tracking/trackingStyles';
import { MAIN_STEPS, STATUS_COLOR, stepIndex, type SaStatus, type SaTerms } from '@/lib/agreements/model';
import { useAgreementTags } from '@/hooks/useAgreements';

export const money = (n: number | null | undefined, cur = 'USD', lang = 'en') =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? '—'
    : new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en-GB', { style: 'currency', currency: /^[A-Z]{3}$/.test(cur) ? cur : 'USD', maximumFractionDigits: 2 }).format(Number(n));

export const fmtDate = (iso: string | null | undefined, lang = 'en') => {
  if (!iso) return '—';
  const ms = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms)) : '—';
};

export function AgreementStatusBadge({ status, className }: { status: SaStatus; className?: string }) {
  const { t } = useTranslation();
  const color = STATUS_COLOR[status] ?? 'muted';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', CHIP[color], className)}>
      <Handshake className={cn('h-3 w-3', ICON[color])} aria-hidden /> {t(`agreements.status.${status}`)}
    </span>
  );
}

/** "Agreement: <name>" chip for one ticket header (nothing when the ticket has no agreement). */
export function AgreementTicketTag({ ticketId, portal }: { ticketId: string; portal: 'client' | 'consultant' | 'admin' }) {
  const tags = useAgreementTags([ticketId]);
  const tag = tags.get(ticketId);
  if (!tag) return null;
  return <AgreementTagChip name={tag.name} to={portal === 'admin' ? '/admin/agreements' : `/${portal}/agreements/${tag.agreement_id}`} />;
}

export function AgreementTagChip({ name, to }: { name: string; to?: string }) {
  const { t } = useTranslation();
  const body = (
    <span className={cn('inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium', CHIP.primary)} title={name}>
      <Handshake className="h-3 w-3 shrink-0 text-primary" aria-hidden /> <span className="truncate">{t('agreements.tag', { name })}</span>
    </span>
  );
  return to ? <Link to={to} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}

/** "Why staying on the platform protects you" - shown to both sides on requests, applications and active agreements. */
export function ProtectionBox({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const points = ['nda', 'payment', 'dispute', 'sla'] as const;
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm" role="note">
      <p className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> {t('agreements.protect.title')}</p>
      {!compact && <p className="mt-1 text-muted-foreground">{t('agreements.protect.intro')}</p>}
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> {t(`agreements.protect.${p}`)}</li>
        ))}
      </ul>
    </div>
  );
}

export function LegalDraftBanner() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-warning/50 bg-warning/15 p-3 text-sm text-foreground" role="status">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div><p className="font-semibold">{t('agreements.legal.draftTitle')}</p><p className="text-muted-foreground">{t('agreements.legal.draftText')}</p></div>
    </div>
  );
}

/** Lifecycle steps in the ticket-tracking style; end states shown as a final chip. */
export function AgreementSteps({ status }: { status: SaStatus }) {
  const { t } = useTranslation();
  const idx = stepIndex(status);
  const ended = ['expired', 'terminated', 'archived'].includes(status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={t('agreements.steps.label')}>
      {MAIN_STEPS.map((s, i) => {
        const done = i < idx || ended;
        const current = i === idx && !ended;
        return (
          <li key={s} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', current ? CHIP.primary : done ? CHIP.success : CHIP.muted)} aria-current={current ? 'step' : undefined}>
            {done ? <CheckCircle2 className="h-3 w-3 text-success" aria-hidden /> : <Circle className={cn('h-3 w-3', current ? 'text-primary' : 'text-muted-foreground')} aria-hidden />}
            {t(`agreements.status.${s}`)}
          </li>
        );
      })}
      {(ended || status === 'suspended') && <li><AgreementStatusBadge status={status} /></li>}
    </ol>
  );
}

/** The terms as both sides see them (rates only when passed in, i.e. for the parties and admins). */
export function TermsSummary({ terms, showRate = true }: { terms: Partial<SaTerms> & Pick<SaTerms, 'model' | 'term' | 'scope'>; showRate?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const rate = terms.rate;
  const rows: Array<[string, string]> = [
    [t('agreements.f.modules'), terms.scope?.modules?.join(', ') || '—'],
    [t('agreements.f.versions'), terms.scope?.versions?.join(', ') || '—'],
    [t('agreements.f.systems'), terms.scope?.systems?.join(', ') || '—'],
    [t('agreements.f.term'), `${fmtDate(terms.term?.start_date, lang)} – ${terms.term?.end_date ? fmtDate(terms.term.end_date, lang) : t('agreements.f.openEnded')}`],
    [t('agreements.f.notice'), t('agreements.f.days', { count: terms.term?.notice_days ?? 0 })],
    [t('agreements.f.model'), t(`agreements.model.${terms.model}`)],
  ];
  if (terms.model === 'hours_bank' && terms.bank) {
    rows.push([t('agreements.f.bankHours'), t('agreements.f.hoursMonth', { count: terms.bank.hours_per_month })]);
    rows.push([t('agreements.f.rollover'), terms.bank.rollover === 'none' ? t('agreements.rollover.none')
      : terms.bank.rollover === 'hours' ? t('agreements.rollover.hoursN', { count: terms.bank.rollover_hours }) : t('agreements.rollover.monthsN', { count: terms.bank.rollover_months })]);
    rows.push([t('agreements.f.unused'), t(`agreements.unused.${terms.bank.unused}`)]);
  }
  if (terms.model === 'availability') rows.push([t('agreements.f.capacity'), t('agreements.f.hoursWeek', { count: Number(terms.capacity_hours_per_week ?? 0) })]);
  if (showRate && rate && rate.hourly_rate > 0) {
    rows.push([t('agreements.f.rate'), `${money(rate.hourly_rate, rate.currency, lang)} / ${t('agreements.f.hour')}`]);
    if (rate.s1_multiplier) rows.push([t('agreements.f.s1'), `× ${rate.s1_multiplier}`]);
    if (rate.ooh_multiplier) rows.push([t('agreements.f.ooh'), `× ${rate.ooh_multiplier}`]);
    const ov = terms.bank?.overage_rate ?? rate.overage_rate;
    if (terms.model === 'hours_bank') rows.push([t('agreements.f.overage'), ov ? money(ov, rate.currency, lang) : t('agreements.f.overageSame')]);
  }
  rows.push([t('agreements.f.sla'), terms.sla?.summary || t('agreements.f.slaDefault')]);
  if (terms.nda_required !== undefined) rows.push([t('agreements.f.nda'), terms.nda_required ? t('agreements.yes') : t('agreements.no')]);
  if (terms.term) rows.push([t('agreements.f.autoRenew'), terms.term.auto_renew ? t('agreements.f.autoRenewOn', { count: terms.term.renew_months }) : t('agreements.no')]);
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium text-foreground [overflow-wrap:anywhere]">{v}</dd></div>
        ))}
      </dl>
      {(terms.scope?.covered || terms.scope?.not_covered) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-success/30 bg-success/5 p-3 text-sm"><p className="font-medium">{t('agreements.f.covered')}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{terms.scope?.covered || '—'}</p></div>
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">{t('agreements.f.notCovered')}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{terms.scope?.not_covered || '—'}</p></div>
        </div>
      )}
    </div>
  );
}

export function NotReadyCard({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border bg-card p-6 text-sm">
      <p className="flex items-center gap-2 font-semibold"><FileSignature className="h-4 w-4 text-primary" aria-hidden /> {disabled ? t('agreements.off.title') : t('agreements.notReady.title')}</p>
      <p className="mt-1 text-muted-foreground">{disabled ? t('agreements.off.text') : t('agreements.notReady.text')}</p>
    </div>
  );
}
