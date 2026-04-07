import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import { Button } from './button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, actionHref, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-accent" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      {description && <p className="text-xs text-muted-foreground max-w-[240px]">{description}</p>}
      {actionLabel && (
        actionHref ? (
          <a href={actionHref}>
            <Button size="sm" className="mt-4 gradient-primary border-0">{actionLabel}</Button>
          </a>
        ) : (
          <Button size="sm" className="mt-4 gradient-primary border-0" onClick={onAction}>{actionLabel}</Button>
        )
      )}
    </div>
  );
}
