// The matching context of a request (tickets.ticket_context). Only non-empty values are kept; the database accepts only these keys.
export interface TicketContextInput {
  industry?: string;
  customer_segment?: string;
  country?: string;
  project_type?: string;
  vertical_solutions?: string[];
  localization_solutions?: string[];
}

export type TicketContext = Partial<Record<'industry' | 'customer_segment' | 'country' | 'project_type', string>> &
  Partial<Record<'vertical_solutions' | 'localization_solutions', string[]>>;

const clip = (s: string) => s.trim().slice(0, 160);

export function buildTicketContext(input: TicketContextInput): TicketContext | null {
  const out: TicketContext = {};
  for (const key of ['industry', 'customer_segment', 'country', 'project_type'] as const) {
    const v = clip(input[key] ?? '');
    if (v) out[key] = v;
  }
  for (const key of ['vertical_solutions', 'localization_solutions'] as const) {
    const list = Array.from(new Set((input[key] ?? []).map(clip).filter(Boolean))).slice(0, 12);
    if (list.length > 0) out[key] = list;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The saved context as "Label: value" lines for read-only badges. */
export function ticketContextBadges(ctx: unknown): string[] {
  if (!ctx || typeof ctx !== 'object') return [];
  const c = ctx as Record<string, unknown>;
  const labels: Record<string, string> = {
    industry: 'Industry', customer_segment: 'Customer segment', country: 'Country', project_type: 'Project type',
    vertical_solutions: 'Vertical solution', localization_solutions: 'Localization solution',
  };
  const out: string[] = [];
  for (const key of Object.keys(labels)) {
    const v = c[key];
    if (typeof v === 'string' && v.trim()) out.push(`${labels[key]}: ${v}`);
    else if (Array.isArray(v)) v.filter(x => typeof x === 'string' && x.trim()).forEach(x => out.push(`${labels[key]}: ${x}`));
  }
  return out;
}

/** Adds ticket_context to a request body or a new ticket row, only when there is a context. Used for the match call and the ticket insert. */
export function withTicketContext<T extends Record<string, unknown>>(target: T, ctx: TicketContext | null): T & { ticket_context?: TicketContext } {
  return ctx ? { ...target, ticket_context: ctx } : target;
}
