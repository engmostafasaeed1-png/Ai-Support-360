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
        'h-14 flex items-center justify-between border-b border-border/50 px-4 bg-white backdrop-blur-xl fixed top-0 right-0 left-0 z-40 shadow-sm transition-[left] duration-200 ease-linear',
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
        'border-b border-border/30 bg-white backdrop-blur-sm fixed top-14 right-0 left-0 z-30 block transition-[left] duration-200 ease-linear shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
        collapsed ? 'md:left-[3rem]' : 'md:left-[16rem]',
        className
      )}
    >
      {children}
    </div>
  );
}
