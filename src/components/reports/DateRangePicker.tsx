import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DateRangePickerProps {
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<{ from: Date; to: Date }>({ from, to });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5">
          <CalendarIcon className="w-3.5 h-3.5" />
          {format(from, 'MMM d')} – {format(to, 'MMM d, yyyy')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="range"
          selected={{ from: range.from, to: range.to }}
          onSelect={(r: any) => {
            if (r?.from && r?.to) {
              setRange({ from: r.from, to: r.to });
              onChange(r.from, r.to);
              setOpen(false);
            } else if (r?.from) {
              setRange({ from: r.from, to: range.to });
            }
          }}
          numberOfMonths={2}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
