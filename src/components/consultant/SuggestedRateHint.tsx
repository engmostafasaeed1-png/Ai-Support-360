import { useTranslation } from 'react-i18next';
import { useMyConsultantRoles, useRoleSettings } from '@/hooks/useRoleCatalog';
import { CATEGORY_LABELS, normalizeRoles, suggestedRateRange } from '@/lib/consultantRoles';

/** "Suggested range for <category>: min–max" under the hourly rate, only when an admin set a range. Advice only. */
export default function SuggestedRateHint({ currency }: { currency?: string }) {
  const { t, i18n } = useTranslation();
  const roles = useMyConsultantRoles();
  const settings = useRoleSettings();
  const range = suggestedRateRange(settings.data, normalizeRoles(roles.data ?? []).primary);
  if (!range) return null;
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  return (
    <p className="text-[11px] text-muted-foreground">
      {t('roles.rate_hint', 'Suggested range for {{category}}: {{min}}–{{max}} {{currency}} per hour. You still choose your own rate.', {
        category: CATEGORY_LABELS[range.category][lang], min: range.min, max: range.max, currency: currency || 'USD',
      })}
    </p>
  );
}
