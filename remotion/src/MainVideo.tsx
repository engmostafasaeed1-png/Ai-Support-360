import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig, staticFile } from 'remotion';

export const FPS = 30;
const PORTRAITS = [
  { src: 'portraits/c01-gulf.jpg',      label: 'Dubai · UAE' },
  { src: 'portraits/c02-european.jpg',  label: 'Berlin · Germany' },
  { src: 'portraits/c03-indian.jpg',    label: 'Bengaluru · India' },
  { src: 'portraits/c04-japanese.jpg',  label: 'Tokyo · Japan' },
  { src: 'portraits/c05-african.jpg',   label: 'Lagos · Nigeria' },
  { src: 'portraits/c06-latin.jpg',     label: 'Mexico City · MX' },
  { src: 'portraits/c07-pakistani.jpg', label: 'Karachi · Pakistan' },
  { src: 'portraits/c08-moroccan.jpg',  label: 'Casablanca · MA' },
  { src: 'portraits/c09-nordic.jpg',    label: 'Stockholm · Sweden' },
  { src: 'portraits/c10-korean.jpg',    label: 'Seoul · Korea' },
  { src: 'portraits/c11-brazilian.jpg', label: 'São Paulo · Brazil' },
  { src: 'portraits/c12-british.jpg',   label: 'London · UK' },
];

const FRAMES_PER_SLIDE = 60; // 2 seconds each
const CROSSFADE = 18;
const TOTAL_SLIDES = PORTRAITS.length;
export const DURATION_IN_FRAMES = FRAMES_PER_SLIDE * TOTAL_SLIDES; // 24s loop

const Slide: React.FC<{ src: string; label: string; index: number }> = ({ src, label, index }) => {
  const frame = useCurrentFrame();

  // Crossfade in/out
  const opacity = interpolate(
    frame,
    [0, CROSSFADE, FRAMES_PER_SLIDE - CROSSFADE, FRAMES_PER_SLIDE],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Ken-Burns: subtle zoom + drift, alternating direction
  const dir = index % 2 === 0 ? 1 : -1;
  const scale = interpolate(frame, [0, FRAMES_PER_SLIDE], [1.05, 1.18], { extrapolateRight: 'clamp' });
  const tx = interpolate(frame, [0, FRAMES_PER_SLIDE], [0, 18 * dir], { extrapolateRight: 'clamp' });
  const ty = interpolate(frame, [0, FRAMES_PER_SLIDE], [0, -10], { extrapolateRight: 'clamp' });

  // Light sweep across image once per slide
  const sweepX = interpolate(
    frame,
    [FRAMES_PER_SLIDE * 0.25, FRAMES_PER_SLIDE * 0.75],
    [-60, 160],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const sweepOpacity = interpolate(
    frame,
    [FRAMES_PER_SLIDE * 0.25, FRAMES_PER_SLIDE * 0.5, FRAMES_PER_SLIDE * 0.75],
    [0, 0.45, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Label slides up from bottom
  const labelY = interpolate(frame, [CROSSFADE, CROSSFADE + 20], [40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const labelOpacity = interpolate(frame, [CROSSFADE, CROSSFADE + 20, FRAMES_PER_SLIDE - CROSSFADE, FRAMES_PER_SLIDE], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 30%',
            transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
            transformOrigin: 'center center',
          }}
        />

        {/* Color grade overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(7,15,40,0.15) 0%, rgba(7,15,40,0.0) 35%, rgba(7,15,40,0.55) 85%, rgba(7,15,40,0.85) 100%)',
            mixBlendMode: 'multiply',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 50% 35%, rgba(56,189,248,0.18) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse at 80% 90%, rgba(245,158,11,0.18) 0%, rgba(0,0,0,0) 55%)',
            mixBlendMode: 'screen',
          }}
        />

        {/* Light sweep */}
        <div
          style={{
            position: 'absolute',
            top: '-10%',
            bottom: '-10%',
            left: `${sweepX}%`,
            width: '30%',
            transform: 'skewX(-18deg)',
            background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)',
            opacity: sweepOpacity,
            filter: 'blur(20px)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Caption */}
      <div
        style={{
          position: 'absolute',
          left: 48,
          right: 48,
          bottom: 64,
          opacity: labelOpacity,
          transform: `translateY(${labelY}px)`,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(16,185,129,0.18)',
            border: '1px solid rgba(110,231,183,0.45)',
            color: '#d1fae5',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            fontFamily: 'sans-serif',
            marginBottom: 16,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: '#34d399',
              boxShadow: '0 0 12px #34d399',
            }}
          />
          Vetted SAP Expert
        </div>
        <div
          style={{
            color: 'white',
            fontSize: 56,
            fontWeight: 800,
            lineHeight: 1.05,
            fontFamily: 'sans-serif',
            textShadow: '0 4px 24px rgba(0,0,0,0.6)',
          }}
        >
          On-demand SAP talent
        </div>
        <div
          style={{
            color: 'rgba(255,255,255,0.78)',
            fontSize: 28,
            marginTop: 8,
            fontFamily: 'sans-serif',
            textShadow: '0 2px 12px rgba(0,0,0,0.6)',
          }}
        >
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const MainVideo: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  // Animated mesh backdrop (visible during crossfades)
  const meshShift = Math.sin((frame / durationInFrames) * Math.PI * 4) * 40;

  return (
    <AbsoluteFill style={{ background: '#070f28' }}>
      {/* Persistent mesh blobs */}
      <div
        style={{
          position: 'absolute',
          left: `${20 + meshShift / 8}%`,
          top: '10%',
          width: '70%',
          height: '70%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56,189,248,0.55) 0%, rgba(56,189,248,0) 60%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: `${10 - meshShift / 10}%`,
          bottom: '5%',
          width: '70%',
          height: '70%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.55) 0%, rgba(124,58,237,0) 60%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Slides */}
      {PORTRAITS.map((p, i) => (
        <Sequence key={i} from={i * FRAMES_PER_SLIDE} durationInFrames={FRAMES_PER_SLIDE + CROSSFADE}>
          <Slide src={p.src} label={p.label} index={i} />
        </Sequence>
      ))}

      {/* Bottom progress bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 4,
          background: 'rgba(255,255,255,0.08)',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${(frame / durationInFrames) * 100}%`,
            background: 'linear-gradient(90deg, #38bdf8, #f59e0b)',
            boxShadow: '0 0 18px rgba(56,189,248,0.6)',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
