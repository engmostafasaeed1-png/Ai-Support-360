import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { AlertCircle, CheckCircle2, FileClock, Loader2, Send, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useProfileSubmission } from '@/hooks/useProfileSubmission';
import { useProfileFieldRules } from '@/hooks/useProfileFieldRules';
import { focusProfileItem, POLICY_ITEM, PROFILE_SECTIONS, sectionOf, type ChecklistItem } from '@/lib/profileSubmission';
import { fill } from '@/lib/i18nFill';
import { cn } from '@/lib/utils';

type Ctx = ReturnType<typeof useProfileSubmission> & { requiredSections: Set<string>; panelId: string };
const SubmissionContext = createContext<Ctx | null>(null);
export const useSubmissionGate = () => useContext(SubmissionContext);

/** One shared gate for the whole profile page (one query, one live refresh). */
export function ProfileSubmissionProvider({ children }: { children: ReactNode }) {
  const gate = useProfileSubmission();
  const rules = useProfileFieldRules();
  const requiredSections = useMemo(() => {
    const s = new Set<string>();
    for (const r of rules.rules) if (rules.isRequired(r.field_key) && rules.isVisible(r.field_key)) s.add(sectionOf(r.field_key));
    for (const m of gate.checklist?.missing ?? []) s.add(m.sectionId);
    return s;
  }, [rules.rules, rules.isRequired, rules.isVisible, gate.checklist]);
  return <SubmissionContext.Provider value={{ ...gate, requiredSections, panelId: 'required-items' }}>{children}</SubmissionContext.Provider>;
}

function Ring({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="relative h-16 w-16 shrink-0" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted" />
        <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="6" pathLength="100" strokeDasharray={`${percent} 100`} strokeLinecap="round"
          className={percent === 100 ? 'text-success' : 'text-primary'} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{percent}%</span>
    </div>
  );
}

