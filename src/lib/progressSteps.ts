/**
 * Step-based progress for long work (saving a request, ranking experts).
 * The bar only moves when a real step finishes: percent = finished steps / all steps.
 * A step whose length cannot be known (one call to the server) is marked `open`; the panel then shows
 * an honest "working" pulse on that part of the bar instead of a made-up percentage.
 */
export type StepState = 'todo' | 'active' | 'done' | 'error';

export interface ProgressStep {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
  /** The length of this step is unknown (a single server call). */
  open?: boolean;
}

export type StepDef = { key: string; label: string; open?: boolean; detail?: string };

export const makeSteps = (defs: StepDef[]): ProgressStep[] => defs.map((d) => ({ ...d, state: 'todo' as const }));

/** A copy of the steps with one step changed. A step only moves forward to `done` or `error`. */
export function setStep(steps: ProgressStep[], key: string, state: StepState, detail?: string): ProgressStep[] {
  return steps.map((s) => (s.key === key ? { ...s, state, ...(detail !== undefined && { detail }) } : s));
}

export interface ProgressSummary {
  total: number;
  finished: number;
  percent: number;
  /** The step that is running or failed, or null when nothing runs. */
  current: ProgressStep | null;
  failed: ProgressStep | null;
  allDone: boolean;
  /** 1-based number of the step that is shown as current. */
  position: number;
}

export function progressOf(steps: ProgressStep[]): ProgressSummary {
  const total = steps.length;
  const finished = steps.filter((s) => s.state === 'done').length;
  const failed = steps.find((s) => s.state === 'error') ?? null;
  const current = failed ?? steps.find((s) => s.state === 'active') ?? null;
  const index = current ? steps.indexOf(current) : finished;
  return {
    total,
    finished,
    percent: total ? Math.round((finished / total) * 100) : 0,
    current,
    failed,
    allDone: total > 0 && finished === total,
    position: Math.min(index + 1, total),
  };
}

/** The sentence a screen reader hears for the present state. */
export function stepAnnouncement(steps: ProgressStep[]): string {
  const p = progressOf(steps);
  if (p.allDone) return 'Done';
  if (p.failed) return `Step ${p.position} of ${p.total} failed: ${p.failed.label}`;
  if (p.current) return `Step ${p.position} of ${p.total}: ${p.current.label}`;
  return `Step ${p.position} of ${p.total}`;
}

/** "0:07", "1:05". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
