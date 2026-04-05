import { ReactNode } from 'react';
import { useScrollFadeIn } from '@/hooks/useScrollFadeIn';
import { cn } from '@/lib/utils';

interface ScrollFadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export default function ScrollFadeIn({ children, className, delay = 0 }: ScrollFadeInProps) {
  const { ref, isVisible } = useScrollFadeIn(0.12);

  return (
    <div
      ref={ref}
      className={cn(
        'transition-all duration-700 ease-out',
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8',
        className
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
