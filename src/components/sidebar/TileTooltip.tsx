import { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowRight } from 'lucide-react';
import { getTileMeta } from './tileMeta';

interface TileTooltipProps {
  scope: 'client' | 'consultant';
  itemKey: string;
  label: string;
  isActive?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

/**
 * Wraps a sidebar tile with a rich tooltip showing:
 *  - the tile label
 *  - a short description
 *  - a next-action hint
 */
export default function TileTooltip({
  scope,
  itemKey,
  label,
  isActive,
  side = 'right',
  children,
}: TileTooltipProps) {
  const meta = getTileMeta(scope, itemKey, label);

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align="center"
        sideOffset={8}
        className="max-w-[240px] p-3 space-y-1.5 bg-popover text-popover-foreground border border-border shadow-xl rounded-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold leading-none">{label}</span>
          {isActive && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
              Active
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-snug">{meta.description}</p>
        <div className="flex items-center gap-1.5 pt-1 mt-1 border-t border-border/60">
          <ArrowRight className="w-3 h-3 text-primary shrink-0" />
          <span className="text-[11px] font-medium text-foreground/80 leading-snug">
            {meta.hint}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
