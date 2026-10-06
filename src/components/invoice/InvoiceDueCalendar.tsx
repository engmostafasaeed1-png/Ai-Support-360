import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { CalendarClock, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { format, isSameDay, isBefore, startOfDay } from 'date-fns';
import { ConvertedAmount } from '@/components/currency/ConvertedAmount';

interface Props {
  payments: any[];
  onSelectPayment: (payment: any) => void;
}

/**
 * Calendar of invoice due dates. Each unpaid invoice appears on its due date
 * with its remaining balance; overdue ones are highlighted in red.
 */
export function InvoiceDueCalendar({ payments, onSelectPayment }: Props) {
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);
  const today = startOfDay(new Date());

  const withDue = useMemo(
    () =>
      (payments || [])
        .filter((p) => p.due_date)
        .map((p) => {
          const due = startOfDay(new Date(p.due_date));
          const isPaid = p.status === 'completed' || p.status === 'paid';
          const remaining = isPaid ? 0 : Number(p.amount || 0);
          const overdue = !isPaid && isBefore(due, today);
          return { ...p, _due: due, _isPaid: isPaid, _remaining: remaining, _overdue: overdue };
        })
        .sort((a, b) => a._due.getTime() - b._due.getTime()),
    [payments, today]
  );

  const dueDays = withDue.filter((p) => !p._overdue && !p._isPaid).map((p) => p._due);
  const overdueDays = withDue.filter((p) => p._overdue).map((p) => p._due);
  const paidDays = withDue.filter((p) => p._isPaid).map((p) => p._due);

  const dayPayments = selectedDay ? withDue.filter((p) => isSameDay(p._due, selectedDay)) : [];
  const upcoming = withDue.filter((p) => !p._isPaid && !p._overdue).slice(0, 5);
  const overdueList = withDue.filter((p) => p._overdue);

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" /> Invoice Due Dates
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[auto_1fr]">
        <div className="mx-auto">
          <Calendar
            mode="single"
            selected={selectedDay}
            onSelect={setSelectedDay}
            modifiers={{ due: dueDays, overdue: overdueDays, paid: paidDays }}
            modifiersClassNames={{
              due: 'bg-yellow-100 text-yellow-800 font-bold dark:bg-yellow-900/40 dark:text-yellow-300',
              overdue: 'bg-red-100 text-red-800 font-bold dark:bg-red-900/40 dark:text-red-300',
              paid: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
            }}
            className="pointer-events-auto rounded-xl border border-border/50"
          />
          <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400" /> Due</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /> Overdue</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Paid</span>
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          {selectedDay && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                {format(selectedDay, 'MMMM d, yyyy')}
              </p>
              {dayPayments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices due on this day.</p>
              ) : (
                <div className="space-y-2">
                  {dayPayments.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onSelectPayment(p)}
                      className="w-full text-start flex items-center justify-between gap-3 p-3 rounded-xl border border-border/40 bg-muted/20 hover:border-primary/30 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{p.invoice}</p>
                        <p className="text-xs text-muted-foreground truncate">{p.consultant}</p>
                      </div>
                      <div className="text-end shrink-0">
                        {p._isPaid ? (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Paid
                          </Badge>
                        ) : (
                          <>
                            <ConvertedAmount amount={p._remaining} currency={p.currency} className="items-end text-sm font-bold text-foreground" />
                            <p className="text-[10px] text-muted-foreground">remaining</p>
                          </>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {overdueList.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-3">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Overdue ({overdueList.length})
              </p>
              <div className="space-y-1.5">
                {overdueList.map((p) => (
                  <button key={p.id} onClick={() => onSelectPayment(p)} className="w-full text-start flex items-center justify-between gap-2 text-sm hover:underline">
                    <span className="truncate text-foreground">{p.invoice} · due {format(p._due, 'MMM d')}</span>
                    <ConvertedAmount amount={p._remaining} currency={p.currency} className="items-end text-sm font-bold text-red-700 dark:text-red-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Upcoming due dates
            </p>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming invoices with a due date.</p>
            ) : (
              <div className="space-y-1.5">
                {upcoming.map((p) => (
                  <button key={p.id} onClick={() => onSelectPayment(p)} className="w-full text-start flex items-center justify-between gap-2 text-sm hover:underline">
                    <span className="truncate text-foreground">{p.invoice} · {format(p._due, 'MMM d, yyyy')}</span>
                    <ConvertedAmount amount={p._remaining} currency={p.currency} className="items-end text-sm font-semibold text-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
