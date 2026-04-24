import { useCurrency, SUPPORTED_CURRENCIES } from '@/contexts/CurrencyContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

const labels: Record<string, string> = {
  USD: 'USD · US Dollar',
  EUR: 'EUR · Euro',
  GBP: 'GBP · British Pound',
  SAR: 'SAR · Saudi Riyal',
  AED: 'AED · UAE Dirham',
  CAD: 'CAD · Canadian Dollar',
  AUD: 'AUD · Australian Dollar',
  JPY: 'JPY · Japanese Yen',
  INR: 'INR · Indian Rupee',
  CHF: 'CHF · Swiss Franc',
};

interface CurrencySelectorProps {
  className?: string;
  showLabel?: boolean;
}

export function CurrencySelector({ className, showLabel = true }: CurrencySelectorProps) {
  const { preferred, setPreferred, ratesUpdatedAt, isLoading, isError } = useCurrency();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showLabel && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Coins className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Display in</span>
        </div>
      )}
      <Select value={preferred} onValueChange={(v) => setPreferred(v as any)}>
        <SelectTrigger className="h-8 w-[110px] rounded-xl text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_CURRENCIES.map((c) => (
            <SelectItem key={c} value={c} className="text-xs">
              {labels[c] ?? c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="hidden md:inline text-[10px] text-muted-foreground">
        {isLoading
          ? 'loading rates…'
          : isError
          ? 'rates unavailable'
          : ratesUpdatedAt
          ? `rates ${ratesUpdatedAt}`
          : ''}
      </span>
    </div>
  );
}
