import { describe, expect, it } from 'vitest';
import { slaRowSummary } from '@/components/sla/SlaListControls';
import { renderSlaEmail } from '../../../supabase/functions/_shared/slaEmail';
import type { ListState } from './api';

const cal = { mode: '24x7' as const, tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', holidays: [] };
const clock = (kind: 'response' | 'resolution', over: Partial<ListState['clocks'] extends (infer C)[] | null ? C : never> = {}) => ({
  kind, target_min: 100, extended_min: 0, started_at: new Date(Date.now() - 50 * 60_000).toISOString(), running_since: new Date(Date.now() - 50 * 60_000).toISOString(),
  consumed_min: 0, paused_since: null, pause_reason: null, due_at: null, met_at: null, breached_at: null, stopped_at: null, consumed_now: 50, ...over,
});

describe('SLA list column', () => {
  it('shows the worst open clock (breached before on track; met clocks ignored)', () => {
    const s: ListState = { ticket_id: 't', severity: 'S2', calendar: cal, clocks: [clock('response', { met_at: new Date().toISOString() }), clock('resolution', { breached_at: new Date().toISOString() })] };
    expect(slaRowSummary(s, 75)?.state).toBe('breached');
    expect(slaRowSummary(s, 75)?.clock.kind).toBe('resolution');
  });
  it('flags paused tickets for the "paused" filter', () => {
    const s: ListState = { ticket_id: 't', severity: 'S3', calendar: cal, clocks: [clock('resolution', { running_since: null, paused_since: new Date().toISOString(), pause_reason: 'on_hold', consumed_min: 10 })] };
    expect(slaRowSummary(s, 75)).toMatchObject({ state: 'paused', anyPaused: true });
  });
  it('no snapshot = no chip', () => {
    expect(slaRowSummary(undefined, 75)).toBeNull();
  });
});

describe('SLA e-mail', () => {
  it('escapes the ticket title and keeps links on the site', () => {
    const r = renderSlaEmail({ kind: 'breach', ticketTitle: '<script>x</script>', severity: 'S1', path: '//evil.test/x', siteUrl: 'https://www.aisupport360.com' });
    expect(r.html).not.toContain('<script>x');
    expect(r.html).toContain('href="https://www.aisupport360.com/"');
    expect(r.subject).toBe('SLA target passed (S1): <script>x</script>');
  });
  it('Arabic is right-to-left and polite (never "warning")', () => {
    const r = renderSlaEmail({ kind: 'reminder', lang: 'ar', ticketTitle: 'FB60', leftMin: 45, severity: 'S2' });
    expect(r.html).toContain('dir="rtl"');
    expect(r.text).toContain('45 دقيقة');
    expect(r.text).not.toMatch(/تحذير|warning/i);
  });
});
