import { AlertTriangle, Check } from 'lucide-react';
import type { ProgressStep, StepState } from '@/lib/timesheetView';

const CIRCLE: Record<StepState, string> = {
  done: 'bg-green-500 text-white',
  current: 'border-2 border-primary bg-card font-bold text-primary ring-4 ring-primary/10',
  attention: 'bg-orange-500 text-white',
  todo: 'border-2 border-border bg-card text-muted-foreground',
};

const STATE_WORD: Record<StepState, string> = {
  done: 'Done',
  current: 'Current step',
  attention: 'Needs attention',
  todo: 'Not yet',
};

// the line from the middle of a step to the middle of the next one (it lies behind the circles)
const LINE = "after:absolute after:start-1/2 after:top-4 after:h-0.5 after:w-full after:content-['']";
const LINE_DONE = `${LINE} after:bg-green-500`;
const LINE_OPEN = `${LINE} after:bg-border`;

/** The five steps of a timesheet in a row: rate, hours, submitted, approved, paid. The details are shown from the small-screen size up. */
export default function TimesheetProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol aria-label="Timesheet progress" className="flex w-full items-start" data-testid="timesheet-progress">
      {steps.map((step, index) => {
        const next = steps[index + 1];
        const line = !next ? '' : step.state === 'done' && next.state === 'done' ? LINE_DONE : LINE_OPEN;
        return (
          <li
            key={step.key}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 text-center ${line}`}
          >
            <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm ${CIRCLE[step.state]}`} aria-hidden="true">
              {step.state === 'done' ? <Check className="h-4 w-4" /> : step.state === 'attention' ? <AlertTriangle className="h-4 w-4" /> : index + 1}
            </span>
            <span className="text-xs font-semibold text-foreground">{step.label}</span>
            <span className="sr-only">{STATE_WORD[step.state]}</span>
            <span className="hidden px-1 text-[11px] leading-tight text-muted-foreground sm:block">{step.detail}</span>
          </li>
        );
      })}
    </ol>
  );
}
