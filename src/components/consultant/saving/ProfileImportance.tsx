import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X, Sparkles, Award, ListChecks, ShieldCheck, Clock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import { useEmbeddedGuides } from '../onboarding/EmbeddedGuides';
import { fill } from '@/lib/i18nFill';
const Context = createContext<((proceed: () => void) => void) | undefined>(undefined);
export const useProfileSavePrompt = () => useContext(Context);
export function claimSavePrompt(userId: string, automatic: boolean, incomplete: boolean, interviewDone: boolean): boolean {
  if (automatic || (!incomplete && interviewDone)) return false;
  const key = `profile-save-prompt:${userId}`;
  try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, '1'); } catch { /* in-memory provider still limits repeats */ }
  return true;
}
export default function ProfileImportance({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: profile } = useConsultantProfile();
  const { completeness, setup } = useEmbeddedGuides();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const seen = useRef(false);
  const continuation = useRef<(() => void) | null>(null);
  const interviewDone = !!profile?.ai_interview_completed_at;
  const incomplete = completeness !== null && completeness.percent < 100;
  const needed = incomplete || !interviewDone;
  const percent = Math.max(0, Math.min(100, completeness?.percent ?? 0));
  const badge = ['Gold', 'Silver', 'Bronze', 'Verified'].includes(profile?.ai_interview_badge ?? '') ? profile?.ai_interview_badge : null;
  const benefits = [
    { icon: ListChecks, key: 'directory_benefit', text: 'A complete profile helps clients assess your expertise when browsing the directory and inviting bids.' },
    { icon: Award, key: 'badge_benefit', text: 'An AI interview badge shows your assessed SAP knowledge and gives clients another way to evaluate your skills.' },
    { icon: ShieldCheck, key: 'trust_benefit', text: 'Your badge and complete profile help clients make an informed choice. Bid acceptance is never guaranteed.' },
    { icon: Clock, key: 'duration_benefit', text: 'Allow about 10–15 minutes for the AI interview.' },
  ];
  const tiers = [
    { name: 'Gold', range: '≥ 85', tone: 'border-badge-gold/25 bg-badge-gold/10 text-badge-gold' },
    { name: 'Silver', range: '≥ 70', tone: 'border-badge-silver/25 bg-badge-silver/10 text-badge-silver' },
    { name: 'Bronze', range: '≥ 50', tone: 'border-badge-bronze/25 bg-badge-bronze/10 text-badge-bronze' },
    { name: 'Verified', range: '< 50', tone: 'border-success/25 bg-success/10 text-success' },
  ];
  useEffect(() => { setDismissed(false); }, [completeness?.percent, interviewDone]);
  const missing = completeness?.items.filter(item => !item.done).slice(0, 5).map(item => t(`profile_completeness.${item.key}`, item.label)).join(', ') ?? '';
  const completionText = fill(t('profile_save.before', 'Before you save: complete profiles are shown to clients first and are the ones invited to bids; you are at {{percent}} %. Missing: {{missing}}.'), { percent: completeness?.percent ?? 0, missing });
  const interviewText = t('profile_save.interview', 'Take the AI interview to earn a Gold/Silver/Bronze credibility badge - verified consultants with a badge are trusted more by clients.');
  const proceed = () => { const fn = continuation.current; continuation.current = null; setOpen(false); fn?.(); };
  const before = (fn: () => void) => {
    if (!profile?.user_id || completeness === null || seen.current || !claimSavePrompt(profile.user_id, false, incomplete, interviewDone)) { fn(); return; }
    seen.current = true; continuation.current = fn; setOpen(true);
  };
  const complete = () => { proceed(); document.getElementById('profile-details')?.scrollIntoView({ block: 'start' }); };
  const interview = () => { proceed(); navigate('/consultant/interviews'); };
  return <Context.Provider value={before}>
    {needed && completeness !== null && !dismissed && <section className="border-b border-border pb-4 space-y-2" aria-label={t('profile_save.importance', 'Complete your profile and AI interview')}>
      <div className="flex justify-between gap-3"><h2 className="font-semibold">{t('profile_save.importance', 'Complete your profile and AI interview')}</h2><Button size="icon" variant="ghost" aria-label={t('getting_started.dismiss', 'Dismiss')} onClick={() => setDismissed(true)}><X className="h-4 w-4" /></Button></div>
      {setup && <p className="text-sm text-muted-foreground">{t('profile_save.welcome', 'Welcome. Complete your profile and take the AI interview before applying to bids.')}</p>}
      {incomplete && <p className="text-sm text-muted-foreground">{completionText}</p>}
      {!interviewDone && <p className="text-sm text-muted-foreground">{interviewText}</p>}
      {!interviewDone && <Button size="sm" variant="outline" onClick={interview}>{t('profile_save.start', 'Start AI interview')}</Button>}
    </section>}
    {children}
    <Dialog open={open} onOpenChange={value => { if (!value) proceed(); }}>
      <DialogContent dir={i18n.dir()} className="profile-save-dialog flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0 motion-reduce:animate-none motion-reduce:duration-0">
        <DialogHeader className="shrink-0 bg-[image:var(--gradient-profile-header)] px-5 pb-5 pt-6 text-start sm:px-6">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-background/70 text-accent"><Sparkles aria-hidden="true" className="h-5 w-5" /></span>
          <DialogTitle className="pe-6 text-xl leading-snug tracking-normal">{t('profile_save.boost_title', 'Boost your profile before you save')}</DialogTitle>
          <DialogDescription>{t('profile_save.boost_description', 'Let clients see a clearer picture of your expertise. You can save now and finish later.')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 text-center">
              <span className="text-sm font-medium">{t('profile_save.completion_label', 'Profile completion')}</span>
              <div className="relative h-20 w-20 shrink-0" role="progressbar" aria-label={t('profile_save.completion_label', 'Profile completion')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden="true"><circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted" /><circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="5" pathLength="100" strokeDasharray={`${percent} 100`} strokeLinecap="round" className="text-accent" /></svg>
                <span className="absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums">{percent}%</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-3 text-center">
              <span className="text-sm font-medium">{t('profile_save.interview_label', 'AI interview')}</span>
              <Award aria-hidden="true" className={`h-9 w-9 ${interviewDone ? 'text-success' : 'text-muted-foreground'}`} />
              <span className="text-sm font-semibold">{!interviewDone ? t('profile_save.not_taken', 'Not taken') : badge ? fill(t('profile_save.badge_earned', '{{badge}} badge earned'), { badge: String(t(`profile_save.tier_${badge.toLowerCase()}`, badge)) }) : t('profile_save.interview_completed', 'Interview completed')}</span>
            </div>
          </div>
          {incomplete && missing && <p className="text-xs leading-relaxed text-muted-foreground">{fill(t('profile_save.missing_labels', 'Missing: {{missing}}'), { missing })}</p>}
          <section aria-labelledby="profile-save-benefits" className="space-y-3">
            <h3 id="profile-save-benefits" className="text-sm font-semibold">{t('profile_save.why_matters', 'Why it matters')}</h3>
            <ul className="space-y-3">{benefits.map(({ icon: Icon, key, text }) => <li key={key} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"><Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span>{t(`profile_save.${key}`, text)}</span></li>)}</ul>
            <div className="flex flex-wrap gap-2">{tiers.map(tier => <span key={tier.name} className={`rounded-md border px-2 py-1 text-xs font-medium ${tier.tone}`}><span>{t(`profile_save.tier_${tier.name.toLowerCase()}`, tier.name)}</span> <bdi>{tier.range}</bdi></span>)}</div>
          </section>
        </div>
        <DialogFooter className="shrink-0 border-t border-border bg-muted/30 p-4 sm:px-6">
          <Button variant="outline" className="h-auto min-h-11 whitespace-normal motion-reduce:transform-none motion-reduce:transition-none" onClick={proceed}>{t('profile_save.save_later', 'Save and continue later')}</Button>
          <Button className="gradient-primary h-auto min-h-11 whitespace-normal text-primary-foreground motion-reduce:transform-none motion-reduce:transition-none" onClick={interviewDone ? complete : interview}>{interviewDone ? t('profile_save.complete_profile', 'Complete my profile') : t('profile_save.interview_now', 'Take the AI interview now')}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 rtl:rotate-180" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}
