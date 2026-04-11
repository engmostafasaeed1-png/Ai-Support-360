import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from 'react-router-dom';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/pricing'];

export default function Watermark() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const location = useLocation();
  const isProtected = !PUBLIC_PATHS.some(p => location.pathname === p);

  useEffect(() => {
    if (!isProtected) return;

    const drawWatermark = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const label = user?.email || 'Qurtuba Talks — Confidential';
      const timestamp = new Date().toISOString().slice(0, 10);
      const text = `${label} · ${timestamp} · CONFIDENTIAL`;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '13px Inter, sans-serif';
      ctx.fillStyle = 'rgba(100, 100, 100, 0.07)';
      ctx.textAlign = 'center';

      const angle = -Math.PI / 8;
      const spacingX = 320;
      const spacingY = 160;

      for (let x = -200; x < canvas.width + 200; x += spacingX) {
        for (let y = -200; y < canvas.height + 200; y += spacingY) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    };

    drawWatermark();
    window.addEventListener('resize', drawWatermark);
    return () => window.removeEventListener('resize', drawWatermark);
  }, [isProtected]);

  if (!isProtected) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[99997] pointer-events-none"
      aria-hidden="true"
    />
  );
}
