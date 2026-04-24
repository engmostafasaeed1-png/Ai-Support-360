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

  // Respect users who prefer reduced motion: skip the crossfade entirely.
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const transition = prefersReducedMotion
    ? undefined
    : { transitionDuration: `${fadeMs}ms` };

  return (
    <>
      {/* Blurred low-res placeholder */}
      <img
        src={blurSrc}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        className={`${className} scale-110 blur-xl motion-safe:transition-opacity motion-safe:ease-out ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`}
        style={transition}
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
        className={`${className} motion-safe:transition-opacity motion-safe:ease-out ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        style={transition}
      />
    </>
  );
}
