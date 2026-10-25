import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, type ButtonProps } from '@/components/ui/button';
import { scheduleBlockText, type ScheduleBlock } from '@/lib/meetingSchedule';
import type { BlockedReason, ReasonKey } from '@/lib/blockedReasons';

interface Props extends Omit<ButtonProps, 'onClick' | 'disabled' | 'reason'> {
  /** why the person can not schedule (null = they can) */
  block: ScheduleBlock | null;
  onSchedule: () => void;
  label?: string;
  /** show the reason below the button, centred (empty states) */
  stacked?: boolean;
  /** next step when no consultant is assigned yet (e.g. open the Bids tab or the Send request dialog) */
  noConsultantStep?: { to?: string; onNext?: () => void; nextLabel?: string };
}

const KEY: Record<Exclude<ScheduleBlock, 'loading'>, ReasonKey> = {
  no_consultant: 'no_consultant_assigned',
  not_owner: 'not_ticket_owner',
  not_assigned: 'not_assigned_to_you',
  closed: 'ticket_closed',
};

/** The blocked reason for a schedule block, in the shared catalogue (meeting-specific wording kept). */
export function scheduleReason(block: ScheduleBlock | null, lang: 'en' | 'ar', step?: Props['noConsultantStep']): BlockedReason | null {
  if (!block || block === 'loading') return null;
  return {
    key: KEY[block],
    message: scheduleBlockText(block, lang),
    ...(block === 'no_consultant' && step ? step : {}),
  };
}

/**
 * Every "Schedule meeting" entry point uses this button: when scheduling is not possible it stays focusable, explains
 * WHY in a line under it (and on hover/focus/tap) and offers the next step; it never silently does nothing.
 */
export default function ScheduleMeetingButton({ block, onSchedule, label, stacked, noConsultantStep, className, size = 'sm', variant = 'outline', ...rest }: Props) {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  return (
    <Button
      {...rest}
      size={size}
      variant={variant}
      className={className ?? 'h-8 text-xs gap-1.5'}
      hint="inline"
      wrapperClassName={stacked ? 'items-center text-center' : undefined}
      hintClassName={stacked ? 'justify-center' : undefined}
      busy={block === 'loading'}
      busyLabel={scheduleBlockText('loading', lang)}
      reason={scheduleReason(block, lang, noConsultantStep)}
      onClick={onSchedule}
      data-testid="schedule-meeting-button"
    >
      <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> {label ?? (lang === 'ar' ? 'جدولة اجتماع' : 'Schedule Meeting')}
    </Button>
  );
}
