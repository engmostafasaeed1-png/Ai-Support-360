import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  /** Object URL or data URL of the source image to crop. */
  imageSrc: string | null;
  open: boolean;
  onCancel: () => void;
  /** Receives a square PNG Blob (transparent background preserved). */
  onConfirm: (blob: Blob) => Promise<void> | void;
};

/** Server-side limit (mirrored from the validate-client-logo edge function). */
const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB

/**
 * Square (1:1) image cropper used by the admin to prepare client logos
 * before upload. Outputs a 512×512 PNG with transparency preserved.
 *
 * Includes a live size indicator: after each crop change we re-encode
 * the cropped PNG to measure its size, and disable the confirm button
 * if it exceeds the 2 MB server-side limit. This avoids a round-trip
 * just to be told the file is too big.
 */
export default function LogoCropDialog({ imageSrc, open, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  // Live size measurement of the encoded PNG.
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  // Cache the most recently encoded blob so confirm doesn't re-encode.
  const lastBlobRef = useRef<Blob | null>(null);
  const lastSigRef = useRef<string | null>(null);

  // Reset transient state whenever a new image is loaded or dialog closes.
  useEffect(() => {
    if (!open) {
      setSizeBytes(null);
      setMeasuring(false);
      lastBlobRef.current = null;
      lastSigRef.current = null;
      setPixels(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    }
  }, [open, imageSrc]);

  const handleCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  // Debounced re-encode after the user stops dragging/zooming.
  useEffect(() => {
    if (!open || !imageSrc || !pixels) return;
    const sig = `${pixels.x}|${pixels.y}|${pixels.width}|${pixels.height}`;
    if (sig === lastSigRef.current) return;

    let cancelled = false;
    setMeasuring(true);
    const t = window.setTimeout(async () => {
      try {
        const blob = await cropToBlob(imageSrc, pixels);
        if (cancelled) return;
        lastBlobRef.current = blob;
        lastSigRef.current = sig;
        setSizeBytes(blob.size);
      } catch {
        if (!cancelled) setSizeBytes(null);
      } finally {
        if (!cancelled) setMeasuring(false);
      }
    }, 250);

    return () => { cancelled = true; window.clearTimeout(t); };
  }, [open, imageSrc, pixels]);

  const overLimit = sizeBytes !== null && sizeBytes > MAX_BYTES;
  const canConfirm = !!pixels && !busy && !measuring && !overLimit && sizeBytes !== null;

  const handleConfirm = async () => {
    if (!imageSrc || !pixels) return;
    setBusy(true);
    try {
      // Reuse the cached blob from the size check when possible.
      const blob = lastBlobRef.current ?? (await cropToBlob(imageSrc, pixels));
      await onConfirm(blob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crop logo</DialogTitle>
          <DialogDescription>
            Adjust the square crop. The logo will be saved as a transparent 512×512 PNG (max 2 MB).
          </DialogDescription>
        </DialogHeader>

        <div className="relative w-full aspect-square bg-muted/40 rounded-xl overflow-hidden">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              showGrid
              restrictPosition={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Zoom</label>
          <Slider
            min={1}
            max={4}
            step={0.05}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0])}
          />
        </div>

        <SizeIndicator
          bytes={sizeBytes}
          measuring={measuring}
          overLimit={overLimit}
        />

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {overLimit ? 'Too large' : 'Save crop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline indicator that shows the current encoded PNG size relative to
 * the 2 MB cap. Turns destructive when the limit is exceeded.
 */
function SizeIndicator({
  bytes, measuring, overLimit,
}: { bytes: number | null; measuring: boolean; overLimit: boolean }) {
  const pct = bytes ? Math.min(100, Math.round((bytes / MAX_BYTES) * 100)) : 0;

  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          {measuring ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Measuring file size…</>
          ) : overLimit ? (
            <><AlertTriangle className="w-3 h-3 text-destructive" /> Exceeds 2 MB limit</>
          ) : bytes !== null ? (
            <><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Within 2 MB limit</>
          ) : (
            'File size'
          )}
        </span>
        <span className={cn('font-mono tabular-nums', overLimit ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
          {bytes !== null ? `${formatBytes(bytes)} / 2.0 MB` : '—'}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            overLimit ? 'bg-destructive' : pct > 80 ? 'bg-amber-500' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {overLimit && (
        <p className="text-[11px] text-destructive">
          Try a tighter crop or a simpler logo. Photos with gradients re-encode larger than flat vector marks.
        </p>
      )}
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Render the cropped region of a source image into a 512×512 PNG Blob,
 * preserving transparency (canvas is not pre-filled).
 */
async function cropToBlob(imageSrc: string, area: Area): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    img,
    area.x, area.y, area.width, area.height,
    0, 0, size, size
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode PNG'))),
      'image/png',
      0.92
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
