import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft, ArrowRight, Check, Sparkles, BrainCircuit, LineChart, Layers,
  Calendar as CalendarIcon, Clock, Send, Loader2, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { accents, iconPlate, type AccentName } from './tokens';

/* -------------------------------------------------------------------------- */
/*  Demo type catalogue                                                        */
/* -------------------------------------------------------------------------- */

type DemoType = {
  id: 'live' | 'ai-triage' | 'pricing-roi' | 'module-deep-dive';
  title: string;
  description: string;
  duration: string;
  Icon: LucideIcon;
  accent: AccentName;
};

const demoTypes: DemoType[] = [
  {
    id: 'live',
    title: 'Live platform walkthrough',
    description: 'Guided tour of the full client + consultant portal.',
    duration: '30 min',
    Icon: Sparkles,
    accent: 'violet',
  },
  {
    id: 'ai-triage',
    title: 'AI triage demo',
    description: 'See AI classify, route, and pre-solve a real SAP ticket.',
    duration: '20 min',
    Icon: BrainCircuit,
    accent: 'cyan',
  },
  {
    id: 'pricing-roi',
    title: 'Pricing & ROI call',
    description: 'Tailored quote and savings model for your team size.',
    duration: '30 min',
    Icon: LineChart,
    accent: 'amber',
  },
  {
    id: 'module-deep-dive',
    title: 'Custom SAP module deep-dive',
    description: 'Pick a module (FI, MM, BTP…) — we demo the workflow end-to-end.',
    duration: '45 min',
    Icon: Layers,
    accent: 'emerald',
  },
];

const timePrefs = [
  { id: 'asap', label: 'As soon as possible', sub: 'We respond within 1 business hour', Icon: Clock },
  { id: 'this-week', label: 'This week', sub: 'Pick a slot Mon–Fri', Icon: CalendarIcon },
  { id: 'next-week', label: 'Next week', sub: 'Better for planning teams', Icon: CalendarIcon },
  { id: 'flexible', label: 'I\u2019m flexible', sub: 'Send me your soonest openings', Icon: Sparkles },
] as const;

type TimePref = (typeof timePrefs)[number]['id'];

/**
 * Available slots are mocked client-side — in production these would
 * come from a calendar integration. Each label is the local time we
 * advertise to the visitor; we persist it as plain text alongside the
 * chosen date so admins can see exactly what was promised.
 */
const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
] as const;

/* -------------------------------------------------------------------------- */
/*  Context — lets any CTA open the wizard with one hook                       */
/* -------------------------------------------------------------------------- */

type Ctx = {
  open: (initial?: DemoType['id']) => void;
};

const DemoWizardContext = createContext<Ctx | null>(null);

export function useDemoWizard(): Ctx {
  const ctx = useContext(DemoWizardContext);
  // Safe fallback so missing provider never crashes the page; logs in dev.
  if (!ctx) {
    return {
      open: () => {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('useDemoWizard called outside <DemoWizardProvider>');
        }
      },
    };
  }
  return ctx;
}

