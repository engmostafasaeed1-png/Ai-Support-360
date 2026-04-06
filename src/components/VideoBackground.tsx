import { useEffect, useRef, useState } from 'react';

interface VideoBackgroundProps {
  src: string;
  overlay?: 'dark' | 'light' | 'gradient';
  overlayOpacity?: number;
  className?: string;
  children?: React.ReactNode;
}

export default function VideoBackground({
  src,
  overlay = 'dark',
  overlayOpacity = 0.6,
  className = '',
  children,
}: VideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = 0.75;
    }
  }, []);

  const overlayClasses = {
    dark: 'bg-foreground',
    light: 'bg-background',
    gradient: '',
  };

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        onCanPlay={() => setLoaded(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <source src={src} type="video/mp4" />
      </video>
      {overlay === 'gradient' ? (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, hsl(var(--primary) / ${overlayOpacity}), hsl(var(--accent) / ${overlayOpacity * 0.6}))`,
          }}
        />
      ) : (
        <div
          className={`absolute inset-0 ${overlayClasses[overlay]}`}
          style={{ opacity: overlayOpacity }}
        />
      )}
      {children}
    </div>
  );
}
