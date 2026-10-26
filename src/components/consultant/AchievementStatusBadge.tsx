import { useTranslation } from 'react-i18next';
import { BadgeCheck, CircleDashed, EyeOff, ShieldCheck, XCircle } from 'lucide-react';
import type { AchievementStatus } from '@/lib/achievements';

/** Self-declared / Verified / Hidden / Rejected, plus "Platform-verified" for achievements made from platform data. */
export default function AchievementStatusBadge({ status }: { status: AchievementStatus | 'platform' }) {
  const { t } = useTranslation();
  const map = {
    platform: { Icon: ShieldCheck, cls: 'bg-primary/10 text-primary', text: t('achievements.s_platform', 'Platform-verified') },
    verified: { Icon: BadgeCheck, cls: 'bg-success/10 text-success', text: t('achievements.s_verified', 'Verified') },
    self_declared: { Icon: CircleDashed, cls: 'bg-muted text-muted-foreground', text: t('achievements.s_self', 'Self-declared') },
    hidden: { Icon: EyeOff, cls: 'bg-warning/10 text-warning-foreground', text: t('achievements.s_hidden', 'Hidden by admin') },
    rejected: { Icon: XCircle, cls: 'bg-destructive/10 text-destructive', text: t('achievements.s_rejected', 'Rejected') },
  }[status];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${map.cls}`}><map.Icon className="h-3 w-3" aria-hidden />{map.text}</span>;
}
