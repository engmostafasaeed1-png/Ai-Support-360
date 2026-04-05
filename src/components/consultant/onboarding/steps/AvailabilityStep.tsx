import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OnboardingData } from '../ConsultantOnboarding';

const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const timeSlots = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

export default function AvailabilityStep({ data, onChange }: Props) {
  const { t } = useTranslation();

  const addSlot = () => {
    onChange({
      availability: [...data.availability, { dayOfWeek: 0, startTime: '09:00', endTime: '17:00' }],
    });
  };

  const updateSlot = (idx: number, partial: Partial<OnboardingData['availability'][0]>) => {
    const updated = data.availability.map((s, i) => (i === idx ? { ...s, ...partial } : s));
    onChange({ availability: updated });
  };

  const removeSlot = (idx: number) => {
    onChange({ availability: data.availability.filter((_, i) => i !== idx) });
  };

  // Quick toggle: add/remove all slots for a day
  const toggleDay = (day: number) => {
    const hasDay = data.availability.some(s => s.dayOfWeek === day);
    if (hasDay) {
      onChange({ availability: data.availability.filter(s => s.dayOfWeek !== day) });
    } else {
      onChange({ availability: [...data.availability, { dayOfWeek: day, startTime: '09:00', endTime: '17:00' }] });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold">{t('onboarding.availability')}</h3>
        <p className="text-xs text-muted-foreground">{t('onboarding.availability_desc')}</p>
      </div>

      {/* Quick day toggles */}
      <div className="flex flex-wrap gap-2">
        {dayKeys.map((key, idx) => {
          const active = data.availability.some(s => s.dayOfWeek === idx);
          return (
            <button
              key={key}
              onClick={() => toggleDay(idx)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-primary/50'
              )}
            >
              {t(`onboarding.day_${key}`)}
            </button>
          );
        })}
      </div>

      {data.availability.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">{t('onboarding.no_availability')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('onboarding.availability_optional')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.availability.map((slot, idx) => (
            <Card key={idx} className="p-3 flex items-center gap-3">
              <div className="flex-1 grid grid-cols-3 gap-2 items-center">
                <Select
                  value={String(slot.dayOfWeek)}
                  onValueChange={v => updateSlot(idx, { dayOfWeek: Number(v) })}
                >
                  <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dayKeys.map((key, i) => (
                      <SelectItem key={i} value={String(i)}>{t(`onboarding.day_${key}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={slot.startTime} onValueChange={v => updateSlot(idx, { startTime: v })}>
                  <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {timeSlots.map(ts => (
                      <SelectItem key={ts} value={ts}>{ts}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={slot.endTime} onValueChange={v => updateSlot(idx, { endTime: v })}>
                  <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {timeSlots.map(ts => (
                      <SelectItem key={ts} value={ts}>{ts}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeSlot(idx)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </Card>
          ))}
          <Button variant="outline" size="sm" onClick={addSlot} className="gap-1.5 w-full">
            <Plus className="w-3.5 h-3.5" />
            {t('onboarding.add_slot')}
          </Button>
        </div>
      )}
    </div>
  );
}
