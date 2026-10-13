import { fill } from '@/lib/i18nFill';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Award, Brain, Briefcase, CheckCircle2, Clock, Cpu, Eye, FolderKanban, GraduationCap, Info,
  Lightbulb, Target, ShieldCheck, Wallet, Upload, User, Check, PartyPopper,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CONSULTANT_GUIDE, GUIDE_STEP_ORDER, fieldHints, minutesLeft, totalGuideMinutes, type FieldHintKey, type GuideStepKey,
} from '@/lib/consultantGuide';

export const GUIDE_ICONS: Record<GuideStepKey, LucideIcon> = {
  import: Upload, profile: User, skills: Cpu, certifications: Award, work: Briefcase,
  education: GraduationCap, projects: FolderKanban, availability: Clock, interview: Brain,
};

const TOTAL = GUIDE_STEP_ORDER.length;

/** Translated guide texts for one step, with the English content as defaults. */
function useStepText(key: GuideStepKey) {
  const { t } = useTranslation();
  const s = CONSULTANT_GUIDE[key];
  return {
    title: t(`guide.${key}.title`, s.title),
    why: t(`guide.${key}.why`, s.why),
    tips: s.tips.map((tip, i) => t(`guide.${key}.tips.${i}`, tip)),
    clientsSee: t(`guide.${key}.clients_see`, s.clientsSee),
    mistakes: s.mistakes.map((m, i) => t(`guide.${key}.mistakes.${i}`, m)),
    affects: s.affects.map((a) => t(`guide.affects.${a.replace(' ', '_').toLowerCase()}`, a)),
    minutes: s.minutes,
  };
}

