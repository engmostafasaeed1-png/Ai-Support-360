import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface Props {
  version: number;
  submitLabel?: string;
  /** Saves the acknowledgement; a thrown error is shown under the button. */
  onAccept: (version: number) => Promise<void>;
  disabled?: boolean;
}

/** Required checkbox + submit. The button stays disabled until the box is ticked. */
export default function PolicyAcceptForm({ version, submitLabel, onAccept, disabled }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!checked || busy) return;
    setBusy(true); setError(null);
    try { await onAccept(version); }
    catch (e) { setError((e as { message?: string })?.message || t('common.error', 'Something went wrong. Please try again.')); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
        <Checkbox id={`${id}-accept`} checked={checked} onCheckedChange={v => { setChecked(v === true); setError(null); }} disabled={disabled || busy} aria-required="true" className="mt-0.5" />
        <label htmlFor={`${id}-accept`} className="text-sm leading-6 text-foreground">
          {t('consultantPolicy.checkbox', 'I have read and accept the Consultant Service Policy (version {{v}})', { v: version })}
        </label>
      </div>
      <Button type="button" onClick={submit} disabled={!checked || busy || disabled} className="w-full gap-2 gradient-primary text-primary-foreground sm:w-auto" aria-describedby={!checked ? `${id}-hint` : undefined}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        {submitLabel || t('consultantPolicy.confirm', 'Confirm')}
      </Button>
      {!checked && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{t('consultantPolicy.tickFirst', 'Tick the box to continue.')}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
