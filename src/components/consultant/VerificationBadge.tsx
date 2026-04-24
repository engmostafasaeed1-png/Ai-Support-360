import { ShieldCheck, ShieldAlert, ShieldQuestion, Clock, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';

export type VerificationStatus =
  | 'pending'
  | 'under_review'
  | 'on_hold'
  | 'verified'
  | 'rejected'
  | 'suspended'
  | null
  | undefined;

interface Props {
  status: VerificationStatus;
  size?: 'sm' | 'md';
  className?: string;
  /** Hide the badge entirely when verified */
  hideWhenVerified?: boolean;
}

const config: Record<
  Exclude<VerificationStatus, null | undefined>,
  { label: string; icon: typeof ShieldCheck; classes: string }
> = {
  verified: {
    label: 'Verified',
    icon: ShieldCheck,
    classes:
      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-800/60',
  },
  under_review: {
    label: 'Under Review',
    icon: ShieldQuestion,
    classes:
      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200/60 dark:border-blue-800/60',
  },
  pending: {
    label: 'Pending Approval',
    icon: Clock,
    classes:
      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/60',
  },
  on_hold: {
    label: 'On Hold',
    icon: Clock,
    classes:
      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/60',
  },
  rejected: {
    label: 'Rejected',
    icon: ShieldAlert,
    classes:
      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200/60 dark:border-red-800/60',
  },
  suspended: {
    label: 'Suspended',
    icon: ShieldX,
    classes:
      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200/60 dark:border-red-800/60',
  },
};

export default function VerificationBadge({ status, size = 'sm', className, hideWhenVerified }: Props) {
  const key = (status || 'pending') as Exclude<VerificationStatus, null | undefined>;
  if (hideWhenVerified && key === 'verified') return null;
  const c = config[key] || config.pending;
  const Icon = c.icon;
  const sizing =
    size === 'md'
      ? 'text-xs px-2.5 py-1 gap-1.5'
      : 'text-[10px] px-2 py-0.5 gap-1';
  const iconSize = size === 'md' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5';

  return (
    <span
      title={`Consultant verification: ${c.label}`}
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        c.classes,
        sizing,
        className,
      )}
    >
      <Icon className={iconSize} />
      {c.label}
    </span>
  );
}
