import { ReactNode, useEffect, useRef } from 'react';
import { observeReveal } from '@/lib/reveal';

interface ScrollFadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Visible by default; a below-the-screen section fades/slides in once when reached (see lib/reveal). */
export default function ScrollFadeIn({ children, className, delay = 0 }: ScrollFadeInProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    return el ? observeReveal([el]) : undefined;
  }, []);

  return (
    <div ref={ref} className={className} style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}>
      {children}
    </div>
  );
}
