import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Eraser, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SIGNATURE_RULES, type Stroke } from '@/lib/nda/api';

export interface SignaturePadHandle {
  clear(): void;
  undo(): void;
  /** White PNG (1200 x 400) with navy ink: the file stored as evidence and printed in the PDF. */
  toPng(): string;
}

interface Props {
  onChange(strokes: Stroke[]): void;
  label: string;
  hint: string;
  clearLabel: string;
  undoLabel: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}

const W = SIGNATURE_RULES.canvasWidth;
const Hh = SIGNATURE_RULES.canvasHeight;
// PNG colours are fixed on purpose: the stored evidence and the PDF must look the same in every theme.
const PNG_PAPER = '#ffffff';
const PNG_INK = '#1B2559';

function cssColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], scale: number, ink: string, width: number) {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.length) continue;
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x * scale, s[0].y * scale, width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0].x * scale, s[0].y * scale);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x * scale, s[i].y * scale);
    ctx.stroke();
  }
}

export function strokesToPng(strokes: Stroke[]): string {
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = Hh * 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PNG_PAPER;
  ctx.fillRect(0, 0, c.width, c.height);
  paint(ctx, strokes, 2, PNG_INK, 5);
  return c.toDataURL('image/png');
}

/** Typed alternative (only when the admin allows it): the name in a handwriting style, same PNG size. */
export function typedToPng(text: string): string {
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = Hh * 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PNG_PAPER;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = PNG_INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 110;
  const font = (s: number) => `italic ${s}px "Segoe Script", "Brush Script MT", "Noto Naskh Arabic", "IBM Plex Sans Arabic", cursive`;
  ctx.font = font(size);
  while (size > 30 && ctx.measureText(text).width > c.width - 80) { size -= 6; ctx.font = font(size); }
  ctx.fillText(text, c.width / 2, c.height / 2);
  return c.toDataURL('image/png');
}

/**
 * Free-hand signature pad (mouse, finger, stylus). Pointer events with pointer capture; only the pad itself blocks
 * scrolling (touch-action: none), so the page scrolls normally around it and never jumps while drawing.
 */
const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad({ onChange, label, hint, clearLabel, undoLabel, describedBy, invalid, disabled }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<number | null>(null);

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const scale = c.width / W;
    ctx.clearRect(0, 0, c.width, c.height);
    // signing line (screen only, not in the PNG)
    ctx.strokeStyle = cssColor('--border', '#cbd5e1');
    ctx.lineWidth = Math.max(1, scale);
    ctx.setLineDash([6 * scale, 6 * scale]);
    ctx.beginPath();
    ctx.moveTo(24 * scale, Hh * 0.78 * scale);
    ctx.lineTo((W - 24) * scale, Hh * 0.78 * scale);
    ctx.stroke();
    ctx.setLineDash([]);
    paint(ctx, strokes.current, scale, cssColor('--signature-ink', PNG_INK), 2.6 * scale);
  }, []);

  // keep the bitmap sharp at any width / pixel ratio
  useEffect(() => {
    const el = wrap.current, c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const cssW = el.clientWidth || W;
      c.style.width = `${cssW}px`;
      c.style.height = `${(cssW * Hh) / W}px`;
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(((cssW * Hh) / W) * dpr);
      redraw();
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const obs = new MutationObserver(redraw);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    mq?.addEventListener?.('change', redraw);
    return () => { ro?.disconnect(); obs.disconnect(); mq?.removeEventListener?.('change', redraw); };
  }, [redraw]);

  const pos = (e: PointerEvent | React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max(((e.clientX - r.left) / r.width) * W, 0), W) * 10) / 10,
      y: Math.round(Math.min(Math.max(((e.clientY - r.top) / r.height) * Hh, 0), Hh) * 10) / 10,
    };
  };

  const emit = () => onChange(strokes.current.map((s) => s.slice()));

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    canvas.current?.setPointerCapture(e.pointerId);
    drawing.current = e.pointerId;
    strokes.current = [...strokes.current, [pos(e)]];
    redraw();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current !== e.pointerId) return;
    e.preventDefault();
    const cur = strokes.current[strokes.current.length - 1];
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const events = native.getCoalescedEvents?.() ?? [native];
    for (const ev of events.length ? events : [native]) {
      const p = pos(ev);
      const last = cur[cur.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.8) cur.push(p);
    }
    redraw();
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current !== e.pointerId) return;
    drawing.current = null;
    try { canvas.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    emit();
  };

  useImperativeHandle(ref, () => ({
    clear() { strokes.current = []; redraw(); emit(); },
    undo() { strokes.current = strokes.current.slice(0, -1); redraw(); emit(); },
    toPng() { return strokesToPng(strokes.current); },
  }), [redraw]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div
        ref={wrap}
        className={`relative overflow-hidden rounded-xl border-2 bg-signature-paper ${invalid ? 'border-destructive/70' : 'border-dashed border-border'}`}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={label}
          aria-describedby={describedBy}
          className="block w-full cursor-crosshair select-none"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()}
        />
        <span className="pointer-events-none absolute bottom-2 start-3 text-[11px] text-signature-ink/60">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { strokes.current = strokes.current.slice(0, -1); redraw(); emit(); }} busy={disabled}>
          <Undo2 className="h-3.5 w-3.5" aria-hidden /> {undoLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { strokes.current = []; redraw(); emit(); }} busy={disabled}>
          <Eraser className="h-3.5 w-3.5" aria-hidden /> {clearLabel}
        </Button>
      </div>
    </div>
  );
});

export default SignaturePad;
