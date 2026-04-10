import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, addMinutes, setHours, setMinutes } from 'date-fns';
import {
  CalendarDays, Clock, Video, MessageSquare, Monitor, Bell,
  Loader2, CheckCircle2, X, UserPlus, Users, Mail, Search,
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

interface ConsultantOption {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  isAssigned?: boolean;
}

interface ExternalInvitee {
  email: string;
}

type InviteeSource = 'assigned' | 'all' | 'external';

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

  // Consultant selection state
  const [inviteeSource, setInviteeSource] = useState<InviteeSource>('assigned');
  const [selectedConsultantIds, setSelectedConsultantIds] = useState<string[]>([]);
  const [externalEmails, setExternalEmails] = useState<ExternalInvitee[]>([]);
  const [externalInput, setExternalInput] = useState('');
  const [consultantSearch, setConsultantSearch] = useState('');

  // Pre-select assigned consultant
  useEffect(() => {
    if (consultantId && inviteeSource === 'assigned') {
      setSelectedConsultantIds([consultantId]);
    }
  }, [consultantId, inviteeSource]);

  // Fetch assigned consultants for this ticket
  const { data: assignedConsultants = [] } = useQuery({
    queryKey: ['ticket-assigned-consultants', ticketId],
    queryFn: async () => {
      const { data: matches } = await supabase
        .from('match_requests')
        .select('consultant_id')
        .eq('ticket_id', ticketId)
        .eq('status', 'accepted');

      const ids = [...new Set([
        ...(consultantId ? [consultantId] : []),
        ...(matches?.map(m => m.consultant_id) || []),
      ])];

      if (ids.length === 0) return [];

      const { data: consultants } = await supabase
        .from('consultants')
        .select('id, user_id')
        .in('id', ids);

      if (!consultants?.length) return [];

      const userIds = consultants.map(c => c.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);

      return consultants.map(c => {
        const p = profiles?.find(pr => pr.user_id === c.user_id);
        return {
          id: c.id,
          user_id: c.user_id,
          display_name: p?.display_name || 'Consultant',
          avatar_url: p?.avatar_url,
          isAssigned: c.id === consultantId,
        } as ConsultantOption;
      });
    },
    enabled: open,
  });

  // Fetch all consultants
  const { data: allConsultants = [] } = useQuery({
    queryKey: ['all-consultants-for-meeting'],
    queryFn: async () => {
      const { data: consultants } = await supabase
        .from('consultants')
        .select('id, user_id')
        .eq('verification_status', 'verified')
        .limit(100);

      if (!consultants?.length) return [];

      const userIds = consultants.map(c => c.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);

      return consultants.map(c => {
        const p = profiles?.find(pr => pr.user_id === c.user_id);
        return {
          id: c.id,
          user_id: c.user_id,
          display_name: p?.display_name || 'Consultant',
          avatar_url: p?.avatar_url,
          isAssigned: c.id === consultantId,
        } as ConsultantOption;
      });
    },
    enabled: open && inviteeSource === 'all',
  });

  const displayedConsultants = inviteeSource === 'assigned' ? assignedConsultants : allConsultants;
  const filteredConsultants = displayedConsultants.filter(c =>
    c.display_name.toLowerCase().includes(consultantSearch.toLowerCase())
  );

  const toggleConsultant = (id: string) => {
    setSelectedConsultantIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const addExternalEmail = () => {
    const email = externalInput.trim();
    if (!email) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error('Invalid email address');
      return;
    }
    if (externalEmails.some(e => e.email === email)) {
      toast.error('Email already added');
      return;
    }
    setExternalEmails(prev => [...prev, { email }]);
    setExternalInput('');
  };

  const removeExternalEmail = (email: string) => {
    setExternalEmails(prev => prev.filter(e => e.email !== email));
  };

  const selectedConsultantNames = displayedConsultants
    .filter(c => selectedConsultantIds.includes(c.id))
    .map(c => c.display_name);

  const totalInvitees = selectedConsultantIds.length + externalEmails.length;

  const handleSchedule = async () => {
    if (!date) { toast.error('Please select a date'); return; }
    if (totalInvitees === 0) { toast.error('Please select at least one participant'); return; }

    setSaving(true);
    const [h, m] = time.split(':').map(Number);
    const scheduledAt = setMinutes(setHours(date, h), m);
    const sessionId = crypto.randomUUID();
    const meetingUrl = generateMeetingUrl(platform, sessionId);

    // Create session for first selected consultant (primary)
    const primaryConsultantId = selectedConsultantIds[0] || null;
    const { error } = await supabase.from('sessions').insert({
      id: sessionId,
      ticket_id: ticketId,
      client_id: clientId,
      consultant_id: primaryConsultantId,
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
      setSaving(false);
      return;
    }

    // Notify all selected consultants
    for (const cId of selectedConsultantIds) {
      const { data: consultant } = await supabase
        .from('consultants')
        .select('user_id')
        .eq('id', cId)
        .maybeSingle();
      if (consultant) {
        await supabase.from('notifications').insert({
          user_id: consultant.user_id,
          title: 'Meeting Invitation',
          body: `You're invited to a ${sessionType} meeting for "${ticketTitle}" on ${format(scheduledAt, 'MMM d, yyyy')} at ${format(scheduledAt, 'h:mm a')}. Join: ${meetingUrl}`,
          type: 'session',
          link: `/consultant/cases/${ticketId}`,
        });
      }
    }

    // Download .ics
    downloadICS(scheduledAt, parseInt(duration), ticketTitle, meetingUrl, selectedConsultantNames, externalEmails.map(e => e.email));

    const inviteeSummary = [
      ...selectedConsultantNames,
      ...externalEmails.map(e => e.email),
    ];
    toast.success(`Meeting scheduled with ${inviteeSummary.length} participant(s)! Calendar invite downloaded.`);
    queryClient.invalidateQueries({ queryKey: ['ticket-sessions', ticketId] });
    onOpenChange(false);
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
            Invite consultants or external participants to a session
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Participant Selection ── */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> Participants
            </Label>
            <RadioGroup value={inviteeSource} onValueChange={(v) => { setInviteeSource(v as InviteeSource); setSelectedConsultantIds([]); setExternalEmails([]); }} className="flex gap-2">
              {[
                { value: 'assigned', label: 'Assigned', icon: CheckCircle2 },
                { value: 'all', label: 'All Consultants', icon: Users },
                { value: 'external', label: 'External', icon: Mail },
              ].map(opt => (
                <Label
                  key={opt.value}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border cursor-pointer transition-all text-xs ${
                    inviteeSource === opt.value ? 'border-accent bg-accent/5 text-accent' : 'border-border/50'
                  }`}
                >
                  <RadioGroupItem value={opt.value} className="sr-only" />
                  <opt.icon className="w-3.5 h-3.5" />
                  {opt.label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* Consultant list (assigned or all) */}
          {(inviteeSource === 'assigned' || inviteeSource === 'all') && (
            <div className="space-y-2">
              {inviteeSource === 'all' && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search consultants..."
                    value={consultantSearch}
                    onChange={e => setConsultantSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
              )}
              <ScrollArea className="max-h-36 rounded-lg border border-border/50">
                <div className="p-2 space-y-1">
                  {filteredConsultants.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">No consultants found</p>
                  ) : filteredConsultants.map(c => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors text-xs ${
                        selectedConsultantIds.includes(c.id) ? 'bg-accent/5' : ''
                      }`}
                    >
                      <Checkbox
                        checked={selectedConsultantIds.includes(c.id)}
                        onCheckedChange={() => toggleConsultant(c.id)}
                      />
                      <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center text-[10px] font-semibold text-accent">
                        {c.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="flex-1 truncate">{c.display_name}</span>
                      {c.isAssigned && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Primary</Badge>}
                    </label>
                  ))}
                </div>
              </ScrollArea>
              {selectedConsultantIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedConsultantNames.map(name => (
                    <Badge key={name} variant="secondary" className="text-[10px] gap-1">
                      {name}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => {
                        const c = displayedConsultants.find(c => c.display_name === name);
                        if (c) toggleConsultant(c.id);
                      }} />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* External email input */}
          {inviteeSource === 'external' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter email address..."
                  value={externalInput}
                  onChange={e => setExternalInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addExternalEmail())}
                  className="h-8 text-xs flex-1"
                  type="email"
                />
                <Button size="sm" variant="outline" onClick={addExternalEmail} className="h-8 text-xs gap-1">
                  <UserPlus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>
              {externalEmails.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {externalEmails.map(e => (
                    <Badge key={e.email} variant="secondary" className="text-[10px] gap-1">
                      <Mail className="w-3 h-3" />
                      {e.email}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => removeExternalEmail(e.email)} />
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                External participants will receive a calendar invitation via the downloaded .ics file
              </p>
            </div>
          )}

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

          {/* Platform */}
          {(sessionType === 'video' || sessionType === 'screen_share') && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
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

          {/* Date */}
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
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
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
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
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
          {date && totalInvitees > 0 && (
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
                  <span>Participants: {totalInvitees}</span>
                </div>
                {(selectedConsultantNames.length > 0 || externalEmails.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selectedConsultantNames.map(n => (
                      <Badge key={n} variant="secondary" className="text-[10px]">{n}</Badge>
                    ))}
                    {externalEmails.map(e => (
                      <Badge key={e.email} variant="outline" className="text-[10px] gap-1">
                        <Mail className="w-2.5 h-2.5" />{e.email}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="gradient-primary border-0 gap-2" onClick={handleSchedule} disabled={saving || !date || totalInvitees === 0}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
            Schedule Meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Generate and download a .ics calendar file with attendees */
function downloadICS(start: Date, durationMin: number, title: string, url: string, attendees: string[], externalEmails: string[]) {
  const end = addMinutes(start, durationMin);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const attendeeLines = [
    ...attendees.map(name => `ATTENDEE;CN=${name};ROLE=REQ-PARTICIPANT:MAILTO:noreply@qurtuba.com`),
    ...externalEmails.map(email => `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:MAILTO:${email}`),
  ];

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Qurtuba//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:Meeting with ${[...attendees, ...externalEmails].join(', ')}\\nJoin: ${url}`,
    `URL:${url}`,
    ...attendeeLines,
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
