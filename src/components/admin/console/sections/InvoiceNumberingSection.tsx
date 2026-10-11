import { useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Hash, History as HistoryIcon, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInvoiceCounter, useSetInvoiceCounter } from '@/hooks/useInvoiceCounter';
import {
  MAX_COUNTER_NUMBER,
  REASON_MAX,
  describeGap,
  formatInvoiceNumber,
  parseCounterInput,
  validateNextNumber,
  validateReason,
  yearOf,
} from '@/lib/invoiceCounter';

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, 'MMM d, yyyy HH:mm');
};

export default function InvoiceNumberingSection() {
  const { data: info, isLoading, error } = useInvoiceCounter();
  const setCounter = useSetInvoiceCounter();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsed = parseCounterInput(value);
  const valueError = info ? validateNextNumber(value, info) : null;
  const reasonError = validateReason(reason);
  const canSave = !!info && parsed !== null && !valueError && !reasonError;
  const preview = info && parsed !== null && !valueError ? formatInvoiceNumber(info.year, info.quarter, parsed) : null;
  const gap = info ? describeGap(info) : null;

  const review = () => {
    setTouched(true);
    if (canSave) setConfirmOpen(true);
  };

  const save = () => {
    if (!canSave || parsed === null) return;
    setCounter.mutate(
      { next: parsed, reason },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setValue('');
          setReason('');
          setTouched(false);
        },
        onError: () => setConfirmOpen(false),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Hash aria-hidden="true" className="h-5 w-5 text-primary" /> Invoice Numbering
        </h2>
        <p className="text-sm text-muted-foreground">
          Every invoice the platform creates gets a number like INV-2026-Q4-000019: the year, the quarter in which the invoice is created, and a counter.
          The counter starts again at 1 on 1 January (Cairo time). Numbers that are already on invoices never change.
          Change the counter only when your accountant asks for it. Every change is saved with your name, the time and your reason.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-52 rounded-2xl" />
        </div>
      ) : error || !info ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'The counter could not be loaded.'}
        </p>
      ) : (
        <>
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">The counter now ({info.year})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  The next invoice gets this number. The quarter in it is the quarter in which the invoice is created.
                </p>
                <p className="font-mono text-3xl font-bold tracking-tight text-foreground">{info.next_invoice_number}</p>
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Highest number on an invoice this year</dt>
                  <dd className="font-medium text-foreground">{info.highest_used_invoice ?? 'No invoice this year yet'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Lowest number you can set now</dt>
                  <dd className="font-medium text-foreground">{info.lowest_allowed_next}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Invoices this year (all years)</dt>
                  <dd className="font-medium text-foreground">{info.invoices_this_year} ({info.invoices_total})</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                On 1 January {info.year + 1} the counter starts again at 1: the first invoice of {info.year + 1} will be {info.first_invoice_next_year}.
              </p>
              {gap ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-900">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{gap} A gap in the numbering can matter for accounting: ask your accountant before you close it.</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Change the counter of {info.year}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-next" className="text-xs">Next number of {info.year}</Label>
                  <Input
                    id="inv-next"
                    inputMode="numeric"
                    autoComplete="off"
                    value={value}
                    placeholder={String(info.lowest_allowed_next)}
                    aria-invalid={touched && !!valueError}
                    aria-describedby="inv-next-hint"
                    onChange={(e) => {
                      setValue(e.target.value.replace(/\D/g, '').slice(0, 7));
                      setTouched(true);
                    }}
                  />
                  <p
                    id="inv-next-hint"
                    aria-live="polite"
                    className={touched && valueError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
                  >
                    {touched && valueError
                      ? valueError
                      : preview
                        ? `The next invoice will be ${preview}.`
                        : `From ${info.lowest_allowed_next} to ${MAX_COUNTER_NUMBER}.`}
                  </p>
                  {info.lowest_allowed_next < info.next_number ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        setValue(String(info.lowest_allowed_next));
                        setTouched(true);
                      }}
                    >
                      Use the lowest free number ({info.lowest_allowed_next})
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="inv-reason" className="text-xs">Reason (kept in the history)</Label>
                  <Textarea
                    id="inv-reason"
                    rows={3}
                    maxLength={REASON_MAX}
                    value={reason}
                    placeholder="For example: the accountant asked to close the gap after deleted test invoices"
                    aria-invalid={touched && !!reasonError}
                    aria-describedby="inv-reason-hint"
                    onChange={(e) => {
                      setReason(e.target.value);
                      setTouched(true);
                    }}
                  />
                  <p
                    id="inv-reason-hint"
                    className={touched && reasonError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
                  >
                    {touched && reasonError ? reasonError : `${reason.trim().length} of ${REASON_MAX} characters`}
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={review} disabled={setCounter.isPending}>Review the change</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <HistoryIcon aria-hidden="true" className="h-4 w-4" /> History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {info.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">The counter was never changed here.</p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {info.history.map((h, i) => {
                    const y = h.year ?? yearOf(h.changed_at, info.year);
                    return (
                      <li key={`${h.changed_at}-${i}`} className="space-y-0.5 py-3 text-sm">
                        <p className="font-medium text-foreground">
                          <span className="font-mono">{formatInvoiceNumber(y, h.quarter, h.old_next)}</span>
                          {' → '}
                          <span className="font-mono">{formatInvoiceNumber(y, h.quarter, h.new_next)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{when(h.changed_at)} · {h.changed_by_name}</p>
                        <p className="text-xs text-foreground">{h.reason}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">The last 20 changes are shown. The history can not be edited or deleted.</p>
            </CardContent>
          </Card>

          <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o && !setCounter.isPending) setConfirmOpen(false); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Change the invoice counter?</DialogTitle>
                <DialogDescription>
                  The next invoice will be <span className="font-mono font-semibold text-foreground">{preview ?? ''}</span> instead of{' '}
                  <span className="font-mono">{info.next_invoice_number}</span>.
                </DialogDescription>
              </DialogHeader>
              <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                <li>Invoices that already exist keep their numbers.</li>
                <li>The change is saved with your name, the time and your reason, and it can not be erased.</li>
                <li>The database refuses a number that an invoice of this year already has.</li>
              </ul>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={setCounter.isPending}>Cancel</Button>
                <Button onClick={save} disabled={setCounter.isPending} className="gap-2">
                  {setCounter.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  Change the counter
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
