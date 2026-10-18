import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Target, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { fill } from '@/lib/i18nFill';
import { totalGuideMinutes, type GuideStepKey } from '@/lib/consultantGuide';
import type { profileCompleteness } from '@/lib/profileCompleteness';
import { GUIDE_ICONS, GuideBody, OnboardingFinish, useStepText } from './OnboardingGuidePanel';

type Completeness = ReturnType<typeof profileCompleteness>;
const read = (key: string): boolean | null => {
  try { const value = localStorage.getItem(key); return value === null ? null : value === '1'; } catch { return null; }
};
const write = (key: string, value: boolean) => {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ }
};
const Context = createContext({ enabled: true, setup: false, strength: null as number | null, completeness: null as Completeness | null, setEnabled: (_value: boolean) => {}, setCompleteness: (_value: Completeness) => {} });

export function EmbeddedGuideProvider({ setup, children }: { setup: boolean; children: ReactNode }) {
  const [enabled, updateEnabled] = useState(() => read('consultant-step-guides') ?? true);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  return <Context.Provider value={{ enabled, setup, strength: completeness?.percent ?? null, completeness, setCompleteness,
    setEnabled: value => { updateEnabled(value); write('consultant-step-guides', value); } }}>{children}</Context.Provider>;
}

export const useEmbeddedGuides = () => useContext(Context);

export function EmbeddedGuideSwitch() {
  const { t } = useTranslation();
  const { enabled, setEnabled } = useEmbeddedGuides();
  return <label className="flex items-center gap-2 text-sm" htmlFor="show-step-guides">
    <Switch id="show-step-guides" checked={enabled} onCheckedChange={setEnabled} />
    {t('guide.embedded.show_all', 'Show step guides')}
  </label>;
}

export function EmbeddedGuideCard({ section, stepKey }: { section: string; stepKey: GuideStepKey }) {
  const { t } = useTranslation();
  const { enabled, setup, strength } = useEmbeddedGuides();
  const key = `consultant-step-guide:${section}`;
  const [choice, setChoice] = useState<boolean | null>(() => read(key));
  useEffect(() => { setChoice(read(key)); }, [key]);
  const open = choice ?? (setup || (strength !== null && strength < 80));
  const s = useStepText(stepKey);
  const Icon = GUIDE_ICONS[stepKey];
  if (!enabled) return null;
  return <Card className="rounded-2xl border-primary/15 bg-primary/5 mb-4" aria-label={`${t('guide.title', 'Guide')}: ${s.title}`}>
    <CardContent className="p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Icon className="w-5 h-5" aria-hidden="true" /></span>
          <div><p className="text-xs text-muted-foreground">{t('guide.title', 'Guide')}</p><h3 className="font-semibold">{s.title}</h3>
            <p className="text-xs text-muted-foreground">{fill(t('guide.embedded.minutes', 'about {{m}} min', { m: s.minutes }), { m: s.minutes })}</p></div>
        </div>
        <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={`guide-${section}`} onClick={() => { setChoice(!open); write(key, !open); }}>
          {open ? <ChevronUp className="w-4 h-4 me-1" /> : <ChevronDown className="w-4 h-4 me-1" />}
          {open ? t('guide.embedded.hide', 'Hide guide') : t('guide.embedded.show', 'Show guide')}
        </Button>
      </div>
      {open && <div id={`guide-${section}`}><GuideBody stepKey={stepKey} /></div>}
    </CardContent>
  </Card>;
}

export type EmbeddedChecklistData = {
  displayName: string; bio: string; hourlyRate: number; skills: unknown[]; certifications: unknown[];
  workHistory: unknown[]; education: unknown[]; projects: unknown[]; availability: unknown[]; interviewDone: boolean;
};
export function embeddedChecklist(data: EmbeddedChecklistData) {
  return [
    { section: 'profile-details', label: 'Profile', done: !!data.displayName.trim() && !!data.bio.trim() && data.hourlyRate > 0 },
    { section: 'expertise', label: 'Expertise', done: data.skills.length > 0 },
    { section: 'certifications', label: 'Certifications', done: data.certifications.length > 0 },
    { section: 'experience', label: 'Experience', done: data.workHistory.length > 0 },
    { section: 'education', label: 'Education', done: data.education.length > 0 },
    { section: 'projects', label: 'Projects', done: data.projects.length > 0 },
    { section: 'availability', label: 'Availability', done: data.availability.length > 0 },
    { section: 'interview-history', label: 'AI interview', done: data.interviewDone },
  ];
}

export function EmbeddedSetupMessages({ data, userId }: { data: EmbeddedChecklistData; userId?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setup, strength } = useEmbeddedGuides();
  const key = userId ? `consultant-setup-complete:${userId}` : null;
  const [dismissed, setDismissed] = useState(() => key ? read(key) === true : false);
  useEffect(() => { setDismissed(key ? read(key) === true : false); }, [key]);
  const dismiss = () => { setDismissed(true); if (key) write(key, true); };
  if (!setup || strength === null) return null;
  if (strength >= 80) return dismissed || !userId ? null : <div className="space-y-2">
    <OnboardingFinish onTour={() => { dismiss(); navigate('/consultant?welcome=true'); }} />
    <div className="flex justify-center"><Button variant="ghost" size="sm" onClick={dismiss}>{t('getting_started.dismiss', 'Dismiss')}</Button></div>
  </div>;
  const benefits = [
    { Icon: Target, text: t('guide.welcome.benefit_match', 'Get matched to the right requests') },
    { Icon: ShieldCheck, text: t('guide.welcome.benefit_trust', 'Build a trust score clients can see') },
    { Icon: Wallet, text: t('guide.welcome.benefit_paid', 'Get paid within 15 business days') },
  ];
  return <div className="space-y-4 border-b border-border/50 pb-6">
    <h2 className="text-2xl font-bold">{t('guide.welcome.title', "Welcome. Let's set up your consultant profile")}</h2>
    <p className="text-sm text-muted-foreground">{fill(t('guide.welcome.subtitle', 'About {{total}} minutes. You can stop at any time and continue later.', { total: totalGuideMinutes() }), { total: totalGuideMinutes() })}</p>
    <ul className="grid sm:grid-cols-3 gap-3">{benefits.map(({ Icon, text }) => <li key={text} className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-3"><Icon className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" /><span className="text-sm font-medium">{text}</span></li>)}</ul>
    <div className="flex flex-wrap gap-1">{embeddedChecklist(data).map(item => <Button key={item.section} variant="ghost" size="sm" aria-label={`${t(`guide.embedded.checklist.${item.section}`, item.label)}: ${item.done ? t('getting_started.done', 'Done') : t('guide.embedded.not_done', 'Not done')}`} onClick={() => document.getElementById(item.section)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}>
      {item.done ? <CheckCircle2 className="w-4 h-4 me-1 text-primary" /> : <Circle className="w-4 h-4 me-1 text-muted-foreground" />}{t(`guide.embedded.checklist.${item.section}`, item.label)}
    </Button>)}</div>
  </div>;
}