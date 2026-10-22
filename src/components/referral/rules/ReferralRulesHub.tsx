import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BadgeCheck, BookOpen, Calculator, Check, ClipboardCheck, Coins, Download, Info, Lock, Scale, Share2, ShieldAlert, TrendingUp, UserPlus, Wallet,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReferralAckPanel from '@/components/referral/ReferralAckPanel';
import TierLadder from '@/components/referral/TierLadder';
import type { MyReferral, ReferralOverview } from '@/hooks/useReferralProgram';
import { formatRate, MAN_DAY_HOURS, rateRangeText, settingsTiers, tierFor, type RulesSection } from '@/lib/referrals';
import { JOURNEY, journeyProgress, referralChecklist, simDefaultRate, type CheckId, type CheckState } from '@/lib/referralRules';
import { downloadRulesPdf } from '@/lib/referralRulesPdf';
import { scrollToElement } from '@/lib/scrollUtils';
import { cn } from '@/lib/utils';
import { buildRulesContent, type RulesBlock } from './rulesContent';
import RulesSimulator from './RulesSimulator';

const ICON: Record<RulesSection, typeof Info> = {
  overview: Info, prerequisites: ClipboardCheck, earn: Coins, rates: TrendingUp, payment: Wallet, rules: Scale, simulator: Calculator,
};
const sectionId = (id: RulesSection) => `refz-rules-${id}`;

