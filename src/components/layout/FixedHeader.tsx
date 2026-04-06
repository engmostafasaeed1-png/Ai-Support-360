import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface FixedHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function FixedHeader({ children, className }: FixedHeaderProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <header
      className={cn(
        'h-14 flex items-center justify-between border-b border-border/40 px-4 bg-card/80 backdrop-blur-xl fixed top-0 right-0 left-0 z-40 shadow-sm transition-[left] duration-200 ease-linear',
        collapsed ? 'md:left-[3rem]' : 'md:left-[16rem]',
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
        'border-b border-border/30 bg-card/60 backdrop-blur-sm fixed top-14 right-0 left-0 z-30 block transition-[left] duration-200 ease-linear',
        collapsed ? 'md:left-[3rem]' : 'md:left-[16rem]',
        className
      )}
    >
      {children}
    </div>
  );
}
