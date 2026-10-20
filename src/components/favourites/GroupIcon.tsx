import { Briefcase, Flag, Globe, Shield, Star, Users, Wrench, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GROUP_TONE, type ConsultantGroup, type GroupIcon as GroupIconName } from '@/lib/clientFavourites';

export const GROUP_ICON_COMPONENT: Record<GroupIconName, LucideIcon> = {
  users: Users, star: Star, shield: Shield, zap: Zap, flag: Flag, briefcase: Briefcase, globe: Globe, wrench: Wrench,
};

export function GroupIcon({ icon, className }: { icon: GroupIconName; className?: string }) {
  const Icon = GROUP_ICON_COMPONENT[icon] ?? Users;
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', className)} aria-hidden="true" />;
}

/** Coloured group label (chip). */
export function GroupBadge({ group, className, count }: { group: Pick<ConsultantGroup, 'name' | 'colour' | 'icon'>; className?: string; count?: number }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', GROUP_TONE[group.colour] ?? GROUP_TONE.slate, className)}>
      <GroupIcon icon={group.icon} className="h-3 w-3" />
      <span className="truncate">{group.name}</span>
      {count !== undefined && <span className="tabular-nums opacity-80">· {count}</span>}
    </span>
  );
}
