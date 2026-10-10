/** What the SLA overview needs from a ticket. */
export interface SlaTicket {
  id: string;
  title: string;
  urgency: string;
  status: string;
  created_at: string;
  sla_response_deadline: string | null;
  sla_deadline: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  sla_breached: boolean | null;
}

export type SlaState = 'met' | 'on_track' | 'at_risk' | 'breached';

const HOUR_MS = 3_600_000;
const FINISHED = new Set(['resolved', 'closed', 'cancelled']);

/** The SLA state of one ticket, or null when it has no resolution deadline. */
export function slaState(t: SlaTicket, now: number = Date.now()): SlaState | null {
  if (!t.sla_deadline) return null;
  const deadline = new Date(t.sla_deadline).getTime();
  if (Number.isNaN(deadline)) return null;
  const finishedAt = t.resolved_at ? new Date(t.resolved_at).getTime() : null;
  if (finishedAt !== null || FINISHED.has(t.status)) {
    const late = finishedAt !== null ? finishedAt > deadline : false;
    return t.sla_breached || late ? 'breached' : 'met';
  }
  if (t.sla_breached || now > deadline) return 'breached';
  const total = deadline - new Date(t.created_at).getTime();
  const remaining = deadline - now;
  return total > 0 && remaining < total * 0.25 ? 'at_risk' : 'on_track';
}

export interface SlaSummary {
  /** Tickets that have a resolution deadline. */
  tracked: number;
  /** Tickets that missed it (resolved late, flagged by the platform, or still open after the deadline). */
  breached: number;
  /** Percent of the tracked tickets, or null when there are none. */
  breachRate: number | null;
  avgFirstResponseHours: number | null;
  firstResponseCount: number;
  avgResolutionHours: number | null;
  resolutionCount: number;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / HOUR_MS;
}

/** Numbers measured from the tickets themselves. */
export function summarize(tickets: SlaTicket[], now: number = Date.now()): SlaSummary {
  const states = tickets.map((t) => slaState(t, now)).filter((s): s is SlaState => s !== null);
  const breached = states.filter((s) => s === 'breached').length;
  const responses = tickets
    .filter((t) => t.first_response_at)
    .map((t) => hoursBetween(t.created_at, t.first_response_at as string))
    .filter((h) => Number.isFinite(h) && h >= 0);
  const resolutions = tickets
    .filter((t) => t.resolved_at)
    .map((t) => hoursBetween(t.created_at, t.resolved_at as string))
    .filter((h) => Number.isFinite(h) && h >= 0);
  return {
    tracked: states.length,
    breached,
    breachRate: states.length ? (breached / states.length) * 100 : null,
    avgFirstResponseHours: average(responses),
    firstResponseCount: responses.length,
    avgResolutionHours: average(resolutions),
    resolutionCount: resolutions.length,
  };
}

export function formatHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} hrs`;
  return `${(hours / 24).toFixed(1)} days`;
}
