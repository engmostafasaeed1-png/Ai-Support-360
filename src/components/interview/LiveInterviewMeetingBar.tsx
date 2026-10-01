import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CalendarPlus, ChevronDown, Copy, Video } from 'lucide-react';
import { toast } from 'sonner';
import MeetingLinkButton, { detectProvider } from '@/components/session/MeetingLinkButton';
import {
  downloadLiveInterviewIcs,
  googleCalendarUrl,
  office365CalendarUrl,
  outlookCalendarUrl,
  resolveMeetingUrl,
  type LiveInterviewEvent,
} from '@/lib/liveInterviewCalendar';

interface Props {
  sessionId: string;
  storedMeetingUrl?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  title: string;
  attendees?: string[];
}

const PROVIDER_NAME: Record<string, string> = {
  meet: 'Google Meet',
  jitsi: 'Free · Jitsi Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  unknown: 'Video call',
};

/** The video-conference link of a live interview (free Jitsi Meet by default) with join and add-to-calendar actions. */
export default function LiveInterviewMeetingBar({ sessionId, storedMeetingUrl, scheduledAt, durationMinutes, title, attendees }: Props) {
  const meetingUrl = resolveMeetingUrl(sessionId, storedMeetingUrl);
  const provider = detectProvider(meetingUrl);
  const start = scheduledAt ? new Date(scheduledAt) : null;
  const event: LiveInterviewEvent | null =
    start && !Number.isNaN(start.getTime())
      ? {
          sessionId,
          title,
          start,
          durationMinutes: durationMinutes && durationMinutes > 0 ? durationMinutes : 60,
          meetingUrl,
          roomUrl: `${window.location.origin}/interview/live/${sessionId}`,
          attendees,
        }
      : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meetingUrl);
      toast.success('Video call link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  return (
    <Card className="rounded-2xl border-primary/20 bg-primary/5">
      <CardContent className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Video className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              Video call
              <Badge variant="secondary" className="text-[10px]">{PROVIDER_NAME[provider] || PROVIDER_NAME.unknown}</Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate max-w-[60vw] md:max-w-md">{meetingUrl}</p>
          </div>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <MeetingLinkButton url={meetingUrl} sessionId={sessionId} size="sm" joinLabel="Join video call" />
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="w-3.5 h-3.5 me-1" /> Copy link
          </Button>
          {event && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <CalendarPlus className="w-3.5 h-3.5 me-1" /> Add to calendar <ChevronDown className="w-3 h-3 ms-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => open(googleCalendarUrl(event))}>Google Calendar</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => open(outlookCalendarUrl(event))}>Outlook.com</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => open(office365CalendarUrl(event))}>Microsoft 365</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => downloadLiveInterviewIcs(event)}>Download .ics file (Apple, Outlook app)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
