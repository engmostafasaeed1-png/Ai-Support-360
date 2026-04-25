import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, Calendar, Check, Clock, Loader2, Mail, Phone, Sparkles, AlertCircle,
  Globe, Video, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Public confirmation page reached after submitting the demo wizard.
 * Looks up the request by its opaque token (no auth required) via the
 * `get_demo_request_by_token` SECURITY DEFINER function. Anyone with
 * the link can view, but the token is single-row scoped.
 */

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
  status: 'received' | 'contacted' | 'scheduled' | 'completed' | 'cancelled';
  status_note: string | null;
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

const statusMeta: Record<DemoRequest['status'], { label: string; description: string; tone: 'progress' | 'done' | 'cancelled' }> = {
  received:  { label: 'Request received',          description: 'Our team will reach out within one business hour.', tone: 'progress' },
  contacted: { label: 'A specialist is in touch',  description: 'Check your inbox — we\u2019re coordinating a time.', tone: 'progress' },
  scheduled: { label: 'Demo scheduled',            description: 'A calendar invite has been sent to your email.',     tone: 'progress' },
  completed: { label: 'Demo completed',            description: 'Thanks for your time — we\u2019ll follow up shortly.', tone: 'done' },
  cancelled: { label: 'Demo cancelled',            description: 'This request was cancelled. Submit a new one anytime.', tone: 'cancelled' },
};

export default function DemoRequestConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<DemoRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) { setError('Missing request token.'); setLoading(false); return; }
      const { data, error } = await supabase.rpc('get_demo_request_by_token', { _token: token });
      if (!active) return;
      if (error) {
        setError(error.message);
      } else if (!data || (Array.isArray(data) && data.length === 0)) {
        setError('We couldn\u2019t find a demo request for this link.');
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        setData(row as DemoRequest);
      }
      setLoading(false);
    })();
    return () => { active = false; };
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
            <ConfirmationCard data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmationCard({ data }: { data: DemoRequest }) {
  const meta = statusMeta[data.status];
  const created = new Date(data.created_at);
  const updated = new Date(data.updated_at);

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
        {data.status_note && data.status !== 'cancelled' && (
          <p className="text-xs text-muted-foreground mt-4 italic">Note from our team: {data.status_note}</p>
        )}
      </div>

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
