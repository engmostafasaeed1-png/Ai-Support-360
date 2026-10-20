import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatElapsed, progressOf, stepAnnouncement, type ProgressStep } from '@/lib/progressSteps';

export const SLOW_NOTE_MS = 10_000;

interface Action {
  label: string;
  onClick: () => void;
}

interface Props {
  title: string;
  steps: ProgressStep[];
  /** When the work started (Date.now()); the elapsed time is counted from here. */
  startedAt: number | null;
  /** Shown in the error state; the step that failed is marked. */
  error?: string | null;
  onRetry?: () => void;
  /** A safe way out while the work runs ("Cancel" or "Continue in background"). */
  cancel?: Action;
  /** A second choice in the error state (for example "Continue without recommendations"). */
  errorAction?: Action;
  /** Placeholder expert cards shown while the work runs. */
  skeletonCount?: number;
  /** Shown under the steps while nothing can be cancelled ("Please keep this page open"). */
  note?: string;
  className?: string;
}

function StepIcon({ step, index }: { step: ProgressStep; index: number }) {
  if (step.state === 'done') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground" aria-hidden="true">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (step.state === 'error') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground" aria-hidden="true">
        <AlertTriangle className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (step.state === 'active') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-primary" aria-hidden="true">
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-card text-[11px] font-semibold text-muted-foreground" aria-hidden="true">
      {index + 1}
    </span>
  );
}

const STATE_WORD: Record<ProgressStep['state'], string> = { done: 'Done', active: 'In progress', error: 'Failed', todo: 'Not started' };

/**
 * A step-by-step progress panel: the bar only moves when a real step finishes, a step of unknown length pulses
 * instead of showing a made-up percentage, the elapsed time is shown, and every change is announced to screen readers.
 */
export default function TaskProgressPanel({ title, steps, startedAt, error, onRetry, cancel, errorAction, skeletonCount = 0, note, className }: Props) {
  const p = progressOf(steps);
  const running = !p.allDone && !p.failed && !error;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || startedAt === null) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const announcement = error && !p.failed ? `Failed: ${error}` : stepAnnouncement(steps);
  const openStep = running && p.current?.state === 'active' && p.current.open;
  const segment = p.total ? 100 / p.total : 0;

  return (
    <section
      aria-label={title}
      data-testid="task-progress"
      data-status={p.allDone ? 'done' : p.failed || error ? 'error' : 'running'}
      className={cn('space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-card sm:p-5', className)}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            p.allDone ? 'bg-success/15 text-success motion-safe:animate-scale-in' : p.failed || error ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
          )}
          aria-hidden="true"
        >
          {p.allDone ? <Check className="h-5 w-5" /> : p.failed || error ? <AlertTriangle className="h-5 w-5" /> : <Loader2 className="h-5 w-5 motion-safe:animate-spin" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{p.allDone ? 'Done' : title}</p>
          <p className="text-xs text-muted-foreground">
            {p.allDone ? `${title}: finished` : `Step ${p.position} of ${p.total}`}
            {startedAt !== null && (
              <>
                {' · '}
                <span data-testid="task-elapsed">
                  <span className="sr-only">Time elapsed </span>
                  {formatElapsed(elapsed)}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.percent}
        aria-valuetext={announcement}
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('absolute inset-y-0 start-0 rounded-full motion-safe:transition-[width] motion-safe:duration-500', p.failed || error ? 'bg-destructive' : p.allDone ? 'bg-success' : 'bg-primary')}
          style={{ width: `${p.percent}%` }}
        />
        {openStep && (
          <div
            data-testid="task-open-segment"
            className="absolute inset-y-0 rounded-full bg-primary/40 motion-safe:animate-pulse-soft"
            style={{ insetInlineStart: `${p.percent}%`, width: `${segment}%` }}
          />
        )}
      </div>

      <ol className="space-y-2.5" aria-label={`${title}: steps`}>
        {steps.map((step, i) => (
          <li key={step.key} data-state={step.state} aria-current={step.state === 'active' ? 'step' : undefined} className="flex items-start gap-3">
            <StepIcon step={step} index={i} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn('text-sm leading-snug', step.state === 'todo' ? 'text-muted-foreground' : 'font-medium text-foreground')}>{step.label}</p>
              <span className="sr-only">{STATE_WORD[step.state]}</span>
              {step.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{step.detail}</p>}
            </div>
          </li>
        ))}
      </ol>

      {running && elapsed >= SLOW_NOTE_MS && (
        <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground" data-testid="task-slow-note">
          Still working, this can take up to a minute.
        </p>
      )}
      {running && note && <p className="text-xs text-muted-foreground">{note}</p>}

      {(p.failed || error) && (
        <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-foreground">{error || 'Something went wrong.'}</p>
          <div className="flex flex-wrap gap-2">
            {onRetry && (
              <Button type="button" size="sm" onClick={onRetry} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" /> Retry
              </Button>
            )}
            {errorAction && (
              <Button type="button" size="sm" variant="outline" onClick={errorAction.onClick}>
                {errorAction.label}
              </Button>
            )}
          </div>
        </div>
      )}

      {running && cancel && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={cancel.onClick}>
            {cancel.label}
          </Button>
        </div>
      )}

      {running && skeletonCount > 0 && (
        <div className="space-y-2" aria-hidden="true" data-testid="task-skeletons">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border/40 p-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-6 w-12 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}

/** The short success line shown above results once a run has finished. */
export function TaskDoneNote({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-xs font-medium text-success" role="status" data-testid="task-done-note">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15 motion-safe:animate-scale-in" aria-hidden="true">
        <Check className="h-3 w-3" />
      </span>
      {text}
    </p>
  );
}