export function DemoWizardProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialType, setInitialType] = useState<DemoType['id'] | undefined>(undefined);

  const value = useMemo<Ctx>(
    () => ({
      open: (initial) => {
        setInitialType(initial);
        setOpen(true);
      },
    }),
    [],
  );

  return (
    <DemoWizardContext.Provider value={value}>
      {children}
      <DemoRequestWizard open={open} onOpenChange={setOpen} initialType={initialType} />
    </DemoWizardContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Wizard                                                                     */
/* -------------------------------------------------------------------------- */

const STEPS = ['Demo type', 'Schedule', 'Your details'] as const;

function DemoRequestWizard({
  open, onOpenChange, initialType,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialType?: DemoType['id'];
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [type, setType] = useState<DemoType['id'] | null>(initialType ?? null);
  const [time, setTime] = useState<TimePref | null>(null);
  // Optional exact slot. Visitors can pick a date + slot for any
  // scheduling preference (or skip and let us follow up).
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');

  // Reset every time it reopens.
  const reset = () => {
    setStep(0);
    setSubmitting(false);
    setSubmitted(false);
    setType(initialType ?? null);
    setTime(null);
    setDate(undefined);
    setSlot(null);
    setName('');
    setEmail('');
    setCompany('');
    setNotes('');
  };

  const canNext =
    (step === 0 && !!type) ||
    // On the schedule step a preference is enough, but if the visitor
    // picks a date they must also pick a slot (and vice versa) so we
    // never persist a half-chosen time.
    (step === 1 && !!time && (!date || !!slot) && (!slot || !!date)) ||
    (step === 2 && name.trim().length > 1 && /\S+@\S+\.\S+/.test(email));

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    if (!type || !time) return;
    setSubmitting(true);

    // Pull the current user (if any) so admins can later see who logged in
    // as well as the email on the row. Anon users still get inserted.
    const { data: userRes } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('demo_requests')
      .insert({
        user_id: userRes.user?.id ?? null,
        demo_type: type,
        scheduling_preference: time,
        scheduled_date: date ? format(date, 'yyyy-MM-dd') : null,
        scheduled_slot: slot,
        full_name: name.trim(),
        email: email.trim(),
        company: company.trim() || null,
        notes: notes.trim() || null,
        source: 'landing-wizard',
      })
      .select('request_token')
      .single();

    setSubmitting(false);

    if (error || !data?.request_token) {
      toast({
        variant: 'destructive',
        title: 'Couldn\u2019t submit request',
        description: error?.message ?? 'Please try again in a moment.',
      });
      return;
    }

    setSubmitted(true);
    toast({
      title: 'Demo request received',
      description: 'We\u2019ll be in touch within one business hour.',
    });

    // Give the success state a beat to render, then route to the
    // shareable confirmation page so the user can revisit anytime.
    setTimeout(() => {
      onOpenChange(false);
      navigate(`/demo/confirmation/${data.request_token}`);
    }, 900);
  };

  const selectedType = demoTypes.find((d) => d.id === type) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 200);
      }}
    >
      <DialogContent className="max-w-2xl p-0 overflow-hidden border-border/60 bg-card/95 backdrop-blur-xl">
        {/* Ambient gradient header */}
        <div className="relative px-6 md:px-8 pt-7 pb-5 border-b border-border/40 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,hsl(var(--primary)/0.18),transparent_55%)] pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
              <Sparkles className="w-3 h-3" />
              Request a demo
            </div>
            <DialogTitle className="text-2xl md:text-3xl font-black tracking-tight mt-3 text-foreground">
              {submitted
                ? 'You\u2019re on the calendar.'
                : step === 0
                  ? 'What would you like to see?'
                  : step === 1
                    ? 'When works for you?'
                    : 'A few details and we\u2019re set.'}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1.5 max-w-md">
              {submitted
                ? 'A specialist will reach out within one business hour.'
                : 'Pick the demo that matches your goal — every option is tailored to SAP teams.'}
            </DialogDescription>

            {!submitted && <Stepper step={step} />}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 md:px-8 py-6 max-h-[60vh] overflow-y-auto">
          {submitted ? (
            <SuccessPanel selectedType={selectedType} time={time} email={email} />
          ) : step === 0 ? (
            <DemoTypeStep value={type} onChange={setType} />
          ) : step === 1 ? (
            <ScheduleStep
              value={time} onChange={setTime}
              date={date} onDateChange={setDate}
              slot={slot} onSlotChange={setSlot}
            />
          ) : (
            <DetailsStep
              name={name} setName={setName}
              email={email} setEmail={setEmail}
              company={company} setCompany={setCompany}
              notes={notes} setNotes={setNotes}
            />
          )}
        </div>

        {/* Footer */}
        {!submitted && (
          <div className="px-6 md:px-8 py-4 border-t border-border/40 bg-muted/20 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={back}
              disabled={step === 0 || submitting}
              className="rounded-xl"
            >
              <ArrowLeft className="w-4 h-4 me-1.5" /> Back
            </Button>

            <div className="text-[11px] text-muted-foreground hidden sm:block">
              Step {step + 1} of {STEPS.length}
            </div>

            {step < STEPS.length - 1 ? (
              <Button
                onClick={next}
                disabled={!canNext}
                className="rounded-xl bg-gradient-to-r from-primary to-accent hover:opacity-95 border-0 shadow-lg"
              >
                Continue <ArrowRight className="w-4 h-4 ms-1.5" />
              </Button>
            ) : (
              <Button
                onClick={submit}
                disabled={!canNext || submitting}
                className="rounded-xl bg-gradient-to-r from-primary to-accent hover:opacity-95 border-0 shadow-lg"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Send request <Send className="w-4 h-4 ms-1.5" /></>}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Step bits                                                                  */
/* -------------------------------------------------------------------------- */

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 mt-5" aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex items-center gap-2 flex-1 last:flex-initial">
            <div
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border transition-colors',
                done && 'bg-primary text-primary-foreground border-primary',
                active && 'bg-primary/15 text-primary border-primary/50',
                !done && !active && 'bg-muted/40 text-muted-foreground border-border/50',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                'text-[11px] md:text-xs font-semibold uppercase tracking-wider hidden sm:inline',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn('h-px flex-1 mx-1', done ? 'bg-primary/60' : 'bg-border/50')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DemoTypeStep({
  value, onChange,
}: { value: DemoType['id'] | null; onChange: (v: DemoType['id']) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {demoTypes.map((d) => {
        const selected = value === d.id;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onChange(d.id)}
            style={{ ['--glow' as string]: accents[d.accent].glow }}
            className={cn(
              'group relative text-start rounded-2xl border p-4 bg-card/60 hover:bg-card transition-all overflow-hidden',
              selected
                ? 'border-primary/60 shadow-[0_15px_40px_-15px_rgba(var(--glow),0.5)] ring-2 ring-primary/30'
                : 'border-border/40 hover:border-primary/30',
            )}
            aria-pressed={selected}
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-50 pointer-events-none"
              style={{ background: 'radial-gradient(circle at 0% 0%, rgba(var(--glow),0.18), transparent 60%)' }}
            />
            <div className="relative flex items-start gap-3">
              <div className={iconPlate(d.accent, 'sm')}>
                <d.Icon className="w-4 h-4 text-white" strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold text-sm text-foreground leading-tight">{d.title}</h4>
                  {selected && (
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{d.description}</p>
                <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  <Clock className="w-3 h-3" /> {d.duration}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ScheduleStep({
  value, onChange, date, onDateChange, slot, onSlotChange,
}: {
  value: TimePref | null;
  onChange: (v: TimePref) => void;
  date: Date | undefined;
  onDateChange: (d: Date | undefined) => void;
  slot: string | null;
  onSlotChange: (s: string | null) => void;
}) {
  // Block weekends and any day before today; cap at 60 days out so
  // the picker stays focused on actually-bookable dates.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 60);
  const isDisabled = (d: Date) => {
    const day = d.getDay();
    return d < today || d > maxDate || day === 0 || day === 6;
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {timePrefs.map((t) => {
          const selected = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={cn(
                'group relative text-start rounded-2xl border p-4 bg-card/60 hover:bg-card transition-all',
                selected
                  ? 'border-primary/60 ring-2 ring-primary/30 shadow-lg'
                  : 'border-border/40 hover:border-primary/30',
              )}
              aria-pressed={selected}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <t.Icon className="w-4 h-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-sm text-foreground leading-tight">{t.label}</h4>
                    {selected && (
                      <span className="shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.sub}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Optional exact-slot picker. Independent of the preference
          chips above so a visitor can say "this week" + lock in a
          specific Tue 2:30 PM. */}
      <div className="rounded-2xl border border-border/40 bg-muted/20 p-4 md:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="font-bold text-sm text-foreground">Pick an exact slot</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Optional — choose a date and we\u2019ll show available 30-min windows.
            </p>
          </div>
          {(date || slot) && (
            <button
              type="button"
              onClick={() => { onDateChange(undefined); onSlotChange(null); }}
              className="text-[11px] font-semibold text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-start">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  'w-full sm:w-[220px] justify-start rounded-xl h-11 font-normal',
                  !date && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="w-4 h-4 me-2" />
                {date ? format(date, 'EEE, MMM d, yyyy') : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => {
                  onDateChange(d ?? undefined);
                  // Reset slot when changing date so we never persist a
                  // slot that no longer matches the selected day.
                  if (!d || (date && d.getTime() !== date.getTime())) onSlotChange(null);
                }}
                disabled={isDisabled}
                initialFocus
                className={cn('p-3 pointer-events-auto')}
              />
            </PopoverContent>
          </Popover>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              {date ? 'Available slots' : 'Pick a date to see slots'}
            </div>
            <div
              className={cn(
                'grid grid-cols-3 sm:grid-cols-4 gap-2',
                !date && 'opacity-50 pointer-events-none',
              )}
            >
              {TIME_SLOTS.map((s) => {
                const selected = slot === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!date}
                    onClick={() => onSlotChange(s)}
                    className={cn(
                      'h-9 rounded-lg text-xs font-semibold border transition-colors',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20'
                        : 'border-border/50 bg-background hover:border-primary/40 hover:bg-primary/5 text-foreground',
                    )}
                    aria-pressed={selected}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
}

function DetailsStep({
  name, setName, email, setEmail, company, setCompany, notes, setNotes,
}: {
  name: string; setName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  company: string; setCompany: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="dw-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Full name
          </Label>
          <Input
            id="dw-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className="rounded-xl h-11 bg-background/60"
            autoComplete="name"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dw-email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Work email
          </Label>
          <Input
            id="dw-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="[email protected]"
            className="rounded-xl h-11 bg-background/60"
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dw-company" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Company
        </Label>
        <Input
          id="dw-company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Acme GmbH"
          className="rounded-xl h-11 bg-background/60"
          autoComplete="organization"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dw-notes" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Anything specific you want to see? <span className="text-muted-foreground/60 normal-case">(optional)</span>
        </Label>
        <Textarea
          id="dw-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. FI-AA depreciation runs, S/4HANA migration triage…"
          className="rounded-xl bg-background/60"
        />
      </div>
    </div>
  );
}

function SuccessPanel({
  selectedType, time, email,
}: { selectedType: DemoType | null; time: TimePref | null; email: string }) {
  const timeLabel = timePrefs.find((p) => p.id === time)?.label ?? '—';
  return (
    <div className="text-center py-4">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-2xl shadow-primary/30 mb-5">
        <Check className="w-8 h-8 text-primary-foreground" strokeWidth={3} />
      </div>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        We\u2019ll send a confirmation to <span className="text-foreground font-semibold">{email}</span> shortly.
      </p>
      <div className="mt-5 inline-flex flex-wrap items-center justify-center gap-2 px-4 py-2 rounded-full border border-border/50 bg-muted/30 text-xs">
        {selectedType && (
          <>
            <selectedType.Icon className="w-3.5 h-3.5 text-primary" />
            <span className="font-semibold text-foreground">{selectedType.title}</span>
            <span className="text-muted-foreground/60">·</span>
          </>
        )}
        <CalendarIcon className="w-3.5 h-3.5 text-primary" />
        <span className="text-foreground">{timeLabel}</span>
      </div>
    </div>
  );
}
