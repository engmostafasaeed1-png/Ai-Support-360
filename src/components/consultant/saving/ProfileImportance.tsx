import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
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
  const { t } = useTranslation();
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
      <DialogContent><DialogHeader><DialogTitle>{t('profile_save.importance', 'Complete your profile and AI interview')}</DialogTitle><DialogDescription>{incomplete ? completionText : interviewText}</DialogDescription></DialogHeader>
        {incomplete && !interviewDone && <p className="text-sm text-muted-foreground">{interviewText}</p>}
        <DialogFooter className="flex-wrap"><Button variant="outline" onClick={proceed}>{t('profile_save.later', 'Later')}</Button>{incomplete && <Button variant="outline" onClick={complete}>{t('profile_save.complete', 'Complete now')}</Button>}{!interviewDone && <Button variant="outline" onClick={interview}>{t('profile_save.start', 'Start AI interview')}</Button>}<Button onClick={proceed}>{t('profile_save.continue', 'Continue saving')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}
