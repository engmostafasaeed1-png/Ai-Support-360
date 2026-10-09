import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import PriceBreakdown from '@/components/pricing/PriceBreakdown';
import { priceBreakdown } from '@/lib/pricing';
import { usePaymentSettings, useSavePaymentSetting, useSavePricing } from '@/hooks/useBilling';

const parse = (text: string): number | null => {
  if (text.trim() === '') return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const inRange = (n: number | null): boolean => n !== null && n >= 0 && n <= 30;

/** The price of consultant work: the platform service fee, the payment processing fee and the VAT, all added on top of the fee that the consultant earns. */
export default function PricingSettingsCard() {
  const settingsQ = usePaymentSettings();
  const savePricing = useSavePricing();
  const savePlans = useSavePaymentSetting();
  const [service, setService] = useState('');
  const [processing, setProcessing] = useState('');
  const [vat, setVat] = useState('');

  useEffect(() => {
    const s = settingsQ.data;
    if (!s) return;
    setService(s.serviceFee === null ? '' : String(s.serviceFee));
    setProcessing(s.processingFee === null ? '' : String(s.processingFee));
    setVat(s.vat === null ? '' : String(s.vat));
  }, [settingsQ.data]);

  if (settingsQ.isLoading) return <Skeleton className="h-64 rounded-2xl" />;

  const serviceN = parse(service);
  const processingN = parse(processing);
  const vatN = parse(vat);
  const valid = inRange(serviceN) && inRange(processingN) && inRange(vatN);
  const example = valid ? priceBreakdown(100, { serviceFeePercent: serviceN as number, processingFeePercent: processingN as number, vatPercent: vatN as number }) : null;
  const saved = settingsQ.data;
  const unchanged = !!saved && serviceN === saved.serviceFee && processingN === saved.processingFee && vatN === saved.vat;

  return (
    <Card className="rounded-2xl border-border/50" data-testid="pricing-settings">
      <CardHeader className="pb-2"><CardTitle className="text-base">Price of consultant work</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          When a client approves a timesheet, the invoice is: the consultant fee (approved hours x the hourly rate that the client approved) + the platform service fee + the payment
          processing fee, plus VAT on all of it. The consultant is paid the whole fee. The service fee is the income of the portal; the processing fee pays the card provider.
          A change applies to the timesheets that are approved from now on. Invoices that exist keep their numbers.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pricing-service" className="text-xs">Platform service fee (%)</Label>
            <Input id="pricing-service" type="number" step="0.5" min="0" max="30" value={service} onChange={(e) => setService(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pricing-processing" className="text-xs">Payment processing fee (%)</Label>
            <Input id="pricing-processing" type="number" step="0.5" min="0" max="30" value={processing} onChange={(e) => setProcessing(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pricing-vat" className="text-xs">VAT (%)</Label>
            <Input id="pricing-vat" type="number" step="0.5" min="0" max="30" value={vat} onChange={(e) => setVat(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!valid || unchanged || savePricing.isPending}
            onClick={() => savePricing.mutate({ service: serviceN as number, processing: processingN as number, vat: vatN as number })}
          >
            {savePricing.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
            Save pricing
          </Button>
          {!valid && <span className="text-xs text-destructive">Each percentage must be a number from 0 to 30.</span>}
        </div>
        {example && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Example: a consultant fee of 100.00 USD</p>
            <PriceBreakdown breakdown={example} currency="USD" />
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-border/40 pt-3">
          <div>
            <p className="text-sm font-medium">Subscription plans</p>
            <p className="text-xs text-muted-foreground">
              Off: clients pay only for approved timesheets and the plan checkout is hidden. Nothing is deleted; switch it on to offer the plans again.
            </p>
          </div>
          <Switch
            checked={saved?.plans === true}
            disabled={savePlans.isPending}
            onCheckedChange={(on) => savePlans.mutate({ key: 'subscription_plans_enabled', value: on })}
            aria-label="Offer subscription plans"
          />
        </div>
      </CardContent>
    </Card>
  );
}
