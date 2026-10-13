import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileFieldRules } from '@/hooks/useProfileFieldRules';

/** Renders its children only when the administrator did not set the field (or every listed field) to Hidden. */
export function FieldGate({ field, children }: { field: string | string[]; children: ReactNode }) {
  const { isVisible } = useProfileFieldRules();
  const keys = Array.isArray(field) ? field : [field];
  return keys.some(isVisible) ? <>{children}</> : null;
}

/** A red star and the helper text "Required" when the administrator made the field required. */
export function RequiredMark({ field }: { field: string }) {
  const { t } = useTranslation();
  const { isRequired } = useProfileFieldRules();
  if (!isRequired(field)) return null;
  return (
    <span data-testid={`required-${field}`} className="ms-1 inline-flex items-center gap-1 align-middle">
      <span aria-hidden="true" className="text-destructive">*</span>
      <span className="text-[10px] font-normal text-muted-foreground">{t('profileRules.required', 'Required')}</span>
    </span>
  );
}
