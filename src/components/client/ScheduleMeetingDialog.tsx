import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, addMinutes, setHours, setMinutes } from 'date-fns';
import {
  CalendarDays, Clock, Video, MessageSquare, Monitor, Bell,
  Loader2, CheckCircle2, Globe,
} from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  ticketTitle: string;
  clientId: string;
  consultantId: string | null;
  consultantName?: string;
}

const SESSION_TYPES = [
  { value: 'video', icon: Video, label: 'Video Call' },
  { value: 'chat', icon: MessageSquare, label: 'Live Chat' },
  { value: 'screen_share', icon: Monitor, label: 'Screen Share' },
] as const;

const PLATFORMS = [
  { value: 'jitsi', label: 'Jitsi Meet', desc: 'Free, no account needed' },
  { value: 'zoom', label: 'Zoom', desc: 'Zoom meeting' },
  { value: 'google_meet', label: 'Google Meet', desc: 'Google video call' },
  { value: 'ms_teams', label: 'MS Teams', desc: 'Microsoft Teams' },
];

const REMINDER_OPTIONS = [
  { value: '5', label: '5 minutes before' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '1440', label: '1 day before' },
];

const TIME_SLOTS = Array.from({ length: 28 }, (_, i) => {
  const hour = Math.floor(i / 2) + 8;
  const min = (i % 2) * 30;
  return { value: `${hour}:${min.toString().padStart(2, '0')}`, label: format(setMinutes(setHours(new Date(), hour), min), 'h:mm a') };
}).filter(s => {
  const [h] = s.value.split(':').map(Number);
  return h < 22;
});

function generateMeetingUrl(platform: string, sessionId: string): string {
  const room = `qurtuba-${sessionId.slice(0, 8)}`;
  switch (platform) {
    case 'jitsi': return `https://meet.jit.si/${room}`;
    case 'zoom': return `https://zoom.us/j/${room}`;
    case 'google_meet': return `https://meet.google.com/${room}`;
    case 'ms_teams': return `https://teams.microsoft.com/l/meetup-join/${room}`;
    default: return `https://meet.jit.si/${room}`;
  }
}

export default function ScheduleMeetingDialog({ open, onOpenChange, ticketId, ticketTitle, clientId, consultantId, consultantName }: Props) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState('10:00');
  const [sessionType, setSessionType] = useState('video');
  const [platform, setPlatform] = useState('jitsi');
  const [reminder, setReminder] = useState('15');
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSchedule = async () => {
    if (!date) {
      toast.error('Please select a date');
      return;
    }
    setSaving(true);

    const [h, m] = time.split(':').map(Number);
    const scheduledAt = setMinutes(setHours(date, h), m);
    const sessionId = crypto.randomUUID();
    const meetingUrl = generateMeetingUrl(platform, sessionId);

    const { error } = await supabase.from('sessions').insert({
      id: sessionId,
      ticket_id: ticketId,
      client_id: clientId,
      consultant_id: consultantId,
      session_type: sessionType as any,
      video_platform: platform,
      scheduled_at: scheduledAt.toISOString(),
      duration_minutes: parseInt(duration),
      meeting_url: meetingUrl,
      status: 'scheduled' as any,
      notes: notes || null,
      reminder_minutes: parseInt(reminder),
    } as any);

    if (error) {
      toast.error('Failed to schedule meeting');
      console.error(error);
    } else {
      // Send notification to consultant
      if (consultantId) {
        const { data: consultant } = await supabase
          .from('consultants')
          .select('user_id')
          .eq('id', consultantId)
          .maybeSingle();
        if (consultant) {
          await supabase.from('notifications').insert({
            user_id: consultant.user_id,
            title: 'Meeting Scheduled',
            body: `A ${sessionType} meeting for "${ticketTitle}" is scheduled on ${format(scheduledAt, 'MMM d, yyyy')} at ${format(scheduledAt, 'h:mm a')}. Reminder: ${REMINDER_OPTIONS.find(r => r.value === reminder)?.label || '15 min before'}.`,
            type: 'session',
            link: `/consultant/cases/${ticketId}`,
          });
        }
      }

      // Generate .ics calendar download
      downloadICS(scheduledAt, parseInt(duration), ticketTitle, meetingUrl, consultantName);

      toast.success('Meeting scheduled! Calendar invite downloaded.');
      queryClient.invalidateQueries({ queryKey: ['ticket-sessions', ticketId] });
      onOpenChange(false);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-accent" />
            Schedule Meeting
          </DialogTitle>
          <DialogDescription>
            {consultantName ? `Meeting with ${consultantName}` : 'Schedule a session for this ticket'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Session Type */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Session Type</Label>
            <RadioGroup value={sessionType} onValueChange={setSessionType} className="flex gap-2">
              {SESSION_TYPES.map(t => (
                <Label
                  key={t.value}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all text-xs ${
                    sessionType === t.value ? 'border-accent bg-accent/5 text-accent' : 'border-border/50'
                  }`}
                >
                  <RadioGroupItem value={t.value} className="sr-only" />
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* Platform (for video/screen_share) */}
          {(sessionType === 'video' || sessionType === 'screen_share') && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted-foreground ml-1">— {p.desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date Picker */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Date</Label>
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
              className="rounded-xl border border-border/50 mx-auto"
            />
          </div>

          {/* Time & Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Time
              </Label>
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {TIME_SLOTS.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30" className="text-xs">30 min</SelectItem>
                  <SelectItem value="60" className="text-xs">1 hour</SelectItem>
                  <SelectItem value="90" className="text-xs">1.5 hours</SelectItem>
                  <SelectItem value="120" className="text-xs">2 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reminder */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1">
              <Bell className="w-3.5 h-3.5" /> Reminder
            </Label>
            <Select value={reminder} onValueChange={setReminder}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map(r => (
                  <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Meeting Notes (optional)</Label>
            <Textarea
              placeholder="Agenda, topics to discuss..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="min-h-[60px] text-xs"
            />
          </div>

          {/* Summary */}
          {date && (
            <Card className="rounded-xl border-accent/20 bg-accent/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <CheckCircle2 className="w-4 h-4 text-accent" />
                  <span className="text-xs font-semibold text-accent">Meeting Summary</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                  <span>Date: {format(date, 'MMM d, yyyy')}</span>
                  <span>Time: {TIME_SLOTS.find(s => s.value === time)?.label}</span>
                  <span>Type: {SESSION_TYPES.find(s => s.value === sessionType)?.label}</span>
                  <span>Duration: {duration} min</span>
                  <span>Reminder: {REMINDER_OPTIONS.find(r => r.value === reminder)?.label}</span>
                  {consultantName && <span>With: {consultantName}</span>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="gradient-primary border-0 gap-2" onClick={handleSchedule} disabled={saving || !date}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
            Schedule Meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Generate and download a .ics calendar file */
function downloadICS(start: Date, durationMin: number, title: string, url: string, attendee?: string) {
  const end = addMinutes(start, durationMin);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Qurtuba//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:Meeting${attendee ? ' with ' + attendee : ''}\\nJoin: ${url}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Meeting reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `meeting-${format(start, 'yyyy-MM-dd')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}
