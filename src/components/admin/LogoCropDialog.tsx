import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2 } from 'lucide-react';

type Props = {
  /** Object URL or data URL of the source image to crop. */
  imageSrc: string | null;
  open: boolean;
  onCancel: () => void;
  /** Receives a square PNG Blob (transparent background preserved). */
  onConfirm: (blob: Blob) => Promise<void> | void;
};

/**
 * Square (1:1) image cropper used by the admin to prepare client logos
 * before upload. Outputs a 512×512 PNG with transparency preserved.
 */
export default function LogoCropDialog({ imageSrc, open, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!imageSrc || !pixels) return;
    setBusy(true);
    try {
      const blob = await cropToBlob(imageSrc, pixels);
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
            Adjust the square crop. The logo will be saved as a transparent 512×512 PNG.
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

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={busy || !pixels}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
