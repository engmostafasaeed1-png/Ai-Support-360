import { useState, useEffect, useMemo } from 'react';
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
import { Video, MessageSquare, Monitor, Clock, Loader2, CalendarDays, CheckCircle2, Zap, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface BookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantName: string;
  consultantId: string;
  rate: number;
  availableSlots?: { time: string; duration: number; type: string }[];
}

interface AvailabilitySlot {
  id: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  is_recurring: boolean | null;
  specific_date: string | null;
}

const SESSION_TYPES = [
  { value: 'video', icon: Video, labelKey: 'consultant_profile.video_call' },
  { value: 'chat', icon: MessageSquare, labelKey: 'consultant_profile.live_chat' },
  { value: 'screen_share', icon: Monitor, labelKey: 'consultant_profile.screen_share' },
] as const;

const VIDEO_PLATFORMS = [
  { value: 'jitsi', label: 'Jitsi Meet (Free)', description: 'Instant video call, no account needed' },
  { value: 'zoom', label: 'Zoom', description: 'Zoom meeting link' },
  { value: 'google_meet', label: 'Google Meet', description: 'Google Meet video call' },
  { value: 'ms_teams', label: 'Microsoft Teams', description: 'Microsoft Teams meeting' },
] as const;

function generateMeetingUrl(platform: string, sessionId: string): string {
  const roomName = `qurtuba-session-${sessionId.slice(0, 8)}`;
  switch (platform) {
    case 'jitsi':
      return `https://meet.jit.si/${roomName}`;
    case 'zoom':
      // Placeholder — real Zoom links require API integration
      return `https://zoom.us/j/${roomName}`;
    case 'google_meet':
      // Placeholder — real Meet links require Calendar API
      return `https://meet.google.com/${roomName}`;
    case 'ms_teams':
      // Placeholder — real Teams links require Graph API
      return `https://teams.microsoft.com/l/meetup-join/${roomName}`;
    default:
      return `https://meet.jit.si/${roomName}`;
  }
}

const FALLBACK_SLOTS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

const DAY_MAP: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

