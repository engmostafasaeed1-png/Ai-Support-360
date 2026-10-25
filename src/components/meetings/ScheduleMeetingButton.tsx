import { CalendarDays, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, type ButtonProps } from '@/components/ui/button';
import { scheduleBlockText, type ScheduleBlock } from '@/lib/meetingSchedule';

interface Props extends Omit<ButtonProps, 'onClick' | 'disabled'> {
  /** why the person can not schedule (null = they can) */
  block: ScheduleBlock | null;
  onSchedule: () => void;
  label?: string;
  /** show the reason below the button instead of beside it */
  stacked?: boolean;
}

/**
 * Every "Schedule meeting" entry point uses this button: when scheduling is not possible it is disabled AND the reason is
 * shown next to it (never a silently dead button).
 */
export default function ScheduleMeetingButton({ block, onSchedule, label, stacked, className, size = 'sm', variant = 'outline', ...rest }: Props) {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const reasonId = `schedule-reason-${Math.abs(hash(label ?? 'x'))}`;
  return (
    <div className={stacked ? 'flex flex-col items-center gap-1.5' : 'flex flex-wrap items-center gap-2'}>
      <Button
        {...rest}
        size={size}
        variant={variant}
        className={className ?? 'h-8 text-xs gap-1.5'}
        disabled={!!block}
        aria-describedby={block ? reasonId : undefined}
        onClick={() => { if (!block) onSchedule(); }}
        data-testid="schedule-meeting-button"
      >
        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> {label ?? (lang === 'ar' ? 'جدولة اجتماع' : 'Schedule Meeting')}
      </Button>
      {block && (
        <span id={reasonId} role="note" className="flex max-w-md items-start gap-1 text-xs text-muted-foreground" data-testid="schedule-meeting-reason">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{scheduleBlockText(block, lang)}
        </span>
      )}
    </div>
  );
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
