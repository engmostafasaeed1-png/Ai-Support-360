import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowDownToLine, CreditCard, Building2, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PayoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: number;
  consultantId: string | null;
}

const METHODS = [
  { value: 'bank_transfer', icon: Building2, labelKey: 'payout.bank_transfer' },
  { value: 'paypal', icon: Wallet, labelKey: 'payout.paypal' },
  { value: 'stripe', icon: CreditCard, labelKey: 'payout.stripe' },
] as const;

export default function PayoutModal({ open, onOpenChange, available, consultantId }: PayoutModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const numAmount = parseFloat(amount) || 0;
  const isValid = numAmount > 0 && numAmount <= available && !!consultantId;

  const reset = () => { setAmount(''); setMethod('bank_transfer'); };

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('payouts').insert({
        consultant_id: consultantId!,
        amount: numAmount,
        payout_method: method,
        status: 'pending',
        currency: 'USD',
      });
      if (error) throw error;

      toast.success(t('payout.success_title'), {
        description: t('payout.success_desc', { amount: numAmount.toLocaleString() }),
      });
      queryClient.invalidateQueries({ queryKey: ['consultant-earnings'] });
      onOpenChange(false);
      reset();
    } catch (err: any) {
      toast.error(t('payout.error'), { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <ArrowDownToLine className="w-5 h-5 text-primary" />
            {t('payout.title')}
          </DialogTitle>
          <DialogDescription>{t('payout.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Available balance */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border/30 text-center">
            <p className="text-xs text-muted-foreground">{t('payout.available_balance')}</p>
            <p className="text-2xl font-bold text-foreground mt-1">${available.toLocaleString()}</p>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="payout-amount">{t('payout.amount_label')}</Label>
            <div className="relative">
              <span className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="payout-amount"
                type="number"
                min="1"
                max={available}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="ps-7"
                placeholder="0.00"
              />
            </div>
            <div className="flex gap-2">
              {[25, 50, 75, 100].map(pct => (
                <Button
                  key={pct}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setAmount((available * pct / 100).toFixed(2))}
                >
                  {pct}%
                </Button>
              ))}
            </div>
            {numAmount > available && (
              <p className="text-xs text-destructive">{t('payout.exceeds')}</p>
            )}
          </div>

          {/* Method */}
          <div className="space-y-2">
            <Label>{t('payout.method_label')}</Label>
            <RadioGroup value={method} onValueChange={setMethod} className="space-y-2">
              {METHODS.map(({ value, icon: Icon, labelKey }) => (
                <Label
                  key={value}
                  htmlFor={`method-${value}`}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                    method === value ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/30'
                  )}
                >
                  <RadioGroupItem value={value} id={`method-${value}`} />
                  <Icon className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium text-foreground">{t(labelKey)}</span>
                </Label>
              ))}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('payout.cancel')}</Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            className="gradient-primary border-0"
          >
            {isSubmitting ? t('payout.submitting') : t('payout.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
