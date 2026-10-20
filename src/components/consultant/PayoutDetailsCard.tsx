import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Landmark, AlertTriangle, ShieldCheck, Lock, Eye, EyeOff, Pencil } from 'lucide-react';
import { useMyPayoutDetails, useSavePayoutDetails, type PayoutDetails } from '@/hooks/useBilling';
import { maskAccount, maskIban } from '@/lib/iban';
import { PAYOUT_MESSAGES, payoutFieldErrors, type PayoutField } from '@/lib/payoutValidation';
import { PAYOUT_DISCLAIMER_POINTS, PAYOUT_DISCLAIMER_VERSION, payoutCardState } from '@/lib/payoutDisclaimer';

export const REVEAL_MS = 30_000;

type Form = {
  account_holder: string; bank_name: string; iban: string; account_number: string;
  swift_bic: string; country: string; currency: string; notes: string;
};

const EMPTY: Form = { account_holder: '', bank_name: '', iban: '', account_number: '', swift_bic: '', country: '', currency: 'USD', notes: '' };

const fromRow = (d: PayoutDetails | null | undefined): Form => (d ? {
  account_holder: d.account_holder ?? '', bank_name: d.bank_name ?? '', iban: d.iban ?? '', account_number: d.account_number ?? '',
  swift_bic: d.swift_bic ?? '', country: d.country ?? '', currency: d.currency ?? 'USD', notes: d.notes ?? '',
} : EMPTY);

const day = (s?: string | null) => (s ? format(new Date(s), 'MMM d, yyyy') : '');

