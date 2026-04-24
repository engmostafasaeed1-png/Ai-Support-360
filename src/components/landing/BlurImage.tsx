import { useEffect, useRef, useState } from 'react';

type Props = {
  src: string;
  blurSrc: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** Fade duration in ms */
  fadeMs?: number;
};

/**
 * Image with a tiny blurred placeholder shown until the full asset loads.
 * - Uses native lazy-loading + async decoding to avoid blocking the main thread.
 * - Placeholder is rendered behind the image and reserves the same box, so
 *   there's no layout shift (the wrapper sets aspect-ratio via width/height).
 */
export default function BlurImage({
  src,
  blurSrc,
  alt,
  width,
  height,
  className = '',
  fadeMs = 500,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Handle the case where the image is already cached when mounted.
  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  return (
    <>
      {/* Blurred low-res placeholder */}
      <img
        src={blurSrc}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        className={`${className} scale-110 blur-xl transition-opacity ease-out ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ transitionDuration: `${fadeMs}ms` }}
      />
      {/* Full-res image */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`${className} transition-opacity ease-out ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transitionDuration: `${fadeMs}ms` }}
      />
    </>
  );
}
