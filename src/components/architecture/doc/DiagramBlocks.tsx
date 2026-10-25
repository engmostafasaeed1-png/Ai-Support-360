import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ImagePlus, Trash2, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { assetUrl, uploadArchAsset, type ArchAsset } from '@/lib/architecture/api';
import { sanitizeSvg, sniffImage } from '@/lib/architecture/svgSanitize';
import { LIMITS, diagramFileProblem, diagramId, type Diagram, type DiagramMime } from '../../../../supabase/functions/_shared/archModel';
import MermaidDiagram from './MermaidDiagram';

const SAMPLE = 'graph LR\n  S4[S/4HANA] -->|IDoc| CPI(Integration Suite)\n  CPI --> BANK[Bank]';

/** Uploaded picture through a short-lived link, shown only as <img> (browsers never run scripts there). */
export function AssetImage({ asset, alt }: { asset: ArchAsset | undefined; alt: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (!asset) { setFailed(true); return; }
    void assetUrl(asset.path).then((u) => { if (live) { setUrl(u); setFailed(!u); } });
    return () => { live = false; };
  }, [asset]);
  if (failed) return <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-3">{t('arch.diagram.missing')}</p>;
  if (!url) return <div className="h-32 rounded-xl bg-muted animate-pulse" />;
  return <img src={url} alt={alt} className="max-w-full max-h-[480px] rounded-xl border border-border bg-card object-contain" loading="lazy" referrerPolicy="no-referrer" />;
}

export function DiagramView({ d, assets }: { d: Diagram; assets: ArchAsset[] }) {
  const { t } = useTranslation();
  if (d.kind === 'mermaid') return <MermaidDiagram source={d.source} caption={d.caption} />;
  return (
    <figure className="space-y-1">
      <AssetImage asset={assets.find((a) => a.id === d.asset_id)} alt={d.caption || t('arch.diagram.picture')} />
      {d.caption && <figcaption className="text-xs text-muted-foreground">{d.caption}</figcaption>}
    </figure>
  );
}

interface Props {
  docId: string;
  diagrams: Diagram[];
  assets: ArchAsset[];
  onChange: (d: Diagram[]) => void;
  onAsset: (a: ArchAsset) => void;
}

/** Diagram blocks of one section: uploaded PNG / JPG / SVG (cleaned) or Mermaid flowchart text. */
export default function DiagramBlocks({ docId, diagrams, assets, onChange, onAsset }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const full = diagrams.length >= LIMITS.diagramsPerSection;
  const update = (i: number, patch: Partial<Diagram>) => onChange(diagrams.map((d, j) => (j === i ? ({ ...d, ...patch } as Diagram) : d)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= diagrams.length) return;
    const next = [...diagrams];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const upload = async (file: File) => {
    const problem = diagramFileProblem(file);
    if (problem) { toast.error(t(problem === 'type' ? 'arch.diagram.badType' : 'arch.diagram.tooBig')); return; }
    setBusy(true);
    try {
      let blob: Blob = file;
      let mime = file.type as DiagramMime;
      if (mime === 'image/svg+xml') {
        const clean = sanitizeSvg(await file.text());
        if (!clean) { toast.error(t('arch.diagram.badSvg')); return; }
        blob = new Blob([clean], { type: 'image/svg+xml' });
      } else {
        const sniffed = sniffImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
        if (!sniffed) { toast.error(t('arch.diagram.badType')); return; }
        mime = sniffed;
      }
      const r = await uploadArchAsset(docId, blob, mime, file.name);
      if (r.error || !r.data) { toast.error(r.error?.message ?? t('arch.common.failed')); return; }
      onAsset(r.data);
      onChange([...diagrams, { id: diagramId(), kind: 'image', asset_id: r.data.id, caption: '' }]);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {diagrams.map((d, i) => (
        <div key={d.id} className="rounded-xl border border-border p-3 space-y-2">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-muted-foreground me-auto">{d.kind === 'mermaid' ? t('arch.diagram.mermaid') : t('arch.diagram.picture')} {i + 1}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('arch.diagram.up')} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('arch.diagram.down')} disabled={i === diagrams.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('arch.diagram.remove')} onClick={() => onChange(diagrams.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
          {d.kind === 'mermaid' && (
            <Textarea dir="ltr" rows={5} className="font-mono text-xs" value={d.source} maxLength={LIMITS.mermaidChars}
              aria-label={t('arch.diagram.mermaidText')} onChange={(e) => update(i, { source: e.target.value })} />
          )}
          <DiagramView d={d} assets={assets} />
          <Input value={d.caption} maxLength={LIMITS.caption} placeholder={t('arch.diagram.caption')} aria-label={t('arch.diagram.caption')}
            onChange={(e) => update(i, { caption: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" className="sr-only" tabIndex={-1}
          aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" disabled={busy || full} onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" /> {busy ? t('arch.diagram.uploading') : t('arch.diagram.addPicture')}
        </Button>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" disabled={full}
          onClick={() => onChange([...diagrams, { id: diagramId(), kind: 'mermaid', source: SAMPLE, caption: '' }])}>
          <Workflow className="h-3.5 w-3.5" /> {t('arch.diagram.addMermaid')}
        </Button>
        <span className="text-[11px] text-muted-foreground self-center">{t('arch.diagram.rules')}</span>
      </div>
    </div>
  );
}