/** The consultant's own bank details: where the platform transfers the payouts. Values live only in component state. */
export default function PayoutDetailsCard() {
  const { t } = useTranslation();
  const [savedNow, setSavedNow] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data, isLoading } = useMyPayoutDetails();
  const save = useSavePayoutDetails();
  const d = data?.details ?? null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [ack, setAck] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<PayoutField, boolean>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRevealed(false);
  };
  const reveal = () => {
    if (timer.current) clearTimeout(timer.current);
    setRevealed(true);
    timer.current = setTimeout(() => { timer.current = null; setRevealed(false); }, REVEAL_MS);
  };

  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === 'hidden') hide(); };
    const onBlur = () => hide();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('blur', onBlur);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const openForm = () => {
    hide();
    setForm(fromRow(d));
    setAck(false);
    setTouched({});
    setEditing(true);
  };

  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const bankDirty = JSON.stringify(form) !== JSON.stringify(fromRow(d)) || (ack && !d?.acknowledged_at);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if ((editing || !d) && bankDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [editing, d, bankDirty]);
  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!data) return <p className="text-sm text-muted-foreground">Bank details are for consultant accounts.</p>;

  const state = payoutCardState(d);
  const showForm = editing || !d;

  // Same rules as the server: a wrong value is shown next to its field while typing, a missing one after leaving the field.
  const errors = payoutFieldErrors(form);
  const valid = Object.keys(errors).length === 0;
  const errorOf = (k: PayoutField) => {
    const msg = errors[k];
    if (!msg) return undefined;
    const lengthRule = msg === PAYOUT_MESSAGES.names || msg === PAYOUT_MESSAGES.ibanOrAccount;
    return touched[k] || (!lengthRule && form[k].trim() !== '') ? msg : undefined;
  };
  const blur = (k: PayoutField) => () => setTouched((t0) => ({ ...t0, [k]: true }));
  const fieldProps = (k: PayoutField) => ({
    onBlur: blur(k), 'aria-invalid': !!errorOf(k), 'aria-describedby': errorOf(k) ? `pd-${k}-error` : undefined,
  });
  const fieldError = (k: PayoutField) => errorOf(k) ? <p id={`pd-${k}-error`} className="text-xs text-destructive">{errorOf(k)}</p> : null;

  const submit = () => {
    setSaveError(null);
    save.mutate(
      { ...form, acknowledged: ack, ackVersion: PAYOUT_DISCLAIMER_VERSION },
      { onSuccess: () => { setEditing(false); setAck(false); setSavedNow(true); }, onError: error => setSaveError(error instanceof Error ? error.message : t('profile_save.failed', 'Could not save changes. Try again.')) },
    );
  };

  const summary = (label: string, value?: string | null) => (
    <div className="flex justify-between gap-4 text-sm py-1.5 border-b border-border/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-end break-all">{value || '-'}</span>
    </div>
  );

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2 space-y-1">
        <div className="flex flex-row items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">Bank details for your payouts</CardTitle>
          <div className="ms-auto">
            {state === 'missing' ? <Badge variant="destructive" className="text-[10px]">Missing</Badge>
              : state === 'confirm' ? <Badge variant="outline" className="text-[10px]">Please confirm the disclaimer</Badge>
              : state === 'verified' ? <Badge className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Verified</Badge>
              : <Badge variant="secondary" className="text-[10px]">Waiting for verification</Badge>}
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5" /> Private: visible only to you and the platform administrators
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" className="text-xs text-muted-foreground">{save.isPending ? t('profile_save.saving', 'Saving...') : bankDirty && (editing || !d) ? t('profile_save.unsaved', 'Unsaved changes') : savedNow ? t('profile_save.just_now', 'Saved just now') : t('profile_save.all_saved', 'All changes saved')}</p>
        {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
        {!d && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Add your bank details so that the platform can transfer your payouts. Without them a payout can not be started.</span>
          </div>
        )}

        {!showForm && d && (
          <div className="space-y-3">
            <div>
              {summary('Account holder', d.account_holder)}
              {summary('Bank', d.bank_name)}
              {summary('IBAN', revealed ? d.iban : maskIban(d.iban))}
              {summary('Account number', revealed ? d.account_number : maskAccount(d.account_number))}
              {summary('SWIFT / BIC', d.swift_bic)}
              {summary('Country', d.country)}
              {summary('Currency', d.currency)}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {revealed ? (
                <Button variant="outline" size="sm" onClick={hide}><EyeOff className="w-4 h-4 me-1" /> Hide</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={reveal}><Eye className="w-4 h-4 me-1" /> Show full details</Button>
              )}
              <Button size="sm" onClick={openForm}><Pencil className="w-4 h-4 me-1" /> Edit details</Button>
            </div>
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {d.acknowledged_at && <p>Disclaimer accepted on {day(d.acknowledged_at)}</p>}
              {d.verified_at && <p>Verified on {day(d.verified_at)}</p>}
            </div>
          </div>
        )}

        {showForm && (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pd-holder" className="text-xs">Account holder *</Label>
                <Input id="pd-holder" autoComplete="off" value={form.account_holder} onChange={set('account_holder')} maxLength={120} {...fieldProps('account_holder')} />
                {fieldError('account_holder')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-bank" className="text-xs">Bank *</Label>
                <Input id="pd-bank" autoComplete="off" value={form.bank_name} onChange={set('bank_name')} maxLength={120} {...fieldProps('bank_name')} />
                {fieldError('bank_name')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-iban" className="text-xs">IBAN</Label>
                <Input id="pd-iban" autoComplete="off" value={form.iban} onChange={set('iban')} maxLength={42} {...fieldProps('iban')} />
                {fieldError('iban')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-acc" className="text-xs">Account number (if you have no IBAN)</Label>
                <Input id="pd-acc" autoComplete="off" value={form.account_number} onChange={set('account_number')} maxLength={40} {...fieldProps('account_number')} />
                {fieldError('account_number')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-swift" className="text-xs">SWIFT / BIC</Label>
                <Input id="pd-swift" autoComplete="off" value={form.swift_bic} onChange={set('swift_bic')} maxLength={11} {...fieldProps('swift_bic')} />
                {fieldError('swift_bic')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-country" className="text-xs">Country</Label>
                <Input id="pd-country" autoComplete="off" value={form.country} onChange={set('country')} maxLength={60} {...fieldProps('country')} />
                {fieldError('country')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-cur" className="text-xs">Currency of the account</Label>
                <Input id="pd-cur" autoComplete="off" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} className="w-28" {...fieldProps('currency')} />
                {fieldError('currency')}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-notes" className="text-xs">Notes for the administrator (optional)</Label>
              <Textarea id="pd-notes" value={form.notes} onChange={set('notes')} rows={2} maxLength={500} />
            </div>

            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Before you save, please read and confirm</p>
              <ol className="list-decimal ps-5 space-y-1.5 text-xs text-muted-foreground">
                {PAYOUT_DISCLAIMER_POINTS.map((p) => <li key={p}>{p}</li>)}
              </ol>
              <div className="flex items-start gap-2">
                <Checkbox id="pd-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} aria-required="true" />
                <Label htmlFor="pd-ack" className="text-xs leading-snug">I have read the disclaimer above and I acknowledge it</Label>
              </div>
              {!ack && valid && bankDirty && <p className="text-xs text-destructive">{PAYOUT_MESSAGES.ack}</p>}
            </div>

            <p className="text-xs text-muted-foreground">If you change any detail, the platform checks it again before your next payout.</p>

            <div className="flex justify-end gap-2">
              {d && <Button variant="outline" onClick={() => { setEditing(false); setAck(false); }}>Cancel</Button>}
              <Button disabled={!valid || !ack || !bankDirty || save.isPending} onClick={submit}>Save bank details</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
