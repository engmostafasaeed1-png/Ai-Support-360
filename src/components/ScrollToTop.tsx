import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const ScrollToTop = () => {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (hash) return; // a link to a section of a page: the effect below scrolls to it
    if (navType !== "POP") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [pathname, hash, navType]);

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
        el.scrollIntoView({ behavior: "smooth", block: "start" });
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
