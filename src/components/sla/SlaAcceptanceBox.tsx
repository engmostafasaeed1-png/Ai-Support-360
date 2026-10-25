import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSlaEnabled, useSlaTicketAction, useTicketSla } from '@/hooks/useSla';
import * as api from '@/lib/sla/api';
import { acceptanceSummary, RECIPIENTS, type Recipient } from '@/lib/sla/policy';
import { coverageText, langOf, slaErrorText } from './slaUi';

/**
 * "I accept the SLA of this ticket: S2 response 2 h, resolution 2 business days, escalations to ..." shown to the
 * consultant before accepting an assignment or sending a bid. Ticking stores the acceptance with the policy version
 * (the database refuses the accept / bid without it). `onReadyChange(true)` when nothing needs accepting.
 */
export default function SlaAcceptanceBox({ ticketId, context, onReadyChange }: {
  ticketId: string | null | undefined; context: 'assignment' | 'bid' | 'team'; onReadyChange?: (ready: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const on = useSlaEnabled();
  const { data, isLoading } = useTicketSla(ticketId);
  const accept = useSlaTicketAction(ticketId ?? '', (c: typeof context) => api.acceptSla(ticketId as string, c));
  const counter = useSlaTicketAction(ticketId ?? '', (a: { r: number; res: number; note: string }) => api.proposeCounter(ticketId as string, { response_min: a.r, resolution_min: a.res }, a.note));
  const [showCounter, setShowCounter] = useState(false);
  const [r, setR] = useState('');
  const [res, setRes] = useState('');
  const [note, setNote] = useState('');

  const snap = data?.snapshot;
  const needed = on && !!snap && !!data?.require_acceptance && (data.role === 'candidate' || data.role === 'consultant');
  const ready = !on || (!isLoading && (!needed || !!data?.accepted));
  useEffect(() => { onReadyChange?.(ready); }, [ready, onReadyChange]);
  if (!needed || !snap) return null;

  const labels = Object.fromEntries(RECIPIENTS.map((k) => [k, t(`sla.who.${k}`)])) as Record<Recipient, string>;
  const summary = acceptanceSummary(snap.data, lang, labels);

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs" data-testid="sla-acceptance">
      <p className="flex items-center gap-1.5 font-semibold text-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> {t('sla.accept.title')}</p>
      <p className="text-muted-foreground">{snap.policy_name} · v{snap.version} · {coverageText(t, snap.data.calendar)}</p>
      <label className="flex items-start gap-2">
        <Checkbox checked={!!data?.accepted} disabled={!!data?.accepted || accept.isPending}
          onCheckedChange={async (v) => {
            if (v !== true) return;
            try { await accept.mutateAsync(context); } catch (e) { toast.error(slaErrorText(t, e)); }
          }} aria-describedby="sla-accept-disclaimer" />
        <span className="text-foreground">{t('sla.accept.label', { summary })}</span>
      </label>
      <p id="sla-accept-disclaimer" className="text-[11px] leading-relaxed text-muted-foreground">{t('sla.accept.disclaimer')}</p>
      {data?.can.counter && !data.accepted && (
        showCounter ? (
          <div className="space-y-2 rounded-lg bg-background p-2">
            <p className="text-muted-foreground">{t('sla.accept.counterText')}</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="sla-c-r" className="text-[11px]">{t('sla.accept.responseHours')}</Label><Input id="sla-c-r" type="number" min={0.25} step={0.25} value={r} onChange={(e) => setR(e.target.value)} /></div>
              <div><Label htmlFor="sla-c-res" className="text-[11px]">{t('sla.accept.resolutionHours')}</Label><Input id="sla-c-res" type="number" min={1} step={1} value={res} onChange={(e) => setRes(e.target.value)} /></div>
            </div>
            <Textarea value={note} maxLength={500} rows={2} placeholder={t('sla.accept.counterNote')} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={counter.isPending || !(Number(r) > 0 && Number(res) > Number(r))} onClick={async () => {
                try {
                  await counter.mutateAsync({ r: Math.round(Number(r) * 60), res: Math.round(Number(res) * 60), note });
                  toast.success(t('sla.accept.counterSent')); setShowCounter(false);
                } catch (e) { toast.error(slaErrorText(t, e)); }
              }}>{t('sla.accept.counterSend')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCounter(false)}>{t('sla.action.cancel')}</Button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setShowCounter(true)}>{t('sla.accept.counterLink')}</button>
        )
      )}
    </div>
  );
}
