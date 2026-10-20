import { Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { usePublicResponsiveness } from '@/hooks/useResponsiveness';
import { formatMinutes, LEVEL_LABEL, LEVEL_TONE } from '@/lib/responsivenessFormat';

/**
 * Client-facing "Responsiveness" chip: level + median response time + response rate only (no ticket data, no names).
 * Renders nothing while the owner keeps responsiveness private (responsiveness_public off).
 */
export default function ResponsivenessChip({ consultantId, className }: { consultantId?: string | null; className?: string }) {
  const { t, i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const { publicOn, byId } = usePublicResponsiveness();
  if (!publicOn || !consultantId) return null;
  const r = byId.get(consultantId);
  const level = r?.level ?? 'new';
  const name = ar ? LEVEL_LABEL[level][1] : t(`responsiveness.level_${level}`, LEVEL_LABEL[level][0]);
  const details = level === 'new'
    ? t('responsiveness.chip_new', 'Not enough requests yet')
    : t('responsiveness.chip_details', 'Median reply {{median}} · {{rate}}% answered', {
      median: formatMinutes(r?.median_minutes, ar), rate: r?.response_rate ?? 0,
    });
  return (
    <span
      data-testid="responsiveness-chip"
      data-level={level}
      className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', LEVEL_TONE[level], className)}
    >
      <Timer className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {t('responsiveness.chip_label', 'Responsiveness')}: {name}
        <span className="font-normal opacity-90"> · {details}</span>
      </span>
    </span>
  );
}
