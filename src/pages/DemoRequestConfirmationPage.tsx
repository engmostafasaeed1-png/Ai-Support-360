import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  ArrowLeft, Calendar, Check, Clock, Loader2, Mail, Phone, Sparkles, AlertCircle,
  Globe, Video, Users, CalendarClock, Plus, X, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Public confirmation page reached after submitting the demo wizard.
 * Looks up the request by its opaque token (no auth required) via the
 * `get_demo_request_by_token` SECURITY DEFINER function. Anyone with
 * the link can view, but the token is single-row scoped.
 */

type ProposedSlot = { date: string; time: string };

type DemoRequest = {
  id: string;
  demo_type: 'live' | 'ai-triage' | 'pricing-roi' | 'module-deep-dive';
  scheduling_preference: 'asap' | 'this-week' | 'next-week' | 'flexible';
  scheduled_date: string | null;
  scheduled_slot: string | null;
  timezone: string | null;
  meeting_format: 'video' | 'phone' | 'in-person' | null;
  full_name: string;
  email: string;
  company: string | null;
  notes: string | null;
  status: 'received' | 'contacted' | 'scheduled' | 'rescheduling' | 'completed' | 'cancelled';
  status_note: string | null;
  proposed_slots: ProposedSlot[] | null;
  reschedule_reason: string | null;
  reschedule_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

const demoTypeLabel: Record<DemoRequest['demo_type'], string> = {
  'live': 'Live platform walkthrough',
  'ai-triage': 'AI triage demo',
  'pricing-roi': 'Pricing & ROI call',
  'module-deep-dive': 'Custom SAP module deep-dive',
};

const scheduleLabel: Record<DemoRequest['scheduling_preference'], string> = {
  'asap': 'As soon as possible',
  'this-week': 'This week',
  'next-week': 'Next week',
  'flexible': 'Flexible',
};

const statusOrder: DemoRequest['status'][] = ['received', 'contacted', 'scheduled', 'completed'];

const statusMeta: Record<DemoRequest['status'], { label: string; description: string; tone: 'progress' | 'done' | 'cancelled' | 'attention' }> = {
  received:     { label: 'Request received',         description: 'Our team will reach out within one business hour.', tone: 'progress' },
  contacted:    { label: 'A specialist is in touch', description: 'Check your inbox — we\u2019re coordinating a time.', tone: 'progress' },
  scheduled:    { label: 'Demo scheduled',           description: 'A calendar invite has been sent to your email.',     tone: 'progress' },
  rescheduling: { label: 'Rescheduling requested',   description: 'Your proposed slots are with our team — we\u2019ll confirm shortly.', tone: 'attention' },
  completed:    { label: 'Demo completed',           description: 'Thanks for your time — we\u2019ll follow up shortly.', tone: 'done' },
  cancelled:    { label: 'Demo cancelled',           description: 'This request was cancelled. Submit a new one anytime.', tone: 'cancelled' },
};

export default function DemoRequestConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<DemoRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = async () => {
    if (!token) return;
    const { data, error } = await supabase.rpc('get_demo_request_by_token', { _token: token });
    if (error) { setError(error.message); return; }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setError('We couldn\u2019t find a demo request for this link.');
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setData(row as unknown as DemoRequest);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) { setError('Missing request token.'); setLoading(false); return; }
      await refetch();
      if (active) setLoading(false);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_-10%,hsl(var(--primary)/0.12),transparent_55%),radial-gradient(circle_at_70%_110%,hsl(var(--accent)/0.10),transparent_55%)] pointer-events-none" />

      <div className="container mx-auto px-4 py-10 md:py-16 relative">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>

        <div className="max-w-2xl mx-auto">
          {loading ? (
            <div className="rounded-3xl border border-border/40 bg-card/60 backdrop-blur-xl p-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground mt-4">Loading your request…</p>
            </div>
          ) : error || !data ? (
            <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-8 md:p-10">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-destructive/15 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-foreground">Request not found</h1>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{error}</p>
                  <Button asChild className="mt-5 rounded-xl">
                    <Link to="/">Return to home</Link>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <ConfirmationCard data={data} token={token!} onChanged={refetch} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmationCard({ data, token, onChanged }: { data: DemoRequest; token: string; onChanged: () => Promise<void> }) {
  const meta = statusMeta[data.status];
  const created = new Date(data.created_at);
  const updated = new Date(data.updated_at);
  const [showReschedule, setShowReschedule] = useState(false);
  const canReschedule = ['received', 'contacted', 'scheduled', 'rescheduling'].includes(data.status);

  return (
    <div className="rounded-3xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl shadow-primary/5 overflow-hidden">
      {/* Header */}
      <div className="relative px-7 md:px-10 pt-8 pb-7 border-b border-border/40 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,hsl(var(--primary)/0.18),transparent_55%)]" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
            <Sparkles className="w-3 h-3" />
            Demo request
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight mt-3 text-foreground">
            {data.status === 'cancelled' ? 'This request was cancelled' : `You\u2019re on the calendar, ${data.full_name.split(' ')[0]}.`}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md leading-relaxed">
            {meta.description}
          </p>
        </div>
      </div>

      {/* Status timeline */}
      <div className="px-7 md:px-10 py-7 border-b border-border/40">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
          Current status
        </div>
        {data.status === 'cancelled' ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-foreground">
            <span className="font-semibold">Cancelled</span>
            {data.status_note && <p className="text-xs text-muted-foreground mt-1">{data.status_note}</p>}
          </div>
        ) : data.status === 'rescheduling' ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
            <div className="flex items-center gap-2 font-semibold">
              <CalendarClock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              Rescheduling — awaiting confirmation
            </div>
            {data.status_note && <p className="text-xs text-muted-foreground mt-1.5">{data.status_note}</p>}
          </div>
        ) : (
          <ol className="flex items-center gap-2">
            {statusOrder.map((s, i) => {
              const reached = statusOrder.indexOf(data.status) >= i;
              const current = data.status === s;
              return (
                <li key={s} className="flex items-center gap-2 flex-1 last:flex-initial">
                  <div
                    className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border transition-colors shrink-0',
                      reached && !current && 'bg-primary text-primary-foreground border-primary',
                      current && 'bg-primary/15 text-primary border-primary/60 ring-2 ring-primary/30',
                      !reached && 'bg-muted/40 text-muted-foreground border-border/50',
                    )}
                  >
                    {reached && !current ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={cn('text-[11px] md:text-xs font-semibold uppercase tracking-wider hidden sm:inline', current ? 'text-foreground' : 'text-muted-foreground')}>
                    {statusMeta[s].label}
                  </span>
                  {i < statusOrder.length - 1 && (
                    <div className={cn('h-px flex-1 mx-1', reached ? 'bg-primary/60' : 'bg-border/50')} />
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {data.status_note && data.status !== 'cancelled' && data.status !== 'rescheduling' && (
          <p className="text-xs text-muted-foreground mt-4 italic">Note from our team: {data.status_note}</p>
        )}
      </div>

      {/* Proposed slots (when rescheduling) */}
      {data.status === 'rescheduling' && data.proposed_slots && data.proposed_slots.length > 0 && (
        <ProposedSlotsTimeline
          slots={data.proposed_slots}
          timezone={data.timezone}
          reason={data.reschedule_reason}
        />
      )}

      {/* Details */}
      <dl className="px-7 md:px-10 py-7 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
        <DetailRow icon={Sparkles} label="Demo type" value={demoTypeLabel[data.demo_type]} />
        <DetailRow icon={Calendar} label="Schedule preference" value={scheduleLabel[data.scheduling_preference]} />
        {data.scheduled_date && (
          <DetailRow
            icon={Calendar}
            label="Booked slot"
            value={`${new Date(data.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${data.scheduled_slot ? ` · ${data.scheduled_slot}` : ''}`}
          />
        )}
        {data.timezone && (
          <DetailRow icon={Globe} label="Timezone" value={data.timezone} />
        )}
        {data.meeting_format && (
          <DetailRow
            icon={data.meeting_format === 'video' ? Video : data.meeting_format === 'phone' ? Phone : Users}
            label="Meeting format"
            value={data.meeting_format === 'video' ? 'Video call' : data.meeting_format === 'phone' ? 'Phone call' : 'In person'}
          />
        )}
        <DetailRow icon={Mail} label="Email" value={data.email} />
        {data.company && <DetailRow icon={Phone} label="Company" value={data.company} />}
        <DetailRow icon={Clock} label="Submitted" value={created.toLocaleString()} />
        {updated.getTime() !== created.getTime() && (
          <DetailRow icon={Clock} label="Last update" value={updated.toLocaleString()} />
        )}
        {data.notes && (
          <div className="sm:col-span-2">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
              Your notes
            </dt>
            <dd className="text-sm text-foreground/90 leading-relaxed bg-muted/30 border border-border/40 rounded-xl px-4 py-3">
              {data.notes}
            </dd>
          </div>
        )}
      </dl>

      {/* Reschedule panel */}
      {canReschedule && (
        <div className="px-7 md:px-10 pb-7">
          {!showReschedule ? (
            <Button
              variant="outline"
              onClick={() => setShowReschedule(true)}
              className="rounded-xl gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {data.status === 'rescheduling' ? 'Update proposed slots' : 'Request a reschedule'}
            </Button>
          ) : (
            <RescheduleForm
              token={token}
              initialReason={data.reschedule_reason ?? ''}
              initialSlots={data.proposed_slots ?? []}
              onCancel={() => setShowReschedule(false)}
              onSuccess={async () => {
                setShowReschedule(false);
                await onChanged();
              }}
            />
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="px-7 md:px-10 py-5 border-t border-border/40 bg-muted/20 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Save this page — it updates as your request progresses.
        </p>
        <Button asChild variant="outline" className="rounded-xl">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}

function RescheduleForm({
  token, initialReason, initialSlots, onCancel, onSuccess,
}: {
  token: string;
  initialReason: string;
  initialSlots: ProposedSlot[];
  onCancel: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [slots, setSlots] = useState<ProposedSlot[]>(
    initialSlots.length > 0 ? initialSlots : [{ date: '', time: '' }]
  );
  const [reason, setReason] = useState(initialReason);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const slotErrors = slots.map((s) => {
    if (!s.date || !s.time) return null;
    const dt = new Date(`${s.date}T${s.time}`);
    if (isNaN(dt.getTime())) return 'Invalid date/time';
    if (dt.getTime() <= Date.now()) return 'Time is in the past';
    return null;
  });

  const addSlot = () => {
    if (slots.length >= 5) return;
    setSlots([...slots, { date: '', time: '' }]);
  };
  const removeSlot = (i: number) => {
    setSlots(slots.filter((_, idx) => idx !== i));
  };
  const updateSlot = (i: number, patch: Partial<ProposedSlot>) => {
    setSlots(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const handleSubmit = async () => {
    const valid = slots.filter((s) => s.date && s.time);
    if (valid.length === 0) {
      toast.error('Add at least one date and time');
      return;
    }
    if (slotErrors.some((e) => e !== null)) {
      toast.error('Please fix the highlighted slots before submitting');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc('request_demo_reschedule', {
      _token: token,
      _proposed_slots: valid as unknown as never,
      _reason: reason.trim() || undefined,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || 'Could not submit reschedule request');
      return;
    }
    toast.success('Reschedule request sent — we\u2019ll confirm shortly.');
    await onSuccess();
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-muted/20 p-5 md:p-6 space-y-5">
      <div>
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-primary" />
          Propose new time slots
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Add up to 5 options that work for you. We\u2019ll lock in one and confirm via email.
        </p>
        <p className="text-[11px] text-muted-foreground/80 mt-1.5 flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          Times are interpreted in your local timezone
          <span className="font-mono text-foreground/70">({browserTz})</span>
        </p>
      </div>

      <div className="space-y-3">
        {slots.map((slot, i) => {
          const err = slotErrors[i];
          const hasErr = Boolean(err);
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-end gap-2">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`d-${i}`} className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</Label>
                    <Input
                      id={`d-${i}`}
                      type="date"
                      min={today}
                      value={slot.date}
                      onChange={(e) => updateSlot(i, { date: e.target.value })}
                      aria-invalid={hasErr}
                      className={cn('rounded-lg', hasErr && 'border-destructive focus-visible:ring-destructive/40')}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`t-${i}`} className="text-[10px] uppercase tracking-wider text-muted-foreground">Time</Label>
                    <Input
                      id={`t-${i}`}
                      type="time"
                      value={slot.time}
                      onChange={(e) => updateSlot(i, { time: e.target.value })}
                      aria-invalid={hasErr}
                      className={cn('rounded-lg', hasErr && 'border-destructive focus-visible:ring-destructive/40')}
                    />
                  </div>
                </div>
                {slots.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSlot(i)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Remove slot"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
              {hasErr && (
                <p className="text-[11px] text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {err}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {slots.length < 5 && (
        <Button type="button" variant="ghost" size="sm" onClick={addSlot} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add another option
        </Button>
      )}

      <div>
        <Label htmlFor="reason" className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Reason (optional)
        </Label>
        <Textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Schedule conflict — these times work better."
          maxLength={500}
          rows={2}
          className="rounded-lg resize-none"
        />
      </div>

      <div className="flex flex-wrap gap-2 justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={submitting} className="rounded-xl gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Submit reschedule
        </Button>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Sparkles; label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {label}
      </dt>
      <dd className="text-sm text-foreground font-medium break-words">{value}</dd>
    </div>
  );
}
