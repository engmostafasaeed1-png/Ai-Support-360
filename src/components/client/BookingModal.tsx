import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Video, MessageSquare, Monitor, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface BookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantName: string;
  consultantId: string;
  rate: number;
  availableSlots: { time: string; duration: number; type: string }[];
}

const SESSION_TYPES = [
  { value: 'video', icon: Video, labelKey: 'consultant_profile.video_call' },
  { value: 'chat', icon: MessageSquare, labelKey: 'consultant_profile.live_chat' },
  { value: 'screen_share', icon: Monitor, labelKey: 'consultant_profile.screen_share' },
] as const;

const TIME_SLOTS = [
  '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'
];

export default function BookingModal({ open, onOpenChange, consultantName, rate, availableSlots }: BookingModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState('');
  const [sessionType, setSessionType] = useState('video');

  const reset = () => { setStep(1); setSelectedDate(undefined); setSelectedTime(''); setSessionType('video'); };

  const handleConfirm = () => {
    toast.success(t('booking.confirmed_title'), {
      description: t('booking.confirmed_desc', { name: consultantName }),
    });
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{t('booking.title')}</DialogTitle>
          <DialogDescription>{t('booking.subtitle', { name: consultantName })}</DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-2">
          {[1, 2, 3].map(s => (
            <div key={s} className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              s <= step ? 'bg-primary' : 'bg-muted'
            )} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-foreground">{t('booking.select_date')}</p>
            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => date < new Date()}
                className="pointer-events-auto rounded-xl border border-border/50"
              />
            </div>
            <div className="flex justify-end">
              <Button disabled={!selectedDate} onClick={() => setStep(2)} className="gradient-primary border-0">
                {t('booking.next')}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-foreground">{t('booking.select_time')}</p>
            <div className="grid grid-cols-3 gap-2">
              {TIME_SLOTS.map(time => (
                <button
                  key={time}
                  onClick={() => setSelectedTime(time)}
                  className={cn(
                    'p-3 rounded-xl border text-sm font-medium transition-colors',
                    selectedTime === time
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/50 text-foreground hover:border-primary/50'
                  )}
                >
                  <Clock className="w-3.5 h-3.5 mx-auto mb-1 text-muted-foreground" />
                  {time}
                </button>
              ))}
            </div>

            <p className="text-sm font-medium text-foreground mt-4">{t('booking.session_type')}</p>
            <RadioGroup value={sessionType} onValueChange={setSessionType} className="space-y-2">
              {SESSION_TYPES.map(({ value, icon: Icon, labelKey }) => (
                <Label
                  key={value}
                  htmlFor={`type-${value}`}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                    sessionType === value
                      ? 'border-primary bg-primary/5'
                      : 'border-border/50 hover:border-primary/30'
                  )}
                >
                  <RadioGroupItem value={value} id={`type-${value}`} />
                  <Icon className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium text-foreground">{t(labelKey)}</span>
                </Label>
              ))}
            </RadioGroup>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>{t('booking.back')}</Button>
              <Button disabled={!selectedTime} onClick={() => setStep(3)} className="gradient-primary border-0">
                {t('booking.next')}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-foreground">{t('booking.review')}</p>
            <div className="p-4 rounded-xl bg-muted/30 border border-border/30 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('booking.consultant')}</span>
                <span className="font-medium text-foreground">{consultantName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('booking.date')}</span>
                <span className="font-medium text-foreground">{selectedDate?.toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('booking.time')}</span>
                <span className="font-medium text-foreground">{selectedTime}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('booking.type')}</span>
                <Badge variant="secondary" className="text-xs">{sessionType}</Badge>
              </div>
              <div className="border-t border-border/30 pt-3 flex justify-between">
                <span className="text-muted-foreground">{t('booking.estimated_cost')}</span>
                <span className="font-bold text-foreground">${rate}/hr</span>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>{t('booking.back')}</Button>
              <Button onClick={handleConfirm} className="gradient-primary border-0">
                {t('booking.confirm')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