export default function BookingModal({ open, onOpenChange, consultantName, consultantId, rate }: BookingModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [bookingMode, setBookingMode] = useState<'instant' | 'scheduled'>('scheduled');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState('');
  const [sessionType, setSessionType] = useState('video');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [videoPlatform, setVideoPlatform] = useState('jitsi');
  const [meetingUrl, setMeetingUrl] = useState('');

  // Fetch availability slots from database
  useEffect(() => {
    if (!open || !consultantId) return;
    const fetchSlots = async () => {
      setLoadingSlots(true);
      try {
        const { data, error } = await supabase
          .from('availability_slots')
          .select('id, day_of_week, start_time, end_time, is_recurring, specific_date')
          .eq('consultant_id', consultantId);

        if (error) throw error;
        setSlots(data || []);
      } catch (err) {
        console.error('Failed to fetch availability:', err);
      } finally {
        setLoadingSlots(false);
      }
    };
    fetchSlots();
  }, [open, consultantId]);

  // Compute available time slots for selected date
  const timeSlotsForDate = useMemo(() => {
    if (!selectedDate) return [];

    const dayOfWeek = selectedDate.getDay();
    const dateStr = format(selectedDate, 'yyyy-MM-dd');

    // Find matching slots
    const matching = slots.filter(s => {
      if (s.specific_date === dateStr) return true;
      if (s.is_recurring && s.day_of_week === dayOfWeek) return true;
      return false;
    });

    if (matching.length === 0) {
      // Return fallback slots if no availability data exists
      return slots.length === 0 ? FALLBACK_SLOTS : [];
    }

    // Generate hourly time slots from each matching range
    const timeSet = new Set<string>();
    matching.forEach(s => {
      const startHour = parseInt(s.start_time.split(':')[0], 10);
      const endHour = parseInt(s.end_time.split(':')[0], 10);
      for (let h = startHour; h < endHour; h++) {
        timeSet.add(`${String(h).padStart(2, '0')}:00`);
      }
    });

    return Array.from(timeSet).sort();
  }, [selectedDate, slots]);

  // Check if a date has available slots
  const dateHasSlots = (date: Date) => {
    if (slots.length === 0) return true; // No data = assume all available
    const dayOfWeek = date.getDay();
    const dateStr = format(date, 'yyyy-MM-dd');
    return slots.some(s =>
      (s.specific_date === dateStr) ||
      (s.is_recurring && s.day_of_week === dayOfWeek)
    );
  };

  const reset = () => {
    setStep(1);
    setSelectedDate(undefined);
    setSelectedTime('');
    setSessionType('video');
    setVideoPlatform('jitsi');
    setMeetingUrl('');
    setConfirmed(false);
  };

  const isValidUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error(t('booking.login_required'));
        setIsSubmitting(false);
        return;
      }

      const [hours, minutes] = selectedTime.split(':').map(Number);
      const scheduledAt = new Date(selectedDate!);
      scheduledAt.setHours(hours, minutes, 0, 0);
      const dateLabel = format(selectedDate!, 'MMM d, yyyy');

      const sessionId = crypto.randomUUID();
      const realConsultantId = isValidUUID(consultantId) ? consultantId : null;
      const generatedMeetingUrl = sessionType === 'video' ? generateMeetingUrl(videoPlatform, sessionId) : null;

      const { error } = await supabase.from('sessions').insert({
        id: sessionId,
        client_id: user.id,
        consultant_id: realConsultantId,
        session_type: sessionType as 'chat' | 'video' | 'screen_share',
        scheduled_at: scheduledAt.toISOString(),
        status: 'scheduled',
        duration_minutes: 60,
        meeting_url: generatedMeetingUrl,
        video_platform: sessionType === 'video' ? videoPlatform : null,
      } as any);

      if (error) throw error;
      if (generatedMeetingUrl) setMeetingUrl(generatedMeetingUrl);

      // Notify client
      await supabase.from('notifications').insert({
        user_id: user.id,
        title: 'Session Booked',
        body: `Your ${sessionType.replace('_', ' ')} session with ${consultantName} is scheduled for ${dateLabel} at ${selectedTime}.`,
        type: 'booking',
        link: '/client/sessions',
      });

      // Notify consultant if real
      if (realConsultantId) {
        const { data: consultant } = await supabase
          .from('consultants')
          .select('user_id')
          .eq('id', realConsultantId)
          .single();

        if (consultant) {
          await supabase.from('notifications').insert({
            user_id: consultant.user_id,
            title: 'New Session Booking',
            body: `A client booked a ${sessionType.replace('_', ' ')} session for ${dateLabel} at ${selectedTime}.`,
            type: 'booking',
            link: '/consultant/calendar',
          });
        }
      }

      setConfirmed(true);
      toast.success(t('booking.confirmed_title'), {
        description: t('booking.confirmed_desc', { name: consultantName }),
      });
    } catch (err: any) {
      toast.error(t('booking.error'), { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{confirmed ? '🎉 ' : ''}{t('booking.title')}</DialogTitle>
          <DialogDescription>{t('booking.subtitle', { name: consultantName })}</DialogDescription>
        </DialogHeader>

        {/* Confirmation Screen */}
        {confirmed ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Session Booked!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {sessionType === 'video' ? 'Video call' : sessionType === 'chat' ? 'Chat session' : 'Screen share'} with <span className="font-medium text-foreground">{consultantName}</span>
              </p>
            </div>
            <div className="p-3 rounded-xl bg-muted/30 border border-border/30 text-sm space-y-1.5 text-start">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">{selectedDate && format(selectedDate, 'EEEE, MMM d, yyyy')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time</span>
                <span className="font-medium">{selectedTime}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">60 min</span>
              </div>
            </div>
            {meetingUrl && sessionType === 'video' && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => window.open(meetingUrl, '_blank')}
              >
                <Video className="w-4 h-4" />
                Open Video Call
              </Button>
            )}
            <Button className="gradient-primary border-0 w-full" onClick={() => { onOpenChange(false); reset(); }}>
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* Step indicators */}
            <div className="flex items-center gap-2 mb-2">
              {[1, 2, 3].map(s => (
                <div key={s} className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  s <= step ? 'bg-primary' : 'bg-muted'
                )} />
              ))}
            </div>

            {/* Step 1: Date */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-foreground">{t('booking.select_date')}</p>
                {loadingSlots ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex justify-center">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => { setSelectedDate(d); setSelectedTime(''); }}
                      disabled={(date) => {
                        if (date < new Date()) return true;
                        return !dateHasSlots(date);
                      }}
                      className="pointer-events-auto rounded-xl border border-border/50"
                    />
                  </div>
                )}
                {selectedDate && slots.length > 0 && (
                  <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    {timeSlotsForDate.length} time slot{timeSlotsForDate.length !== 1 ? 's' : ''} available on {format(selectedDate, 'MMM d')}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button disabled={!selectedDate} onClick={() => setStep(2)} className="gradient-primary border-0">
                    {t('booking.next')}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Time + Session type */}
            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-foreground">{t('booking.select_time')}</p>

                {timeSlotsForDate.length === 0 ? (
                  <div className="py-6 text-center">
                    <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No available time slots for this date</p>
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => setStep(1)}>Choose another date</Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {timeSlotsForDate.map(time => (
                      <button
                        key={time}
                        onClick={() => setSelectedTime(time)}
                        className={cn(
                          'p-2.5 rounded-xl border text-sm font-medium transition-all',
                          selectedTime === time
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border/50 text-foreground hover:border-primary/50'
                        )}
                      >
                        <Clock className="w-3 h-3 mx-auto mb-0.5 text-muted-foreground" />
                        {time}
                      </button>
                    ))}
                  </div>
                )}

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

                {sessionType === 'video' && (
                  <>
                    <p className="text-sm font-medium text-foreground mt-4">Video Platform</p>
                    <RadioGroup value={videoPlatform} onValueChange={setVideoPlatform} className="space-y-2">
                      {VIDEO_PLATFORMS.map(({ value, label, description }) => (
                        <Label
                          key={value}
                          htmlFor={`platform-${value}`}
                          className={cn(
                            'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                            videoPlatform === value
                              ? 'border-primary bg-primary/5'
                              : 'border-border/50 hover:border-primary/30'
                          )}
                        >
                          <RadioGroupItem value={value} id={`platform-${value}`} />
                          <div>
                            <span className="text-sm font-medium text-foreground">{label}</span>
                            <p className="text-xs text-muted-foreground">{description}</p>
                          </div>
                        </Label>
                      ))}
                    </RadioGroup>
                  </>
                )}

                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(1)}>{t('booking.back')}</Button>
                  <Button disabled={!selectedTime} onClick={() => setStep(3)} className="gradient-primary border-0">
                    {t('booking.next')}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Review */}
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
                    <span className="font-medium text-foreground">{selectedDate && format(selectedDate, 'EEEE, MMM d, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('booking.time')}</span>
                    <span className="font-medium text-foreground">{selectedTime}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('booking.type')}</span>
                    <Badge variant="secondary" className="text-xs capitalize">{sessionType.replace('_', ' ')}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration</span>
                    <span className="font-medium text-foreground">60 min</span>
                  </div>
                  <div className="border-t border-border/30 pt-3 flex justify-between">
                    <span className="text-muted-foreground">{t('booking.estimated_cost')}</span>
                    <span className="font-bold text-foreground">${rate}/hr</span>
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="ghost" onClick={() => setStep(2)}>{t('booking.back')}</Button>
                  <Button onClick={handleConfirm} disabled={isSubmitting} className="gradient-primary border-0">
                    {isSubmitting ? (
                      <><Loader2 className="w-4 h-4 animate-spin me-1" /> {t('booking.submitting')}</>
                    ) : (
                      t('booking.confirm')
                    )}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
