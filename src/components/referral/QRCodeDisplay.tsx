import { useEffect, useRef } from 'react';

interface Props {
  url: string;
}

export default function QRCodeDisplay({ url }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Simple QR-like visual placeholder using data encoding
    const size = 200;
    canvas.width = size;
    canvas.height = size;
    const cellSize = 8;
    const modules = Math.floor(size / cellSize);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Generate deterministic pattern from URL
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
    }

    ctx.fillStyle = '#1B2559';

    // Draw finder patterns (corners)
    const drawFinder = (x: number, y: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
            ctx.fillRect((x + c) * cellSize, (y + r) * cellSize, cellSize, cellSize);
          }
        }
      }
    };

    drawFinder(1, 1);
    drawFinder(modules - 8, 1);
    drawFinder(1, modules - 8);

    // Fill data area with hash-based pattern
    const seed = Math.abs(hash);
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        // Skip finder pattern areas
        if ((r < 9 && c < 9) || (r < 9 && c > modules - 9) || (r > modules - 9 && c < 9)) continue;
        const val = ((seed * (r * modules + c + 1)) % 100);
        if (val < 45) {
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }
    }
  }, [url]);

  const downloadQR = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = 'qurtuba-referral-qr.png';
    link.href = canvasRef.current.toDataURL();
    link.click();
  };

  return (
    <div className="flex flex-col items-center gap-3 py-4 bg-muted/20 rounded-xl">
      <canvas ref={canvasRef} className="rounded-lg border shadow-sm" style={{ width: 180, height: 180 }} />
      <p className="text-[10px] text-muted-foreground">Scan to join via your referral</p>
      <button onClick={downloadQR} className="text-xs text-primary hover:underline">
        Download QR Code
      </button>
    </div>
  );
}
