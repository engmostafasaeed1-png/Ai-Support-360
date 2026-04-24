import { ReactNode, useState, MouseEvent } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
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
 * Sidebar-tile hover/tap card.
 * - Desktop: shadcn Tooltip on hover (side defaults to right of the tile).
 * - Mobile: Popover that opens on tap above the tile so it never covers the grid.
 *           First tap opens the popover; second tap (or tap on Open button) navigates.
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
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const Body = (
    <>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold leading-none">{label}</span>
        {isActive && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
            Active
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-snug mt-1.5">{meta.description}</p>
      <div className="flex items-center gap-1.5 pt-1.5 mt-1.5 border-t border-border/60">
        <ArrowRight className="w-3 h-3 text-primary shrink-0" />
        <span className="text-[11px] font-medium text-foreground/80 leading-snug">
          {meta.hint}
        </span>
      </div>
    </>
  );

  if (isMobile) {
    // Intercept the first tap to reveal the popover; allow the second tap to navigate.
    const handleClick = (e: MouseEvent) => {
      if (!open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      } else {
        setOpen(false);
      }
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <span
            onClickCapture={handleClick}
            className="contents"
          >
            {children}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={10}
          collisionPadding={12}
          avoidCollisions
          className="w-[260px] max-w-[calc(100vw-24px)] p-3 bg-popover text-popover-foreground border border-border shadow-xl rounded-xl z-[60]"
        >
          {Body}
          <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
            Tap again to open
          </p>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align="center"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        className="max-w-[240px] p-3 space-y-1.5 bg-popover text-popover-foreground border border-border shadow-xl rounded-xl"
      >
        {Body}
      </TooltipContent>
    </Tooltip>
  );
}
