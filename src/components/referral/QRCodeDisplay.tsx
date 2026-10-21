import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import qrcode from 'qrcode-generator';

interface Props {
  url: string;
  /** File name for the download. */
  fileName?: string;
}

// Scanners need dark modules on a light square in both themes: brand navy on white (the image itself, not page chrome).
const DARK = '#1B2559';
const LIGHT = '#FFFFFF';

/** A real, scannable QR code of the link, generated in the browser (nothing is sent anywhere). */
export default function QRCodeDisplay({ url, fileName = 'aisupport360-referral-qr.png' }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const qr = qrcode(0, 'M');
    qr.addData(url, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const cell = Math.max(4, Math.floor(240 / (count + margin * 2)));
    const size = (count + margin * 2) * cell;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = LIGHT;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = DARK;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
      }
    }
  }, [url]);

  const downloadQR = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = fileName;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="flex flex-col items-center gap-3 py-4 bg-muted/20 rounded-xl">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('refz.qr_alt', 'QR code of your referral link')}
        className="rounded-lg border shadow-sm"
        style={{ width: 180, height: 180 }}
      />
      <p className="text-[11px] text-muted-foreground">{t('refz.qr_hint', 'Scan to open your referral link')}</p>
      <button type="button" onClick={downloadQR} className="text-xs text-primary hover:underline">
        {t('refz.qr_download', 'Download QR code')}
      </button>
    </div>
  );
}