/** Red "N missing" badge or a green check, shown at the top of every section that has required items. */
export function SectionRequiredStatus({ sectionId, className }: { sectionId: string; className?: string }) {
  const { t } = useTranslation();
  const gate = useSubmissionGate();
  if (!gate?.checklist || !gate.requiredSections.has(sectionId)) return null;
  const n = gate.checklist.bySection[sectionId] ?? 0;
  const first = gate.checklist.missing.find((m) => m.sectionId === sectionId);
  return n > 0 ? (
    <button type="button" data-testid={`section-missing-${sectionId}`} onClick={() => first && focusProfileItem(first.key)}
      className={cn('inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-destructive" />
      {fill(String(t('profileSubmit.section_missing', { defaultValue: '{{n}} missing' })), { n })}
    </button>
  ) : (
    <span data-testid={`section-complete-${sectionId}`} className={cn('inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success', className)}>
      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />{String(t('profileSubmit.section_complete', { defaultValue: 'Required items complete' }))}
    </span>
  );
}

function StatusBadge({ state, submittedAt }: { state: string; submittedAt: string | null }) {
  const { t } = useTranslation();
  if (state === 'verified') return <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success"><ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />{String(t('profileSubmit.status_verified', { defaultValue: 'Verified profile' }))}</span>;
  if (state === 'submitted') return <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><Send aria-hidden="true" className="h-3.5 w-3.5" />{fill(String(t('profileSubmit.status_submitted', { defaultValue: 'Submitted for review on {{date}}' })), { date: submittedAt ? format(new Date(submittedAt), 'd MMM yyyy') : '' })}</span>;
  return <span data-testid="draft-status" className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-foreground"><FileClock aria-hidden="true" className="h-3.5 w-3.5 text-warning" />{String(t('profileSubmit.status_draft', { defaultValue: 'Draft - not submitted yet' }))}</span>;
}

function MissingList({ items, rowRefs }: { items: ChecklistItem[]; rowRefs?: React.MutableRefObject<Array<HTMLButtonElement | null>> }) {
  return (
    <ul className="space-y-1.5">
      {items.map((m, i) => (
        <li key={m.key}>
          <button ref={(el) => { if (rowRefs) rowRefs.current[i] = el; }} type="button" data-testid={`missing-${m.key}`} onClick={() => focusProfileItem(m.key)}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
            <span className="min-w-0 flex-1 font-medium">{m.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{m.sectionLabel}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Short summary at the top of the profile: status, counter and a jump to the list (also the banner for verified consultants). */
export function ProfileRequiredSummary() {
  const { t } = useTranslation();
  const gate = useSubmissionGate();
  const { isGuest } = useGuestMode();
  if (isGuest || !gate?.checklist) return null;
  const c = gate.checklist;
  if (c.complete && gate.state !== 'draft') return null;
  return (
    <div role="region" aria-label={String(t('profileSubmit.summary', { defaultValue: 'Required items' }))}
      className={cn('flex flex-wrap items-center gap-3 rounded-2xl border p-3', c.complete ? 'border-success/40 bg-success/5' : 'border-destructive/30 bg-destructive/5')}>
      <StatusBadge state={gate.state} submittedAt={gate.submittedAt} />
      <span className="text-sm">
        {c.complete
          ? String(t('profileSubmit.all_done', { defaultValue: 'All required items are complete - you can submit' }))
          : fill(String(t('profileSubmit.left_of', { defaultValue: '{{left}} of {{total}} required items left' })), { left: c.left, total: c.total })}
      </span>
      {gate.state === 'verified' && !c.complete && (
        <span className="text-xs text-muted-foreground">{String(t('profileSubmit.verified_note', { defaultValue: 'Your profile stays active. Please add the missing items.' }))}</span>
      )}
      <Button size="sm" variant="outline" className="ms-auto" onClick={() => document.getElementById(gate.panelId)?.scrollIntoView({ block: 'start' })}>
        {c.complete ? String(t('profileSubmit.go_submit', { defaultValue: 'Go to submit' })) : String(t('profileSubmit.show_missing', { defaultValue: 'Show what is missing' }))}
      </Button>
    </div>
  );
}

/** The final step: the "Complete these to finish" panel and the Submit button that stays locked until nothing is missing. */
export default function ProfileSubmitGate() {
  const { t } = useTranslation();
  const gate = useSubmissionGate();
  const { isGuest } = useGuestMode();
  const panel = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [announce, setAnnounce] = useState('');
  const [serverMissing, setServerMissing] = useState<string[] | null>(null);
  if (isGuest || !gate) return null;
  if (!gate.available) return null;
  const c = gate.checklist;
  const locked = !c || !c.complete;
  const leftText = c ? fill(String(t('profileSubmit.left', { defaultValue: '{{n}} required items left' })), { n: c.left }) : '';

  const onSubmit = async () => {
    if (!c) return;
    if (locked) {
      panel.current?.scrollIntoView({ block: 'start' });
      rowRefs.current[0]?.focus();
      setAnnounce(`${leftText}. ${c.missing[0] ? c.missing[0].label : ''}`);
      return;
    }
    const res = await gate.submit.mutateAsync();
    if (res.ok) {
      setServerMissing(null);
      toast.success(String(t('profileSubmit.submitted_toast', { defaultValue: 'Profile submitted - our team reviews it next.' })));
      setAnnounce(String(t('profileSubmit.submitted_toast', { defaultValue: 'Profile submitted - our team reviews it next.' })));
    } else {
      setServerMissing(res.missing);
      setAnnounce(String(t('profileSubmit.server_rejected', { defaultValue: 'Some required items are still missing.' })));
      void gate.refetch();
    }
  };

  const sections = PROFILE_SECTIONS.filter((s) => gate.requiredSections.has(s.id));
  return (
    <section id={gate.panelId} ref={panel} aria-labelledby="required-items-title" className="scroll-mt-20 space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-4">
        {c && <Ring percent={c.percent} label={String(t('profileSubmit.progress', { defaultValue: 'Required items completed' }))} />}
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="required-items-title" className="text-lg font-bold">
            {c?.complete
              ? gate.state === 'draft'
                ? String(t('profileSubmit.all_done', { defaultValue: 'All required items are complete - you can submit' }))
                : String(t('profileSubmit.all_done_kept', { defaultValue: 'All required items are complete' }))
              : String(t('profileSubmit.title', { defaultValue: 'Complete these required items to finish' }))}
          </h2>
          {c && <p className="text-sm text-muted-foreground" data-testid="required-counter">{fill(String(t('profileSubmit.left_of', { defaultValue: '{{left}} of {{total}} required items left' })), { left: c.left, total: c.total })}</p>}
        </div>
        <StatusBadge state={gate.state} submittedAt={gate.submittedAt} />
      </div>

      {sections.length > 0 && c && (
        <nav aria-label={String(t('profileSubmit.sections', { defaultValue: 'Profile sections' }))}>
          <ol className="flex flex-wrap gap-2">
            {sections.map((s) => {
              const n = c.bySection[s.id] ?? 0;
              return (
                <li key={s.id}>
                  <a href={`#${s.id}`} data-testid={`step-${s.id}`} data-incomplete={n > 0 || undefined}
                    onClick={(e) => { e.preventDefault(); const first = c.missing.find((m) => m.sectionId === s.id); if (first) focusProfileItem(first.key); else document.getElementById(s.id)?.scrollIntoView({ block: 'start' }); }}
                    className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      n > 0 ? 'border-destructive/40 text-destructive' : 'border-success/40 text-success')}>
                    {n > 0 ? <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" /> : <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />}
                    {String(t(`profileSubmit.section.${s.key}`, { defaultValue: s.label }))}{n > 0 ? ` · ${n}` : ''}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {c && c.missing.length > 0 && <MissingList items={c.missing} rowRefs={rowRefs} />}
      {serverMissing && serverMissing.length > 0 && (
        <p role="alert" className="text-sm text-destructive">{String(t('profileSubmit.server_rejected', { defaultValue: 'Some required items are still missing.' }))}</p>
      )}

      {gate.state === 'draft' && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
          <p id="submit-explanation" className="me-auto text-xs text-muted-foreground">
            {locked
              ? String(t('profileSubmit.locked_help', { defaultValue: 'Your changes are saved as a draft. Submitting unlocks when every required item is complete.' }))
              : String(t('profileSubmit.ready_help', { defaultValue: 'Our team reviews your profile after you submit it.' }))}
          </p>
          <Button type="button" onClick={() => void onSubmit()} aria-disabled={locked || gate.submit.isPending} aria-describedby="submit-explanation"
            data-testid="submit-profile" className={cn(locked && 'cursor-not-allowed opacity-60')}>
            {gate.submit.isPending ? <Loader2 aria-hidden="true" className="me-1.5 h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="me-1.5 h-4 w-4" />}
            {String(t('profileSubmit.submit', { defaultValue: 'Submit profile for review' }))}
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite" role="status">{announce}</p>
    </section>
  );
}

export { POLICY_ITEM };
