import { cn } from '@/lib/utils';

interface StatusDotProps {
  status: 'online' | 'busy' | 'away' | 'offline';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

const statusColors = {
  online: 'bg-green-500',
  busy: 'bg-orange-500',
  away: 'bg-yellow-500',
  offline: 'bg-muted-foreground/40',
};

const sizes = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export function StatusDot({ status, size = 'md', pulse = false, className }: StatusDotProps) {
  return (
    <span className={cn(
      'rounded-full inline-block shrink-0',
      statusColors[status],
      sizes[size],
      pulse && status === 'online' && 'animate-pulse',
      className
    )} />
  );
}
