import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface FixedHeaderProps {
  children: React.ReactNode;
  className?: string;
}

// Logical offsets (start/end) keep the headers beside the sidebar in both LTR and RTL.
export function FixedHeader({ children, className }: FixedHeaderProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <header
      className={cn(
        'h-14 flex items-center justify-between border-b border-border/50 px-4 bg-background/95 backdrop-blur-xl fixed top-0 start-0 end-0 z-40 shadow-sm transition-[inset-inline-start] duration-200 ease-linear',
        collapsed ? 'md:start-[3rem]' : 'md:start-[16rem]',
        className
      )}
    >
      {children}
    </header>
  );
}

export function FixedSubHeader({ children, className }: FixedHeaderProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <div
      className={cn(
        'border-b border-border/30 bg-background/90 backdrop-blur-sm fixed top-14 start-0 end-0 z-30 hidden md:block transition-[inset-inline-start] duration-200 ease-linear shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
        collapsed ? 'md:start-[3rem]' : 'md:start-[16rem]',
        className
      )}
    >
      {children}
    </div>
  );
}
