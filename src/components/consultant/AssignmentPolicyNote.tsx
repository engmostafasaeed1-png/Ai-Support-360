import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { useAssignmentPolicy } from '@/hooks/useAssignmentPolicy';
import { policyText } from '../../../supabase/functions/_shared/assignmentPolicy';

/** The assignment response policy with the administrator's current timings, in the reader's language. */
export function useAssignmentPolicyText(): string {
  const { i18n } = useTranslation();
  const policy = useAssignmentPolicy();
  return policyText(policy, i18n?.language?.startsWith('ar') ? 'ar' : 'en');
}

export default function AssignmentPolicyNote({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const text = useAssignmentPolicyText();
  return (
    <div className={`flex gap-3 rounded-xl border border-border/50 bg-muted/50 p-3 ${className}`}>
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{t('assignment_policy.title', 'Replying to assignment requests')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
