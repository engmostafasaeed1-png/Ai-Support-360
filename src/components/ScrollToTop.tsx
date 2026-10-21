import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { readScrollPosition, saveScrollPosition, scrollActionFor, scrollBehavior } from "@/lib/scrollUtils";

/**
 * Window scroll on navigation: new pages start at the top, back/forward restores where the reader was,
 * query-only changes (tabs, filters) keep the position, and "#section" links scroll to the section.
 */
const ScrollToTop = () => {
  const { pathname, hash, key } = useLocation();
  const navType = useNavigationType();
  const currentKey = useRef(key);
  currentKey.current = key; // set during render, before the new page reaches the screen
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    try {
      if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    } catch {
      /* ignore */
    }
  }, []);

  // Remember this history entry's position while the reader scrolls.
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (currentKey.current === key) saveScrollPosition(key, window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);

  useLayoutEffect(() => {
    const pathChanged = prevPath.current !== null && prevPath.current !== pathname;
    const first = prevPath.current === null;
    prevPath.current = pathname;
    if (first && navType !== "POP") return;
    const action = scrollActionFor({ navType, pathChanged: pathChanged || first, hash, saved: readScrollPosition(key) });
    if (action.kind === "top") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
      return;
    }
    if (action.kind !== "restore") return;
    // The page may still be loading: wait (up to ~1.5 s) until it is tall enough, unless the reader scrolls first.
    let tries = 0;
    let cancelled = false;
    const stop = () => {
      cancelled = true;
    };
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener("wheel", stop, opts);
    window.addEventListener("touchstart", stop, opts);
    window.addEventListener("keydown", stop);
    const timer = window.setInterval(() => {
      const tallEnough = document.documentElement.scrollHeight >= action.y + window.innerHeight;
      if (cancelled || tallEnough || ++tries > 30) {
        window.clearInterval(timer);
        if (!cancelled) window.scrollTo({ top: action.y, left: 0, behavior: "instant" as ScrollBehavior });
      }
    }, 50);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [pathname, key, hash, navType]);

  // "/#pricing" from another page: the section only exists once the lazy landing page has loaded, so look for it for a moment
  useEffect(() => {
    if (!hash) return undefined;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep the raw text */
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
        window.clearInterval(timer);
      } else if (++tries > 25) {
        window.clearInterval(timer);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
