import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Landmark } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useBankTransferCompanies, useBankTransferLog, usePaymentSettings, useSetCompanyBankTransfer, type BankTransferCompany,
} from '@/hooks/useBilling';

const when = (d?: string | null) => (d ? format(new Date(d), 'MMM d, yyyy HH:mm') : '-');

/**
 * Admin: who may pay by bank transfer. Card payment is the main way to pay; bank transfer is a permission that only an administrator gives,
 * to a whole company here, or to one invoice (All invoices > Payment options). While card payments are off, bank transfer is open for everybody.
 */
export default function BankTransferSettingsCard() {
  const settingsQ = usePaymentSettings();
  const companiesQ = useBankTransferCompanies();
  const logQ = useBankTransferLog(6);
  const setCompany = useSetCompanyBankTransfer();
  const [search, setSearch] = useState('');
  const [onlyAllowed, setOnlyAllowed] = useState(false);
  const [target, setTarget] = useState<{ company: BankTransferCompany; allow: boolean } | null>(null);
  const [note, setNote] = useState('');

  const cardsOn = !!settingsQ.data?.cards;
  const allowedCount = (companiesQ.data ?? []).filter((c) => c.allowed).length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (companiesQ.data ?? []).filter((c) => (!onlyAllowed || c.allowed) && (!q || c.name.toLowerCase().includes(q)));
  }, [companiesQ.data, search, onlyAllowed]);
  const log = logQ.data ?? [];

  const close = () => {
    setTarget(null);
    setNote('');
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4" /> Who may pay by bank transfer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Card payment (Visa, Mastercard) is the main way to pay. Bank transfer is optional and only you can allow it: for a whole company here, or for one invoice (All invoices, "Payment options"). The bank account is shown only to administrators and to clients who may pay by bank transfer.
        </p>

        {settingsQ.data && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={cardsOn ? 'default' : 'secondary'} className="text-[10px]">{cardsOn ? 'Card payments are on' : 'Card payments are off'}</Badge>
            <span className="text-xs text-muted-foreground">
              {cardsOn
                ? 'Bank transfer is open only for the companies and invoices that you allowed.'
                : 'Bank transfer is open for everybody until you switch card payments on. The permissions below count from then on.'}
            </span>
          </div>
        )}

        {companiesQ.isLoading ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : companiesQ.isError ? (
          <p className="text-xs text-destructive">The companies could not be loaded. Please reload the page.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a company..." className="max-w-xs rounded-xl" />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={onlyAllowed} onCheckedChange={setOnlyAllowed} aria-label="Show only the allowed companies" />
                {`Only allowed (${allowedCount})`}
              </label>
            </div>
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No company found.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-end">Open invoices</TableHead>
                      <TableHead>Bank transfer</TableHead>
                      <TableHead>Allowed since</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium">{c.name}</TableCell>
                        <TableCell className="text-end text-sm">{c.openInvoices}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={c.allowed}
                              disabled={setCompany.isPending}
                              onCheckedChange={(on) => {
                                setNote('');
                                setTarget({ company: c, allow: on });
                              }}
                              aria-label={`Allow bank transfer for ${c.name}`}
                            />
                            <span className="text-xs">{c.allowed ? 'Allowed' : 'Card only'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.allowed ? (
                            <>
                              <div>{when(c.grantedAt)}</div>
                              {c.note && <div className="max-w-[240px] truncate">{`"${c.note}"`}</div>}
                            </>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Recent changes</p>
          {logQ.isLoading ? (
            <Skeleton className="h-10 rounded-lg" />
          ) : log.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing changed yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {log.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Badge variant={r.allowed ? 'default' : 'outline'} className="text-[10px]">{r.allowed ? 'Allowed' : 'Stopped'}</Badge>
                  {r.scope === 'invoice' ? (
                    <span className="font-medium">Invoice <span className="font-mono">{r.label.replace(/^Invoice\s*/, '')}</span></span>
                  ) : (
                    <span className="font-medium">{r.label}</span>
                  )}
                  <span className="text-muted-foreground">{when(r.changed_at)}</span>
                  {r.note && <span className="text-muted-foreground">{`"${r.note}"`}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{target?.allow ? 'Allow bank transfer' : 'Stop bank transfer'}</DialogTitle>
            <DialogDescription>
              <strong>{target?.company.name}</strong>{' '}
              {target?.allow
                ? 'will see the bank details and can report a bank transfer for its invoices. The company owner is told.'
                : 'will pay by card only from now on. A transfer that it already reported stays for you to confirm. The company owner is told.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label className="text-xs">Note (optional, for your records; the company does not see it)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="For example: agreed with the finance office"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button
              disabled={setCompany.isPending}
              onClick={() => {
                if (target) setCompany.mutate({ tenantId: target.company.id, allowed: target.allow, note }, { onSuccess: close });
              }}
            >
              {target?.allow ? 'Allow' : 'Stop'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
