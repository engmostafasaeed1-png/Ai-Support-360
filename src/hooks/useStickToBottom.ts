import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isNearBottom, scrollBehavior } from '@/lib/scrollUtils';

/**
 * Keeps a message list anchored to the newest message while the reader is at the bottom (or just sent one).
 * When they have scrolled up to read, new messages raise `hasNew` instead of yanking the view.
 */
export function useStickToBottom<T extends HTMLElement>(count: number, lastIsMine: boolean) {
  const ref = useRef<T>(null);
  const atBottom = useRef(true);
  const prevCount = useRef(0);
  const [hasNew, setHasNew] = useState(false);

  const jump = useCallback((smooth = true) => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: smooth ? scrollBehavior() : ('instant' as ScrollBehavior) });
    else el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setHasNew(false);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onScroll = () => {
      atBottom.current = isNearBottom(el);
      if (atBottom.current) setHasNew(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const first = prevCount.current === 0;
    const grew = count > prevCount.current;
    prevCount.current = count;
    if (!grew) return;
    if (first || atBottom.current || lastIsMine) jump(!first);
    else setHasNew(true);
  }, [count, lastIsMine, jump]);

  return { ref, hasNew, jump };
}
