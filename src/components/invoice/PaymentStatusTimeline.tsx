import { format } from 'date-fns';
import { CheckCircle2, Clock, XCircle, AlertCircle, FileText, CalendarClock, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PaymentTimelineRecord {
  status?: string;
  created_at?: string | null;
  due_date?: string | null;
  updated_at?: string | null;
}

type EventState = 'done' | 'current' | 'upcoming' | 'skipped';

interface TimelineEvent {
  key: string;
  label: string;
  date: string | null;
  state: EventState;
  icon: any;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted';
}

const toneClasses: Record<TimelineEvent['tone'], { dot: string; ring: string; text: string; badge: string }> = {
  primary: { dot: 'bg-primary text-primary-foreground', ring: 'ring-primary/30', text: 'text-foreground', badge: 'bg-primary/10 text-primary' },
  success: { dot: 'bg-emerald-500 text-white', ring: 'ring-emerald-500/30', text: 'text-foreground', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  warning: { dot: 'bg-amber-500 text-white', ring: 'ring-amber-500/30', text: 'text-foreground', badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  danger: { dot: 'bg-destructive text-destructive-foreground', ring: 'ring-destructive/30', text: 'text-foreground', badge: 'bg-destructive/10 text-destructive' },
  muted: { dot: 'bg-muted text-muted-foreground', ring: 'ring-border', text: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' },
};

function buildEvents(p: PaymentTimelineRecord): TimelineEvent[] {
  const status = (p.status || 'pending').toLowerCase();
  const now = new Date();
  const issued = p.created_at ? new Date(p.created_at) : null;
  const due = p.due_date ? new Date(p.due_date) : null;
  const updated = p.updated_at ? new Date(p.updated_at) : null;

  const isPaid = status === 'paid' || status === 'completed';
  const isFailed = status === 'failed';
  const isRefunded = status === 'refunded';
  const isProcessing = status === 'processing';

  const events: TimelineEvent[] = [];

  // 1. Issued
  events.push({
    key: 'issued',
    label: 'Invoice Issued',
    date: issued ? format(issued, 'MMM d, yyyy · h:mm a') : null,
    state: issued ? 'done' : 'upcoming',
    icon: FileText,
    tone: 'primary',
  });

  // 2. Due
  if (due) {
    const overdue = !isPaid && !isRefunded && due < now;
    events.push({
      key: 'due',
      label: overdue ? 'Past Due' : 'Payment Due',
      date: format(due, 'MMM d, yyyy'),
      state: isPaid ? 'done' : overdue ? 'current' : 'upcoming',
      icon: CalendarClock,
      tone: overdue ? 'warning' : 'muted',
    });
  }

  // 3. Processing (only if currently processing or already paid via processing)
  if (isProcessing) {
    events.push({
      key: 'processing',
      label: 'Payment Processing',
      date: updated ? format(updated, 'MMM d, yyyy · h:mm a') : null,
      state: 'current',
      icon: Clock,
      tone: 'primary',
    });
  }

  // 4. Outcome
  if (isPaid) {
    events.push({
      key: 'paid',
      label: 'Payment Received',
      date: updated ? format(updated, 'MMM d, yyyy · h:mm a') : null,
      state: 'done',
      icon: CheckCircle2,
      tone: 'success',
    });
  } else if (isFailed) {
    events.push({
      key: 'failed',
      label: 'Payment Failed',
      date: updated ? format(updated, 'MMM d, yyyy · h:mm a') : null,
      state: 'current',
      icon: XCircle,
      tone: 'danger',
    });
  } else if (!isProcessing && !isRefunded) {
    events.push({
      key: 'awaiting',
      label: 'Awaiting Payment',
      date: null,
      state: 'upcoming',
      icon: Clock,
      tone: 'muted',
    });
  }

  // 5. Refund (if applicable)
  if (isRefunded) {
    // Show paid step as done before refund
    if (!events.some(e => e.key === 'paid')) {
      events.push({
        key: 'paid',
        label: 'Payment Received',
        date: null,
        state: 'done',
        icon: CheckCircle2,
        tone: 'success',
      });
    }
    events.push({
      key: 'refunded',
      label: 'Refunded',
      date: updated ? format(updated, 'MMM d, yyyy · h:mm a') : null,
      state: 'done',
      icon: RotateCcw,
      tone: 'muted',
    });
  }

  return events;
}

export function PaymentStatusTimeline({ payment, className, hideHeading = false }: { payment: PaymentTimelineRecord; className?: string; hideHeading?: boolean }) {
  const events = buildEvents(payment);

  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      {!hideHeading && <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Payment Timeline</h4>
      </div>}
      <ol className="relative space-y-4">
        {events.map((ev, idx) => {
          const Icon = ev.icon;
          const tone = toneClasses[ev.tone];
          const isLast = idx === events.length - 1;
          const dimmed = ev.state === 'upcoming' || ev.state === 'skipped';
          return (
            <li key={ev.key} className="relative flex gap-3">
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute start-[15px] top-8 bottom-[-16px] w-px',
                    dimmed ? 'bg-border' : 'bg-border'
                  )}
                />
              )}
              <span
                className={cn(
                  'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4',
                  dimmed ? 'bg-muted text-muted-foreground ring-background' : `${tone.dot} ring-background`,
                  ev.state === 'current' && 'animate-pulse'
                )}
              >
                <Icon className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className={cn('text-sm font-medium', dimmed ? 'text-muted-foreground' : tone.text)}>
                    {ev.label}
                  </p>
                  {ev.state === 'current' && (
                    <span className={cn('text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded', tone.badge)}>
                      Now
                    </span>
                  )}
                </div>
                {ev.date ? (
                  <p className="text-xs text-muted-foreground mt-0.5">{ev.date}</p>
                ) : (
                  <p className="text-xs text-muted-foreground/70 italic mt-0.5">
                    {ev.state === 'upcoming' ? 'Pending' : '—'}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
