import { Button } from '@/components/ui/button';
import { ExternalLink, Play, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function isGoogleMeetUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return /(^|\.)meet\.google\.com$/i.test(hostname);
  } catch {
    return /meet\.google\.com/i.test(url);
  }
}

interface MeetingLinkButtonProps {
  url: string;
  fallbackUrl?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  joinLabel?: string;
}

/**
 * Renders the appropriate join control for a meeting URL.
 * - Google Meet links cannot be embedded in iframes (X-Frame-Options: SAMEORIGIN),
 *   so we render an explicit "Open in new tab" button with proper security attrs.
 * - Other meeting providers use the standard join button.
 */
export default function MeetingLinkButton({
  url,
  fallbackUrl,
  size = 'lg',
  className = 'gradient-primary border-0 gap-1.5',
  joinLabel,
}: MeetingLinkButtonProps) {
  const { t } = useTranslation();
  const target = url || fallbackUrl || '';
  const isMeet = isGoogleMeetUrl(target);

  const handleOpen = () => {
    if (!target) {
      toast.error(t('session_detail.no_meeting_link', { defaultValue: 'No meeting link available' }));
      return;
    }
    const opened = window.open(target, '_blank', 'noopener,noreferrer');
    if (!opened) {
      toast.error(
        t('session_detail.popup_blocked', {
          defaultValue: 'Popup blocked. Please allow popups for this site.',
        })
      );
    }
  };

  if (isMeet) {
    return (
      <Button
        size={size}
        className={className}
        onClick={handleOpen}
        aria-label={t('session_detail.open_meet_new_tab', {
          defaultValue: 'Open Google Meet in a new tab',
        })}
        title={t('session_detail.open_meet_new_tab_title', {
          defaultValue: 'Google Meet opens in a new tab (cannot be embedded)',
        })}
      >
        <Video className="w-4 h-4" />
        {t('session_detail.open_meet_new_tab_short', {
          defaultValue: 'Open Google Meet',
        })}
        <ExternalLink className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button size={size} className={className} onClick={handleOpen}>
      <Play className="w-4 h-4" />
      {joinLabel ?? t('session_detail.join_session')}
    </Button>
  );
}
