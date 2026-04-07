import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';

interface PageTransitionProps {
  children: React.ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [displayChildren, setDisplayChildren] = useState(children);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (location.pathname !== prevPath.current) {
      setIsVisible(false);
      const timer = setTimeout(() => {
        setDisplayChildren(children);
        setIsVisible(true);
        prevPath.current = location.pathname;
      }, 80);
      return () => clearTimeout(timer);
    } else {
      setDisplayChildren(children);
      setIsVisible(true);
    }
  }, [location.pathname, children]);

  return (
    <div
      className={`transition-all duration-400 ease-out will-change-[opacity,transform] ${
        isVisible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-2 scale-[0.995]'
      }`}
    >
      {displayChildren}
    </div>
  );
}
