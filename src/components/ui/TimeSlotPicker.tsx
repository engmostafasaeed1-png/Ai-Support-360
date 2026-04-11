import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format, setHours, setMinutes, isBefore, startOfDay } from 'date-fns';
import { CalendarDays, Clock, X, Plus } from 'lucide-react';

export interface ProposedSlot {
  date: Date;
  startTime: string;
  endTime: string;
}

interface Props {
  slots: ProposedSlot[];
  onChange: (slots: ProposedSlot[]) => void;
  maxSlots?: number;
}

const TIMES = Array.from({ length: 28 }, (_, i) => {
  const hour = Math.floor(i / 2) + 8;
  const min = (i % 2) * 30;
  const val = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
  const label = format(setMinutes(setHours(new Date(), hour), min), 'h:mm a');
  return { value: val, label };
}).filter(s => {
  const [h] = s.value.split(':').map(Number);
  return h < 22;
});

export default function TimeSlotPicker({ slots, onChange, maxSlots = 5 }: Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');

  const addSlot = () => {
    if (!selectedDate) return;
    if (slots.length >= maxSlots) return;

    const newSlot: ProposedSlot = {
      date: selectedDate,
      startTime,
      endTime,
    };
    onChange([...slots, newSlot]);
    setSelectedDate(undefined);
    setPickerOpen(false);
  };

  const removeSlot = (index: number) => {
    onChange(slots.filter((_, i) => i !== index));
  };

  const getTimeLabel = (val: string) => TIMES.find(t => t.value === val)?.label || val;

  return (
    <div className="space-y-3">
      <Label className="text-xs font-medium flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        {t('interview.proposed_times', 'Proposed Time Slots')}
      </Label>

      {slots.length > 0 && (
        <div className="space-y-1.5">
          {slots.map((slot, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/10"
            >
              <CalendarDays className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium">
                {format(slot.date, 'EEE, MMM d')}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {getTimeLabel(slot.startTime)} – {getTimeLabel(slot.endTime)}
              </Badge>
              <button
                type="button"
                onClick={() => removeSlot(i)}
                className="ms-auto text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {slots.length < maxSlots && (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs border-dashed"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('interview.add_time_slot', 'Add Time Slot')}
              {slots.length > 0 && (
                <span className="text-muted-foreground">
                  ({slots.length}/{maxSlots})
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start" side="top">
            <div className="p-3 space-y-3">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => isBefore(date, startOfDay(new Date()))}
                className={cn('p-0 pointer-events-auto')}
              />

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">From</Label>
                  <ScrollArea className="h-28 rounded-lg border border-border/50">
                    <div className="p-1 space-y-0.5">
                      {TIMES.map(t => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => {
                            setStartTime(t.value);
                            // auto adjust end time
                            const idx = TIMES.findIndex(x => x.value === t.value);
                            if (idx < TIMES.length - 2) setEndTime(TIMES[idx + 2].value);
                          }}
                          className={cn(
                            'w-full text-left px-2 py-1 rounded text-xs transition-colors',
                            startTime === t.value
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">To</Label>
                  <ScrollArea className="h-28 rounded-lg border border-border/50">
                    <div className="p-1 space-y-0.5">
                      {TIMES.filter(t => t.value > startTime).map(t => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setEndTime(t.value)}
                          className={cn(
                            'w-full text-left px-2 py-1 rounded text-xs transition-colors',
                            endTime === t.value
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              <Button
                size="sm"
                className="w-full text-xs"
                disabled={!selectedDate}
                onClick={addSlot}
              >
                {t('interview.confirm_slot', 'Add This Slot')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      <p className="text-[10px] text-muted-foreground">
        {t('interview.slot_hint', 'Propose up to {{max}} preferred time slots. Admin will confirm the final schedule.', { max: maxSlots })}
      </p>
    </div>
  );
}
