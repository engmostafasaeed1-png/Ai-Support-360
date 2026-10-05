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
import { Video, MessageSquare, Monitor, Clock, Loader2, CalendarDays, CheckCircle2, Zap, CalendarClock, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { openExternal } from '@/lib/safeUrl';
import {
  downloadLiveInterviewIcs, googleCalendarUrl, outlookCalendarUrl, type LiveInterviewEvent,
} from '@/lib/liveInterviewCalendar';

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

/** Free Jitsi Meet room, unique per session. */
function generateMeetingUrl(sessionId: string): string {
  return `https://meet.jit.si/aisupportnow-${sessionId.replace(/-/g, '')}`;
}

const isValidUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

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
  const [meetingUrl, setMeetingUrl] = useState('');
  const [booked, setBooked] = useState<[number, number][]>([]);
  const [calendarEvent, setCalendarEvent] = useState<LiveInterviewEvent | null>(null);

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

  // Times already booked with this consultant on the selected date
  useEffect(() => {
    if (!selectedDate || !isValidUUID(consultantId)) { setBooked([]); return; }
    const from = new Date(selectedDate); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    supabase.rpc('consultant_booked_times', {
      _consultant_id: consultantId, _from: from.toISOString(), _to: to.toISOString(),
    }).then(({ data }) => {
      setBooked((data || []).map((b: any) => {
        const s = new Date(b.scheduled_at).getTime();
        return [s, s + (b.duration_minutes || 60) * 60_000] as [number, number];
      }));
    });
  }, [selectedDate, consultantId]);

  // Compute available time slots for selected date
  const timeSlotsForDate = useMemo(() => {
    if (!selectedDate) return [];

    const dayOfWeek = selectedDate.getDay();
    const dateStr = format(selectedDate, 'yyyy-MM-dd');

    const matching = slots.filter(s => {
      if (s.specific_date === dateStr) return true;
      if ((s.is_recurring ?? true) && s.day_of_week === dayOfWeek && !s.specific_date) return true;
      return false;
    });

    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const timeSet = new Set<string>();
    const now = Date.now();
    matching.forEach(s => {
      for (let m = toMin(s.start_time); m + 60 <= toMin(s.end_time); m += 60) {
        const start = new Date(selectedDate); start.setHours(Math.floor(m / 60), m % 60, 0, 0);
        const st = start.getTime(), en = st + 60 * 60_000;
        if (st <= now) continue;
        if (booked.some(([bs, be]) => st < be && en > bs)) continue;
        timeSet.add(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      }
    });

    return Array.from(timeSet).sort();
  }, [selectedDate, slots, booked]);

  // Check if a date has available slots
  const dateHasSlots = (date: Date) => {
    const dayOfWeek = date.getDay();
    const dateStr = format(date, 'yyyy-MM-dd');
    return slots.some(s =>
      (s.specific_date === dateStr) ||
      ((s.is_recurring ?? true) && s.day_of_week === dayOfWeek && !s.specific_date)
    );
  };

  const reset = () => {
    setStep(0);
    setBookingMode('scheduled');
    setSelectedDate(undefined);
    setSelectedTime('');
    setSessionType('video');
    setMeetingUrl('');
    setCalendarEvent(null);
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

      let scheduledAt: Date;
      let timeLabel: string;
      if (bookingMode === 'instant') {
        // Round up to next 5 minutes for a clean start time
        scheduledAt = new Date();
        const ms = 5 * 60 * 1000;
        scheduledAt = new Date(Math.ceil(scheduledAt.getTime() / ms) * ms);
        timeLabel = format(scheduledAt, 'HH:mm');
      } else {
        const [hours, minutes] = selectedTime.split(':').map(Number);
        scheduledAt = new Date(selectedDate!);
        scheduledAt.setHours(hours, minutes, 0, 0);
        timeLabel = selectedTime;
      }
      void timeLabel;

      const sessionId = crypto.randomUUID();
      const realConsultantId = isValidUUID(consultantId) ? consultantId : null;
      const generatedMeetingUrl = sessionType === 'video' ? generateMeetingUrl(sessionId) : null;

      const { error } = await supabase.from('sessions').insert({
        id: sessionId,
        client_id: user.id,
        consultant_id: realConsultantId,
        session_type: sessionType as 'chat' | 'video' | 'screen_share',
        scheduled_at: scheduledAt.toISOString(),
        status: 'scheduled',
        duration_minutes: 60,
        meeting_url: generatedMeetingUrl,
        video_platform: sessionType === 'video' ? 'jitsi' : null,
      } as any);

      if (error) throw error;
      if (generatedMeetingUrl) setMeetingUrl(generatedMeetingUrl);
      const roomUrl = `${window.location.origin}/client/sessions/${sessionId}`;
      setCalendarEvent({
        sessionId,
        title: `Consultation with ${consultantName}`,
        start: scheduledAt,
        durationMinutes: 60,
        meetingUrl: generatedMeetingUrl || roomUrl,
        roomUrl,
      });

      // Both people are notified by the database ("Session Confirmed").

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
                <span className="text-muted-foreground">Mode</span>
                <Badge variant={bookingMode === 'instant' ? 'default' : 'secondary'} className="text-[10px] gap-1">
                  {bookingMode === 'instant' ? <Zap className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
                  {bookingMode === 'instant' ? 'Instant' : 'Scheduled'}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">
                  {bookingMode === 'instant' ? 'Today' : (selectedDate && format(selectedDate, 'EEEE, MMM d, yyyy'))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time</span>
                <span className="font-medium">{bookingMode === 'instant' ? 'Starting now' : selectedTime}</span>
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
                onClick={() => openExternal(meetingUrl)}
              >
                <Video className="w-4 h-4" />
                Open Video Call
              </Button>
            )}
            {calendarEvent && (
              <div className="space-y-2 text-start">
                <p className="text-xs font-medium text-muted-foreground">Add to your calendar and send the invitation</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" onClick={() => openExternal(googleCalendarUrl(calendarEvent))}>Google</Button>
                  <Button variant="outline" size="sm" onClick={() => openExternal(outlookCalendarUrl(calendarEvent))}>Outlook</Button>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => downloadLiveInterviewIcs(calendarEvent)}>
                    <Download className="w-3 h-3" /> .ics
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{consultantName} has also been notified in the app.</p>
              </div>
            )}
            <Button className="gradient-primary border-0 w-full" onClick={() => { onOpenChange(false); reset(); }}>
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* Step indicators */}
            <div className="flex items-center gap-2 mb-2">
              {(bookingMode === 'instant' ? [0, 2, 3] : [0, 1, 2, 3]).map(s => (
                <div key={s} className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  s <= step ? 'bg-primary' : 'bg-muted'
                )} />
              ))}
            </div>

            {/* Step 0: Choose mode (Instant vs Scheduled) */}
            {step === 0 && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-foreground">How would you like to consult?</p>
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={() => setBookingMode('instant')}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-xl border text-start transition-all',
                      bookingMode === 'instant'
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border/50 hover:border-primary/40'
                    )}
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">Instant consultation</span>
                        <Badge variant="secondary" className="text-[10px]">Now</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Start a session right away — perfect for urgent issues.
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBookingMode('scheduled')}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-xl border text-start transition-all',
                      bookingMode === 'scheduled'
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border/50 hover:border-primary/40'
                    )}
                  >
                    <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                      <CalendarClock className="w-5 h-5 text-accent" />
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-foreground">Schedule for later</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Pick a date and time that works best for you.
                      </p>
                    </div>
                  </button>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={() => setStep(bookingMode === 'instant' ? 2 : 1)}
                    className="gradient-primary border-0"
                  >
                    {t('booking.next')}
                  </Button>
                </div>
              </div>
            )}

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
                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(0)}>{t('booking.back')}</Button>
                  <Button disabled={!selectedDate} onClick={() => setStep(2)} className="gradient-primary border-0">
                    {t('booking.next')}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Time + Session type */}
            {step === 2 && (
              <div className="space-y-4">
                {bookingMode === 'instant' ? (
                  <div className="flex items-start gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                    <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Starting now</p>
                      <p className="text-xs text-muted-foreground">
                        Your session will start as soon as you confirm. Choose a session type below.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
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
                  <div className="flex items-start gap-3 p-3 rounded-xl border border-border/50 bg-muted/30 mt-2">
                    <Video className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Free video call with Jitsi Meet — opens in the browser, no account or download needed.
                    </p>
                  </div>
                )}

                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(bookingMode === 'instant' ? 0 : 1)}>{t('booking.back')}</Button>
                  <Button
                    disabled={bookingMode === 'scheduled' && !selectedTime}
                    onClick={() => setStep(3)}
                    className="gradient-primary border-0"
                  >
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
                    <span className="text-muted-foreground">Mode</span>
                    <Badge variant={bookingMode === 'instant' ? 'default' : 'secondary'} className="text-[10px] gap-1 capitalize">
                      {bookingMode === 'instant' ? <Zap className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
                      {bookingMode}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('booking.consultant')}</span>
                    <span className="font-medium text-foreground">{consultantName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('booking.date')}</span>
                    <span className="font-medium text-foreground">
                      {bookingMode === 'instant'
                        ? format(new Date(), 'EEEE, MMM d, yyyy')
                        : (selectedDate && format(selectedDate, 'EEEE, MMM d, yyyy'))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('booking.time')}</span>
                    <span className="font-medium text-foreground">
                      {bookingMode === 'instant' ? 'Starting now' : selectedTime}
                    </span>
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
