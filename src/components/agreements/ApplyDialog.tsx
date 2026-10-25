import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as api from '@/lib/agreements/api';
import { rateBounds, saErrorCode, type SaModel, type SaSettings, type SaTerms } from '@/lib/agreements/model';
import { money, ProtectionBox } from './AgreementBits';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agreementId: string;
  name: string;
  modules: string[];
  model: SaModel;
  sla: SaTerms['sla'] | null | undefined;
  settings: SaSettings;
  existing?: api.SaApplication | null;
  onDone: () => void;
}

/** Consultant: apply (or update the application) with a rate inside the platform bounds and the exact SLA accepted. */
export default function ApplyDialog({ open, onOpenChange, agreementId, name, modules, model, sla, settings, existing, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const bounds = rateBounds(settings, modules);
  const [rate, setRate] = useState<number>(existing?.hourly_rate ?? 0);
  const [currency, setCurrency] = useState(existing?.currency ?? 'USD');
  const [m, setM] = useState<SaModel>(existing?.model ?? model);
  const [capacity, setCapacity] = useState<number | null>(existing?.capacity_hours_per_week ?? null);
  const [availability, setAvailability] = useState(existing?.availability_note ?? '');
  const [message, setMessage] = useState(existing?.message ?? '');
  const [slaOk, setSlaOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const rateBad = !(rate >= bounds.min && rate <= bounds.max);

  const submit = async () => {
    setBusy(true);
    try {
      await api.apply(agreementId, { rate, currency, model: m, capacity: m === 'availability' ? capacity : null, availability, slaAccepted: slaOk, message });
      toast.success(t('agreements.apply.sent'));
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') }));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{t('agreements.apply.title', { name })}</DialogTitle><DialogDescription>{t('agreements.apply.text')}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-1.5"><Label htmlFor="ap-rate">{t('agreements.apply.rate')}</Label>
              <Input id="ap-rate" type="number" min={bounds.min} max={bounds.max} step={0.5} value={rate || ''} onChange={(e) => setRate(Number(e.target.value))} aria-invalid={rateBad} aria-describedby="ap-rate-hint" />
              <p id="ap-rate-hint" className={`text-xs ${rateBad && rate ? 'text-destructive' : 'text-muted-foreground'}`}>{t('agreements.apply.bounds', { min: money(bounds.min, currency, lang), max: money(bounds.max, currency, lang) })}</p></div>
            <div className="space-y-1.5"><Label htmlFor="ap-cur">{t('agreements.f.currency')}</Label>
              <Input id="ap-cur" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
          </div>
          <div className="space-y-1.5"><Label>{t('agreements.f.model')}</Label>
            <Select value={m} onValueChange={(v) => setM(v as SaModel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{settings.models_enabled.map((x) => <SelectItem key={x} value={x}>{t(`agreements.model.${x}`)}</SelectItem>)}</SelectContent>
            </Select></div>
          {m === 'availability' && (
            <div className="space-y-1.5"><Label htmlFor="ap-cap">{t('agreements.f.capacity')}</Label>
              <Input id="ap-cap" type="number" min={0.5} max={60} step={0.5} value={capacity ?? ''} onChange={(e) => setCapacity(e.target.value ? Number(e.target.value) : null)} /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="ap-av">{t('agreements.apply.availability')}</Label>
            <Input id="ap-av" maxLength={500} value={availability} onChange={(e) => setAvailability(e.target.value)} placeholder={t('agreements.apply.availabilityPh')} /></div>
          <div className="space-y-1.5"><Label htmlFor="ap-msg">{t('agreements.apply.message')}</Label>
            <Textarea id="ap-msg" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('agreements.form.contactHint')}</p></div>
          <div className="rounded-xl border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{t('agreements.apply.slaTitle')}</p>
            <p className="mt-1 text-muted-foreground">{sla?.summary || t('agreements.f.slaDefault')}</p>
            <label className="mt-2 flex items-start gap-2"><Checkbox checked={slaOk} onCheckedChange={(v) => setSlaOk(!!v)} className="mt-0.5" /> <span>{t('agreements.apply.slaAccept')}</span></label>
          </div>
          <ProtectionBox compact />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('agreements.cancel')}</Button>
          <Button busy={busy} disabled={!slaOk || rateBad || !/^[A-Z]{3}$/.test(currency)} onClick={submit}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{existing ? t('agreements.apply.update') : t('agreements.apply.send')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
