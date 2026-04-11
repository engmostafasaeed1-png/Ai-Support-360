import { useEffect, useState } from 'react';

export function useDevToolsDetection(): boolean {
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  useEffect(() => {
    const threshold = 160;

    const check = () => {
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;
      setDevToolsOpen(widthDiff || heightDiff);
    };

    const interval = setInterval(check, 1500);
    window.addEventListener('resize', check);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', check);
    };
  }, []);

  return devToolsOpen;
}
