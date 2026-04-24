import { useEffect, useRef, useState, useCallback, PointerEvent as ReactPointerEvent } from "react";

export interface DraggableFabState {
  /** Inline style to apply to the floating element. */
  style: React.CSSProperties;
  /** Pointer-down handler — attach to a drag handle. */
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /** True while user is actively dragging — use to suppress click. */
  isDragging: boolean;
  /** Resets to default position. */
  reset: () => void;
}

interface Options {
  /** Unique key used to persist position in localStorage. */
  storageKey: string;
  /** Pixel size of the element (square). Used to clamp inside viewport. */
  size?: number;
  /** Pixels of movement required before treating as a drag (vs. click). */
  dragThreshold?: number;
}

/**
 * Makes a fixed-position floating button draggable around the viewport.
 * Position is persisted across sessions and clamped to the visible area on resize.
 */
export function useDraggableFab({
  storageKey,
  size = 56,
  dragThreshold = 5,
}: Options): DraggableFabState {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return parsed;
    } catch { /* ignore */ }
    return null;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{
    startX: number; startY: number;
    originX: number; originY: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);

  const clamp = useCallback((x: number, y: number) => {
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - size - margin);
    const maxY = Math.max(margin, window.innerHeight - size - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  }, [size]);

  // Re-clamp when viewport changes
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos, clamp]);

  const persist = useCallback((p: { x: number; y: number }) => {
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* ignore */ }
  }, [storageKey]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // Only left click / primary touch
    if (e.button !== undefined && e.button !== 0) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      pointerId: e.pointerId,
      moved: false,
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragState.current || ev.pointerId !== dragState.current.pointerId) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      if (!dragState.current.moved && Math.hypot(dx, dy) < dragThreshold) return;
      if (!dragState.current.moved) {
        dragState.current.moved = true;
        setIsDragging(true);
        try { target.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      }
      ev.preventDefault();
      const next = clamp(dragState.current.originX + dx, dragState.current.originY + dy);
      setPos(next);
    };

    const onUp = (ev: PointerEvent) => {
      if (!dragState.current || ev.pointerId !== dragState.current.pointerId) return;
      const moved = dragState.current.moved;
      try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragState.current = null;
      if (moved) {
        // Suppress the upcoming click
        const suppress = (clickEv: MouseEvent) => {
          clickEv.preventDefault();
          clickEv.stopPropagation();
          window.removeEventListener("click", suppress, true);
        };
        window.addEventListener("click", suppress, true);
        // Persist final position
        setPos((p) => { if (p) persist(p); return p; });
        // Slight delay before clearing isDragging so consumer sees it
        setTimeout(() => setIsDragging(false), 0);
      } else {
        setIsDragging(false);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [clamp, dragThreshold, persist]);

  const reset = useCallback(() => {
    setPos(null);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [storageKey]);

  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, right: "auto", bottom: "auto", touchAction: "none", cursor: isDragging ? "grabbing" : "grab" }
    : { touchAction: "none", cursor: isDragging ? "grabbing" : "grab" };

  return { style, onPointerDown, isDragging, reset };
}
