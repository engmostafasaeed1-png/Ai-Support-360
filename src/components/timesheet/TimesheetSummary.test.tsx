import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const terms = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/usePricingTerms', () => ({ usePricingTerms: () => ({ data: terms.value }) }));

import TimesheetSummary from './TimesheetSummary';
import type { SubmissionRow, WorkLogRow } from '@/lib/timesheet';
import type { ProgressStep } from '@/lib/timesheetView';

const log = (over: Partial<WorkLogRow> = {}): WorkLogRow => ({
  id: 'l1', ticket_id: 't1', consultant_id: 'c1', work_date: '2026-10-09', hours: 1, description: 'Analysis', category: 'support', billable: true,
  hourly_rate: 300, total_cost: 300, submission_id: null, created_at: '2026-10-09T08:00:00Z', ...over,
});
const sub = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 's1', ticket_id: 't1', submitted_by: 'u1', status: 'signed', total_hours: 1, billable_hours: 1, total_cost: 300, cost_currency: 'USD', hourly_rate: 300,
  vat_percent: null, vat_amount: null, grand_total: null, submitted_at: '2026-10-09T10:00:00Z', submit_count: 1, signed_at: '2026-10-11T10:00:00Z', signed_by_name: 'Client',
  created_at: '2026-10-09T10:00:00Z', ...over,
});
const base = { logs: [log()], submissions: [] as SubmissionRow[], vatPercent: 15, currency: 'USD', rateLabel: '300.00 USD per hour', plan: null };
const withFees = { serviceFeePercent: 10, processingFeePercent: 5, vatPercent: 15, plansEnabled: false, cardsEnabled: false };

beforeEach(() => {
  terms.value = null;
});
afterEach(() => cleanup());

describe('TimesheetSummary', () => {
  it('shows the hours, the fee, the fees and VAT, and the total that the client pays', () => {
    terms.value = withFees;
    render(<TimesheetSummary {...base} />);
    const tiles = within(screen.getByTestId('summary-tiles'));
    expect(tiles.getByText('Hours')).toBeTruthy();
    expect(tiles.getByText('1 h')).toBeTruthy();
    expect(tiles.getByText('Consultant fee')).toBeTruthy();
    expect(tiles.getByText('300.00 USD')).toBeTruthy();
    expect(tiles.getByText('Fees and VAT')).toBeTruthy();
    expect(tiles.getByText('96.75 USD')).toBeTruthy();
    expect(tiles.getByText('Total you pay')).toBeTruthy();
    expect(tiles.getByText('396.75 USD')).toBeTruthy();
  });

  it('shows the consultant the fee as theirs and what the client pays on top', () => {
    terms.value = withFees;
    render(<TimesheetSummary {...base} audience="consultant" />);
    const tiles = within(screen.getByTestId('summary-tiles'));
    expect(tiles.getByText('Your fee')).toBeTruthy();
    expect(tiles.getByText('you receive this in full')).toBeTruthy();
    expect(tiles.getByText('the client pays them on top')).toBeTruthy();
    expect(tiles.getByText('The client pays')).toBeTruthy();
    expect(tiles.getByText('396.75 USD')).toBeTruthy();
  });

  it('shows only the VAT when the percentages of the fees are not known', () => {
    render(<TimesheetSummary {...base} />);
    expect(screen.getByText('VAT 15%')).toBeTruthy();
    expect(within(screen.getByTestId('summary-tiles')).getByText('45.00 USD')).toBeTruthy();
  });

  it('says how the amount is calculated when one rate applies', () => {
    render(<TimesheetSummary {...base} />);
    expect(screen.getByText('300.00 USD per hour')).toBeTruthy();
    expect(screen.getByText(/Hours that are not billable cost nothing/)).toBeTruthy();
  });

  it('warns about hours that wait for an approved hourly rate', () => {
    render(<TimesheetSummary {...base} logs={[log({ hourly_rate: null, total_cost: null })]} />);
    expect(screen.getByText(/wait for an approved hourly rate/)).toBeTruthy();
  });

  it('shows the plan and warns when the hours are over it', () => {
    render(<TimesheetSummary {...base} plan={{ plannedHours: 0.5, plannedCost: 150, currency: 'USD', approved: true }} />);
    const plan = screen.getByTestId('plan-usage');
    expect(plan.textContent).toContain('Approved plan');
    expect(plan.textContent).toContain('200% of the hours used');
    expect(plan.textContent).toContain('over the plan');
  });

  it('shows the five steps and what comes next when the steps are given', () => {
    const steps: ProgressStep[] = [
      { key: 'rate', label: 'Rate', state: 'done', detail: '300.00 USD per hour' },
      { key: 'hours', label: 'Hours', state: 'done', detail: '1 h logged' },
      { key: 'submitted', label: 'Submitted', state: 'done', detail: 'Oct 9, 2026' },
      { key: 'approved', label: 'Approved', state: 'done', detail: 'Oct 11, 2026' },
      { key: 'paid', label: 'Paid', state: 'current', detail: 'Waiting for payment' },
    ];
    render(<TimesheetSummary {...base} steps={steps} />);
    expect(screen.getByTestId('timesheet-progress')).toBeTruthy();
    // the step and the label at the top of the card
    expect(screen.getAllByText('Waiting for payment')).toHaveLength(2);
  });

  it('shows no steps when none are given', () => {
    render(<TimesheetSummary {...base} />);
    expect(screen.queryByTestId('timesheet-progress')).toBeNull();
  });

  it('lists the hours per status', () => {
    const logs = [log({ id: 'a' }), log({ id: 'b', submission_id: 's1' })];
    render(<TimesheetSummary {...base} logs={logs} submissions={[sub()]} />);
    const breakdown = within(screen.getByTestId('status-breakdown'));
    expect(breakdown.getByText('Not sent yet')).toBeTruthy();
    expect(breakdown.getByText('Approved')).toBeTruthy();
  });

  it('shows no bar when nothing was logged', () => {
    render(<TimesheetSummary {...base} logs={[]} />);
    expect(screen.queryByTestId('status-breakdown')).toBeNull();
  });
});
