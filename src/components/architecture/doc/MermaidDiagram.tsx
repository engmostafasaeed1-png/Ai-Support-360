import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { layoutGraph, parseMermaid } from '@/lib/architecture/mermaid';

/**
 * Draws Mermaid flowchart text with React SVG elements only (labels are text nodes): no HTML, no scripts, no
 * external renderer. Lines the reader does not understand are listed under the drawing.
 */
export default function MermaidDiagram({ source, caption }: { source: string; caption?: string }) {
  const { t } = useTranslation();
  const { graph, layout } = useMemo(() => {
    const g = parseMermaid(source);
    return { graph: g, layout: layoutGraph(g) };
  }, [source]);
  if (!graph.nodes.length) {
    return <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-3">{t('arch.diagram.emptyMermaid')}</p>;
  }
  const label = caption || t('arch.diagram.mermaidLabel', { count: graph.nodes.length });
  return (
    <figure className="space-y-1">
      <div className="overflow-x-auto rounded-xl border border-border bg-card p-2">
        <svg role="img" aria-label={label} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} className="max-w-full h-auto text-foreground">
          <defs>
            <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" className="fill-muted-foreground" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => (
            <g key={`e${i}`}>
              <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className="stroke-muted-foreground" strokeWidth={e.thick ? 3 : 1.5}
                strokeDasharray={e.dashed ? '5 4' : undefined} markerEnd={e.arrow ? 'url(#arch-arrow)' : undefined} />
              {e.label && <text x={(e.x1 + e.x2) / 2} y={(e.y1 + e.y2) / 2 - 4} textAnchor="middle" fontSize={11} className="fill-muted-foreground">{e.label}</text>}
            </g>
          ))}
          {layout.nodes.map((n) => {
            const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
            const shape = n.shape === 'diamond'
              ? <polygon points={`${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`} className="fill-primary/10 stroke-primary" strokeWidth={1.5} />
              : n.shape === 'circle'
                ? <ellipse cx={cx} cy={cy} rx={n.w / 2} ry={n.h / 2} className="fill-primary/10 stroke-primary" strokeWidth={1.5} />
                : <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.shape === 'round' ? 16 : 6} className="fill-primary/10 stroke-primary" strokeWidth={1.5} />;
            return <g key={n.id}>{shape}<text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} className="fill-foreground">{n.label}</text></g>;
          })}
        </svg>
      </div>
      {caption && <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>}
      {graph.problems.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{t('arch.diagram.skipped', { lines: graph.problems.map((p) => p.line).join(', ') })}</p>
      )}
    </figure>
  );
}
