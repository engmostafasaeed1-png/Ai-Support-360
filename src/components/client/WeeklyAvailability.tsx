import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';

/**
 * Weekly working hours the consultant set in their Session Calendar.
 * Same wording as the consultant cards and the map pop-up, so clients
 * read the same information in every place.
 */
export default function WeeklyAvailability({
  hours,
  className = '',
  testId = 'weekly-availability',
}: {
  hours?: string[];
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const list = hours ?? [];

  return (
    <div
      className={`rounded-xl border border-border/50 bg-muted/30 px-3 py-2 ${className}`}
      data-testid={testId}
    >
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarDays className="h-3 w-3" aria-hidden="true" />
        {t('consultant_profile.weekly_availability')}
      </p>
      {list.length > 0 ? (
        <ul className="space-y-0.5">
          {list.map((h) => (
            <li key={h} className="text-xs text-foreground">
              {h}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('consultant_profile.no_hours_set')}</p>
      )}
    </div>
  );
}