function Section({ block, children, moreTitle, hideList = false }: { block: RulesBlock; children?: ReactNode; moreTitle?: string; hideList?: boolean }) {
  const { t } = useTranslation();
  const Icon = ICON[block.id];
  return (
    <section id={sectionId(block.id)} aria-labelledby={`${sectionId(block.id)}-h`} tabIndex={-1} className="scroll-mt-28 rounded-2xl border border-border/60 bg-card p-4 sm:p-5 space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <h3 id={`${sectionId(block.id)}-h`} className="flex items-center gap-2 text-base font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10"><Icon className="h-4 w-4 text-primary" aria-hidden="true" /></span>
        {block.title}
      </h3>
      {block.note && <p className="rounded-xl bg-primary/5 p-3 text-sm" dir="auto">{block.note}</p>}
      {children}
      {!hideList && block.bullets.length > 0 && <ul className="list-disc ps-5 space-y-1 text-sm text-muted-foreground">{block.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
      {!hideList && block.more.length > 0 && (
        <details className="rounded-xl border border-border/60 p-3 text-sm">
          <summary className="cursor-pointer font-medium">{moreTitle ?? t('refr.learn_more', 'Learn more')}</summary>
          <ul className="mt-2 list-disc ps-5 space-y-1 text-muted-foreground">{block.more.map((b) => <li key={b}>{b}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

const STATE_STYLE: Record<CheckState, { cls: string; Icon: typeof Check }> = {
  done: { cls: 'bg-success/15 text-success', Icon: Check },
  todo: { cls: 'bg-warning/15 text-warning', Icon: Info },
  locked: { cls: 'bg-muted text-muted-foreground', Icon: Lock },
};

/**
 * "Programme rules" hub on the Refer & earn page: what the programme is, the live prerequisites of the signed-in
 * consultant, how earnings work, rates, payment, rules and a simulator. All numbers come from the live settings
 * (my_referral_overview), notes from the administrator settings (plain text).
 */
export default function ReferralRulesHub({ ov, referrals, money, date, onDone, policy }: {
  ov: ReferralOverview; referrals: MyReferral[]; money: (v: number) => string; date: (iso: string | null | undefined) => string; onDone: () => void;
  /** "Programme policy" cards (Refer & earn page): replace the short rules list on screen; the PDF keeps the list. */
  policy?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'ar' = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const s = ov.settings;
  const tiers = settingsTiers(s);
  const my = tierFor(ov.tier_count, tiers);
  const rate = simDefaultRate(ov.sim_defaults);
  const blocks = buildRulesContent(t, { s, tiers, tierCount: ov.tier_count, lang, money, date, exampleFee: (rate ?? 50) * MAN_DAY_HOURS });
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b])) as Record<RulesSection, RulesBlock>;
  const [active, setActive] = useState<RulesSection>('overview');
  const [ackOpen, setAckOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Scroll-spy: the section nearest the top of the viewport is the current chip.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (seen[0]) setActive(seen[0].target.id.replace('refz-rules-', '') as RulesSection);
    }, { rootMargin: '-25% 0px -65% 0px' });
    blocks.forEach((b) => { const el = document.getElementById(sectionId(b.id)); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [blocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = (id: RulesSection) => {
    const el = document.getElementById(sectionId(id));
    if (!el) return;
    setActive(id);
    scrollToElement(el, (navRef.current?.getBoundingClientRect().height ?? 0) + 80);
    el.focus({ preventScroll: true });
  };
  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) * (lang === 'ar' ? -1 : 1);
    if (!dir && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = blocks.length;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + dir + n) % n;
    chipRefs.current[to]?.focus();
  };

  const check = referralChecklist({
    profileSubmitted: ov.eligibility.profile_submitted, interviewPassed: ov.activation.interview_passed, bestScore: ov.activation.best_score,
    passMark: ov.activation.pass_mark, acknowledged: ov.activation.acknowledged, verified: ov.eligibility.verified, policy: ov.eligibility.policy,
    payoutDetails: ov.eligibility.payout_details, suspended: ov.eligibility.suspended,
  });
  const journey = journeyProgress({
    clicks: ov.funnel.clicks, signups: ov.funnel.signups, activePairs: referrals.filter((r) => r.activation_status === 'active').length,
    paying: ov.funnel.paying, lifetime: ov.earnings.reduce((n, e) => n + e.lifetime, 0),
  });

  const checkText: Record<CheckId, { label: string; detail: string; action?: ReactNode }> = {
    profile: { label: t('refr.c_profile', 'Profile submitted'), detail: ov.eligibility.profile_submitted ? t('refr.c_done', 'Done') : t('refr.c_profile_todo', 'Complete and submit your profile.'),
      action: !ov.eligibility.profile_submitted ? <Button asChild size="sm" variant="outline"><Link to="/consultant/profile">{t('refr.c_profile_btn', 'Open profile')}</Link></Button> : undefined },
    interview: { label: t('refr.c_interview', 'AI interview passed'),
      detail: ov.activation.interview_passed
        ? t('refr.c_interview_done', 'Passed (pass mark {{pass}}).', { pass: ov.activation.pass_mark })
        : ov.activation.best_score != null
          ? t('refr.c_interview_score', 'Best score {{score}} of the {{pass}} needed.', { score: Math.round(ov.activation.best_score), pass: ov.activation.pass_mark })
          : t('refr.c_interview_none', 'Score at least {{pass}} to take part.', { pass: ov.activation.pass_mark }),
      action: !ov.activation.interview_passed ? <Button asChild size="sm"><Link to="/consultant/interviews?start=1">{t('refr.c_interview_btn', 'Start AI interview')}</Link></Button> : undefined },
    terms: { label: t('refr.c_terms', 'Programme terms accepted'),
      detail: ov.activation.acknowledged ? t('refr.c_terms_done', 'Accepted (version {{v}}).', { v: s.terms_version }) : ov.activation.interview_passed ? t('refr.c_terms_todo', 'Read and accept the terms.') : t('refr.c_terms_locked', 'Opens after you pass the AI interview.'),
      action: !ov.activation.acknowledged && ov.activation.interview_passed ? <Button size="sm" variant="outline" onClick={() => setAckOpen(true)}>{t('refr.c_terms_btn', 'Accept the terms')}</Button> : undefined },
    verified: { label: t('refr.c_verified', 'Verified consultant account'), detail: ov.eligibility.verified ? t('refr.c_done', 'Done') : t('refr.c_verified_todo', 'Waiting for verification by our team.') },
    policy: { label: t('refr.c_policy', 'Consultant Service Policy accepted'), detail: ov.eligibility.policy ? t('refr.c_done', 'Done') : t('refr.c_policy_todo', 'Accept the current policy.'),
      action: !ov.eligibility.policy ? <Button asChild size="sm" variant="outline"><Link to="/consultant-policy">{t('refr.c_policy_btn', 'Open the policy')}</Link></Button> : undefined },
    payout: { label: t('refr.c_payout', 'Payout details added'), detail: ov.eligibility.payout_details ? t('refr.c_done', 'Done') : t('refr.c_payout_todo', 'Needed to be paid, not to share.'),
      action: !ov.eligibility.payout_details ? <Button asChild size="sm" variant="ghost"><Link to="/consultant/earnings">{t('refr.c_payout_btn', 'Add bank details')}</Link></Button> : undefined },
  };

  const steps: Record<string, { label: string; Icon: typeof Info }> = {
    share: { label: t('refr.j_share', 'Share your code'), Icon: Share2 },
    register: { label: t('refr.j_register', 'Colleague registers'), Icon: UserPlus },
    activate: { label: t('refr.j_activate', 'Both pass the AI interview and accept'), Icon: BadgeCheck },
    paid: { label: t('refr.j_paid', 'Colleague works, client pays'), Icon: ClipboardCheck },
    earn: { label: t('refr.j_earn', 'You earn'), Icon: Coins },
  };

  const timeline = [
    t('refr.t_created', 'Reward created'),
    t('refr.t_hold', 'Hold {{d}} days', { d: s.hold_days ?? 0 }),
    t('refr.t_available', 'Available'),
    t('refr.t_min', 'Minimum {{v}}', { v: money(s.min_payout) }),
    t('refr.t_paid', 'Paid with the normal payout'),
  ];

  const pdf = () => downloadRulesPdf({
    title: t('refr.title', 'Programme rules'),
    subtitle: t('refr.version', 'Terms version {{v}} of {{date}}', { v: s.terms_version, date: date(s.terms_published_at) }),
    disclaimer: t('refr.pdf_disclaimer', 'Draft for legal review. The full terms on aisupport360.com/referral-terms apply.'),
    lang, blocks: blocks.map((b) => ({ ...b, moreTitle: b.id === 'rules' ? t('refr.rej_title', 'What gets a referral rejected') : undefined })),
  });

  return (
    <Card className="rounded-2xl" aria-labelledby="refz-rules-title">
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="refz-rules-title" className="flex items-center gap-2 text-lg font-bold"><BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />{t('refr.title', 'Programme rules')}</h2>
            <p className="text-xs text-muted-foreground">
              <Badge variant="outline" className="me-1 text-[10px]">{t('refz.draft', 'Draft')}</Badge>
              {t('refr.version', 'Terms version {{v}} of {{date}}', { v: s.terms_version, date: date(s.terms_published_at) })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={pdf}><Download className="me-1 h-4 w-4" />{t('refr.pdf', 'Download rules (PDF)')}</Button>
            <Button asChild size="sm" variant="ghost"><Link to="/referral-terms">{t('refr.full_terms', 'Read full terms')}</Link></Button>
          </div>
        </div>

        <div ref={navRef} className="sticky top-16 z-20 -mx-2 rounded-xl bg-card/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <nav aria-label={t('refr.nav', 'Programme rules sections')}>
            <ul className="flex gap-2 overflow-x-auto pb-1">
              {blocks.map((b, i) => (
                <li key={b.id} className="shrink-0">
                  <button type="button" ref={(el) => { chipRefs.current[i] = el; }} aria-controls={sectionId(b.id)} aria-current={active === b.id ? 'true' : undefined}
                    onClick={() => jump(b.id)} onKeyDown={(e) => onChipKey(e, i)}
                    className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active === b.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted')}>
                    {b.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="space-y-4">
          <Section block={byId.overview}>
            <p className="text-sm font-medium">{t('refr.promise', 'Bring SAP consultants you trust - when they earn, you earn {{rate}} % of their fee for {{months}} months, paid by AI Support 360.', { rate: rateRangeText(tiers), months: s.months })}</p>
            <ol className="grid gap-2 sm:grid-cols-5" aria-label={t('refr.journey', 'Your journey')}>
              {JOURNEY.map((id, i) => {
                const done = journey.done[id];
                const current = i === journey.current;
                const { label, Icon } = steps[id];
                return (
                  <li key={id} aria-current={current ? 'step' : undefined}
                    className={cn('flex items-center gap-2 rounded-xl border p-2 text-xs sm:flex-col sm:text-center',
                      done ? 'border-success/40 bg-success/10' : current ? 'border-primary bg-primary/10 font-semibold' : 'border-border/60')}>
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', done ? 'bg-success text-success-foreground' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      {done ? <Check className="h-4 w-4" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <span>{i + 1}. {label}{done && <span className="sr-only"> ({t('refr.c_done', 'Done')})</span>}</span>
                  </li>
                );
              })}
            </ol>
          </Section>

          <Section block={byId.prerequisites}>
            <p role="status" className={cn('rounded-xl p-3 text-sm font-semibold', check.active ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
              {check.suspended
                ? t('refr.state_suspended', 'Your account is suspended - the programme is LOCKED.')
                : check.active ? t('refr.state_active', 'Your programme is ACTIVE') : t('refr.state_locked', 'Your programme is LOCKED - {{count}} steps left', { count: check.left })}
            </p>
            <ul className="grid gap-2 md:grid-cols-2">
              {check.items.map((it) => {
                const { cls, Icon } = STATE_STYLE[it.state];
                const x = checkText[it.id];
                return (
                  <li key={it.id} className="flex items-start gap-3 rounded-xl border border-border/60 p-3" data-state={it.state}>
                    <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', cls)}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{t(`refr.st_${it.state}`, it.state === 'done' ? 'Done' : it.state === 'todo' ? 'To do' : 'Locked')}</span>
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium">{x.label}{!it.required && <span className="ms-1 text-xs font-normal text-muted-foreground">({t('refr.c_optional', 'to be paid')})</span>}</p>
                      <p className="text-xs text-muted-foreground">{x.detail}</p>
                      {x.action}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section block={byId.earn}>
            <p className="rounded-xl bg-muted/40 p-3 text-sm" dir="auto">
              {t('refr.formula', '{{rate}} % of the consultant fee of every man-day: fee = approved hourly rate x approved hours; man-day = {{h}} hours.', { rate: formatRate(my.rate), h: MAN_DAY_HOURS })}
            </p>
          </Section>

          <Section block={byId.rates}>
            <TierLadder tiers={tiers} count={ov.tier_count} compact />
          </Section>

          <Section block={byId.payment}>
            <ol className="grid gap-2 sm:grid-cols-5" aria-label={t('refr.timeline', 'From reward to payout')}>
              {timeline.map((x, i) => (
                <li key={x} className="flex items-center gap-2 rounded-xl border border-border/60 p-2 text-xs sm:flex-col sm:text-center">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{i + 1}</span>{x}
                </li>
              ))}
            </ol>
            <p className="text-xs"><Link to="/consultant/earnings" className="text-primary underline">{t('refr.see_earnings', 'Earnings')}</Link>{' · '}
              <Link to="?tab=calculations" className="text-primary underline">{t('refz.tab_calc', 'Referral calculations')}</Link></p>
          </Section>

          <Section block={byId.rules} moreTitle={t('refr.rej_title', 'What gets a referral rejected')} hideList={!!policy}>
            <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{t('refr.rej_short', 'Referrals and rewards with fraud signals are reviewed first; nothing is paid until they are cleared.')}</span>
            </div>
            {policy}
          </Section>

          <Section block={byId.simulator}>
            <RulesSimulator
              tiers={tiers} money={money} defaults={ov.sim_defaults}
              settings={{ tiers, months: s.months, minInvoice: s.min_invoice ?? 0, monthlyCap: s.monthly_cap ?? null, monthlyCapReferred: s.monthly_cap_referred ?? null, maxPerReferred: s.max_per_referred ?? null }} />
          </Section>
        </div>
      </CardContent>

      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t('refr.c_terms_btn', 'Accept the terms')}</DialogTitle></DialogHeader>
          <ReferralAckPanel version={s.terms_version} rateText={rateRangeText(tiers)} months={s.months} passMark={ov.activation.pass_mark} source="page"
            onDone={() => { setAckOpen(false); onDone(); }} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
