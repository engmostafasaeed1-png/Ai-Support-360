import { Lock, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/timesheet/StatusBadge';
import { categoryLabel, entryAmount, formatDuration, formatHours, formatMoney, isLocked, type SubmissionRow, type WorkLogRow } from '@/lib/timesheet';
import { CATEGORY_COLORS, dayParts, type EntryGroup } from '@/lib/timesheetView';

// small screens: date | activity | time, with the amount and the buttons on a second line; from the small-screen size up: one line with five columns
const COLUMNS = 'grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_7.5rem_3.5rem]';

export interface EntryTotals {
  hours: number;
  billableHours: number;
  amount: number;
}

interface Props {
  groups: EntryGroup[];
  currency: string;
  submissions: SubmissionRow[];
  /** user id -> name, for the header of a timesheet */
  names: Record<string, string>;
  /** the client side: the entries that are in no timesheet were not sent to the client yet */
  isReadOnly: boolean;
  canEdit: (entry: WorkLogRow) => boolean;
  onEdit: (entry: WorkLogRow) => void;
  onDelete: (entry: WorkLogRow) => void;
  totals: EntryTotals;
}

/** The activities of a ticket as a table: the entries that are not submitted, then the entries of every timesheet, with the totals at the end. */
export default function TimesheetEntriesTable({ groups, currency, submissions, names, isReadOnly, canEdit, onEdit, onDelete, totals }: Props) {
  return (
    <div role="table" aria-label="Time entries" className="border-t border-border/50">
      <div
        role="row"
        className="hidden gap-x-3 bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_7.5rem_3.5rem]"
      >
        <span role="columnheader">Date</span>
        <span role="columnheader">Activity</span>
        <span role="columnheader">Time</span>
        <span role="columnheader" className="text-end">Amount</span>
        <span role="columnheader" className="sr-only">Actions</span>
      </div>

      {groups.map(group => (
        <div role="rowgroup" key={group.key}>
          <div role="row">
            <div role="rowheader" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-border/50 bg-muted/30 px-4 py-2 text-xs">
              {group.submission ? (
                <>
                  <StatusBadge status={group.status} />
                  <span className="font-medium text-foreground">{names[group.submission.submitted_by] || 'Consultant'}</span>
                  <span className="text-muted-foreground">
                    {formatHours(group.submission.total_hours)} &middot; {formatMoney(group.submission.total_cost, group.submission.cost_currency)} without VAT
                  </span>
                </>
              ) : (
                <>
                  <Badge variant="secondary" className="bg-muted text-[10px] text-muted-foreground">
                    {isReadOnly ? 'Not sent to you yet' : 'Not submitted yet'}
                  </Badge>
                  <span className="text-muted-foreground">{formatHours(group.hours)} &middot; {formatMoney(group.amount, currency)}</span>
                </>
              )}
            </div>
          </div>
          {group.entries.map(entry => (
            <EntryRow key={entry.id} entry={entry} currency={currency} submissions={submissions} editable={canEdit(entry)} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      ))}

      <div role="row" className={`grid ${COLUMNS} items-center gap-x-3 bg-muted/40 px-4 py-2.5 text-sm font-semibold text-foreground`}>
        <span role="cell" className="col-span-2">Total</span>
        <span role="cell" className="text-end sm:text-start">
          {formatHours(totals.hours)}
          <span className="sm:hidden"> &middot; {formatMoney(totals.amount, currency)}</span>
        </span>
        <span role="cell" className="hidden text-end sm:block">{formatMoney(totals.amount, currency)}</span>
        <span role="cell" className="hidden sm:block" />
      </div>
    </div>
  );
}

function EntryRow({ entry, currency, submissions, editable, onEdit, onDelete }: {
  entry: WorkLogRow;
  currency: string;
  submissions: SubmissionRow[];
  editable: boolean;
  onEdit: (entry: WorkLogRow) => void;
  onDelete: (entry: WorkLogRow) => void;
}) {
  const parts = dayParts(entry.work_date);
  const amount = entryAmount(entry);
  const locked = isLocked(entry, submissions);
  return (
    <div
      role="row"
      className={`grid ${COLUMNS} items-start gap-x-3 gap-y-1 border-b border-border/40 px-4 py-3`}
      data-testid="timesheet-entry"
    >
      <div role="cell" className="col-start-1 row-span-2 row-start-1 flex w-12 flex-col items-center self-start rounded-lg bg-muted/60 py-1 sm:row-span-1 sm:w-14">
        <span className="text-[10px] font-medium uppercase text-muted-foreground">{parts.month}</span>
        <span className="text-base font-bold leading-none text-foreground">{parts.day}</span>
        <span className="text-[10px] text-muted-foreground">{parts.weekday}</span>
      </div>

      <div role="cell" className="col-start-2 row-start-1 min-w-0 space-y-1">
        {entry.description ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{entry.description}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No description</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className={`px-1.5 py-0 text-[10px] ${CATEGORY_COLORS[entry.category] || ''}`}>{categoryLabel(entry.category)}</Badge>
          {entry.consultant_name ? <span>{entry.consultant_name}</span> : null}
        </div>
      </div>

      <div role="cell" className="col-start-3 row-start-1 text-end sm:text-start">
        <p className="text-sm font-semibold text-foreground">{formatDuration(entry.hours)}</p>
        <p className={`flex items-center justify-end gap-1 text-[11px] sm:justify-start ${entry.billable ? 'text-green-700' : 'text-muted-foreground'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${entry.billable ? 'bg-green-500' : 'bg-slate-400'}`} aria-hidden="true" />
          {entry.billable ? 'Billable' : 'Not billable'}
        </p>
      </div>

      <div role="cell" className="col-start-2 row-start-2 sm:col-start-4 sm:row-start-1 sm:text-end">
        {!entry.billable ? (
          <p className="text-xs text-muted-foreground sm:text-sm">
            <span className="sm:hidden">Amount: </span>{formatMoney(0, currency)}
          </p>
        ) : entry.hourly_rate == null ? (
          <p className="text-xs text-amber-700 sm:text-sm">Rate pending approval</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">
              <span className="text-xs font-normal text-muted-foreground sm:hidden">Amount: </span>{formatMoney(amount, currency)}
            </p>
            <p className="text-[11px] text-muted-foreground">{formatMoney(entry.hourly_rate, currency)} per hour</p>
          </>
        )}
      </div>

      <div role="cell" className="col-start-3 row-start-2 flex items-start justify-end gap-1 sm:col-start-5 sm:row-start-1">
        {locked && <Lock className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-label="Locked: part of a timesheet that was sent to the client or approved" />}
        {editable && (
          <>
            <button type="button" onClick={() => onEdit(entry)} className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Change this entry">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => onDelete(entry)} className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive" aria-label="Delete this entry">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