/** The guide body shared by the desktop card and the mobile accordion. */
function GuideBody({ stepKey }: { stepKey: GuideStepKey }) {
  const { t } = useTranslation();
  const s = useStepText(stepKey);
  return (
    <div className="space-y-4 text-sm">
      <section>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Target className="w-3.5 h-3.5" aria-hidden="true" /> {t('guide.why_title', 'Why this matters')}
        </h4>
        <p className="mt-1 text-foreground">{s.why}</p>
      </section>
      <section>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" /> {t('guide.tips_title', 'Tips')}
        </h4>
        <ul className="mt-1.5 space-y-1.5">
          {s.tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl bg-primary/5 border border-primary/15 p-3">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
          <Eye className="w-3.5 h-3.5" aria-hidden="true" /> {t('guide.clients_see_title', 'What clients see')}
        </h4>
        <p className="mt-1 text-foreground">{s.clientsSee}</p>
      </section>
      <section>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive" aria-hidden="true" /> {t('guide.mistakes_title', 'Common mistakes')}
        </h4>
        <ul className="mt-1.5 space-y-1.5">
          {s.mistakes.map((m) => (
            <li key={m} className="flex items-start gap-2 text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="flex flex-wrap gap-1.5" aria-label={t('guide.affects_label', 'This step affects')}>
        {s.affects.map((a) => <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>)}
      </div>
    </div>
  );
}

/** Desktop: sticky "Guide" card beside the step card. */
export function OnboardingGuidePanel({ stepIndex, strength }: { stepIndex: number; strength: number }) {
  const { t } = useTranslation();
  const key = GUIDE_STEP_ORDER[stepIndex] ?? 'import';
  const Icon = GUIDE_ICONS[key];
  const s = useStepText(key);
  return (
    <Card className="rounded-2xl border-border/50 lg:sticky lg:top-28" aria-label={t('guide.title', 'Guide')}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">{t('guide.title', 'Guide')}</p>
            <h3 className="font-semibold text-foreground">{s.title}</h3>
            <p className="text-xs text-muted-foreground">
              {fill(t('guide.step_of', 'Step {{n}} of {{total}} · about {{m}} min', { n: stepIndex + 1, total: TOTAL, m: s.minutes }), { n: stepIndex + 1, total: TOTAL, m: s.minutes })}
            </p>
          </div>
        </div>
        <GuideBody stepKey={key} />
        <div className="pt-3 border-t border-border/50 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">{fill(t('guide.strength', 'Profile strength {{x}}%', { x: strength }), { x: strength })}</span>
          </div>
          <Progress value={strength} className="h-1.5" aria-label={fill(t('guide.strength', 'Profile strength {{x}}%', { x: strength }), { x: strength })} />
        </div>
      </CardContent>
    </Card>
  );
}

const storageKey = (key: string) => `onboarding-guide-open:${key}`;
const readOpen = (key: string): boolean => {
  try { return window.sessionStorage.getItem(storageKey(key)) === '1'; } catch { return false; }
};
const writeOpen = (key: string, open: boolean) => {
  try { window.sessionStorage.setItem(storageKey(key), open ? '1' : '0'); } catch { /* storage unavailable */ }
};

/** Mobile / tablet: collapsed "Need help with this step?" accordion above the step card. */
export function OnboardingGuideAccordion({ stepIndex }: { stepIndex: number }) {
  const { t } = useTranslation();
  const key = GUIDE_STEP_ORDER[stepIndex] ?? 'import';
  const [open, setOpen] = useState<string>(readOpen(key) ? key : '');
  useEffect(() => { setOpen(readOpen(key) ? key : ''); }, [key]);
  return (
    <Accordion
      type="single"
      collapsible
      value={open}
      onValueChange={(v) => { setOpen(v); writeOpen(key, v === key); }}
      className="rounded-2xl border border-border/50 bg-card px-4"
    >
      <AccordionItem value={key} className="border-0">
        <AccordionTrigger className="text-sm">
          <span className="flex items-center gap-2"><Info className="w-4 h-4 text-primary" aria-hidden="true" />{t('guide.need_help', 'Need help with this step?')}</span>
        </AccordionTrigger>
        <AccordionContent>
          <GuideBody stepKey={key} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** Mobile / tablet: slim sticky progress bar at the bottom. */
export function OnboardingMobileProgress({ stepIndex }: { stepIndex: number }) {
  const { t } = useTranslation();
  const pct = Math.round(((stepIndex + 1) / TOTAL) * 100);
  return (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border/50 bg-background/95 backdrop-blur px-4 py-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
        <span className="font-medium text-foreground">{fill(t('guide.step_n', 'Step {{n}} of {{total}}', { n: stepIndex + 1, total: TOTAL }), { n: stepIndex + 1, total: TOTAL })}</span>
        <span>{fill(t('guide.minutes_left', 'About {{m}} min left', { m: minutesLeft(stepIndex) }), { m: minutesLeft(stepIndex) })}</span>
      </div>
      <Progress value={pct} className="h-1" aria-label={fill(t('guide.step_n', 'Step {{n}} of {{total}}', { n: stepIndex + 1, total: TOTAL }), { n: stepIndex + 1, total: TOTAL })} />
    </div>
  );
}

/** Small info icon with a "Why we ask" tooltip next to a key field. */
export function FieldHint({ field }: { field: FieldHintKey }) {
  const { t } = useTranslation();
  const text = t(`guide.hint.${field}`, fieldHints[field]);
  const label = t('guide.why_we_ask', 'Why we ask');
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${text}`}
            className="inline-flex align-middle ms-1 text-muted-foreground hover:text-foreground rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs">
          <p className="font-semibold">{label}</p>
          <p>{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const WELCOME_KEY = 'consultant-onboarding-welcome-seen';
export const welcomeSeen = (): boolean => {
  try { return window.sessionStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; }
};
export const markWelcomeSeen = () => {
  try { window.sessionStorage.setItem(WELCOME_KEY, '1'); } catch { /* storage unavailable */ }
};

/** Shown once per browser session before step 0. */
export function OnboardingWelcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  const tiles: { icon: LucideIcon; text: string }[] = [
    { icon: Target, text: t('guide.welcome.benefit_match', 'Get matched to the right requests') },
    { icon: ShieldCheck, text: t('guide.welcome.benefit_trust', 'Build a trust score clients can see') },
    { icon: Wallet, text: t('guide.welcome.benefit_paid', 'Get paid within 15 business days') },
  ];
  return (
    <Card className="rounded-2xl border-border/50 max-w-2xl mx-auto">
      <CardContent className="p-6 md:p-10 text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">{t('guide.welcome.title', "Welcome. Let's set up your consultant profile")}</h1>
          <p className="text-sm text-muted-foreground">
            {fill(t('guide.welcome.subtitle', 'About {{total}} minutes. You can stop at any time and continue later.', { total: totalGuideMinutes() }), { total: totalGuideMinutes() })}
          </p>
        </div>
        <ul className="grid sm:grid-cols-3 gap-3">
          {tiles.map(({ icon: I, text }) => (
            <li key={text} className="rounded-xl border border-border/50 bg-muted/30 p-4 flex flex-col items-center gap-2">
              <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center"><I className="w-5 h-5" aria-hidden="true" /></span>
              <span className="text-sm font-medium text-foreground">{text}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col items-center gap-2">
          <Button size="lg" onClick={onStart} className="min-w-40">{t('guide.welcome.start', 'Start')}</Button>
          <Button variant="link" size="sm" className="text-muted-foreground" onClick={onSkip}>{t('guide.welcome.skip', 'Skip for now')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Completion card after "Finish Setup". */
export function OnboardingFinish({ onTour }: { onTour: () => void }) {
  const { t } = useTranslation();
  const next = [
    t('guide.finish.next_found', 'Clients and the AI matching can now find you'),
    t('guide.finish.next_bids', 'Place bids on open requests'),
    t('guide.finish.next_tour', 'Take the 2-minute portal tour'),
  ];
  return (
    <Card className="rounded-2xl border-border/50 max-w-xl mx-auto" role="status" aria-live="polite">
      <CardContent className="p-6 md:p-10 text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500">
          <Check className="w-8 h-8" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2">
          {t('guide.finish.title', 'Your profile is ready')} <PartyPopper className="w-5 h-5 text-accent" aria-hidden="true" />
        </h2>
        <div className="text-start space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('guide.finish.next_title', 'What happens next')}</p>
          <ol className="space-y-2">
            {next.map((n, i) => (
              <li key={n} className="flex items-center gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <span>{n}</span>
              </li>
            ))}
          </ol>
        </div>
        <Button size="lg" onClick={onTour}>{t('guide.finish.take_tour', 'Take the tour')}</Button>
      </CardContent>
    </Card>
  );
}

export default OnboardingGuidePanel;
