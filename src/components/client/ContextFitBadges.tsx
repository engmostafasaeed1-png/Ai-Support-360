// Why a recommended consultant fits the request: the context fit score and the matches and gaps returned by the matching.
import { Check } from 'lucide-react';

export interface ContextFit {
  context_fit_score?: number | null;
  context_matches?: string[] | null;
  context_gaps?: string[] | null;
}

/** Splits "Country: Saudi Arabia" into the prefix "Country:" and the label "Saudi Arabia" (two text nodes, so each can be translated). */
export function splitBadge(text: string): { prefix: string; label: string } {
  const i = text.indexOf(': ');
  if (i < 0) return { prefix: '', label: text };
  return { prefix: text.slice(0, i + 1), label: text.slice(i + 2) };
}

export default function ContextFitBadges({ fit, className = '' }: { fit: ContextFit | null | undefined; className?: string }) {
  if (!fit) return null;
  const score = typeof fit.context_fit_score === 'number' ? fit.context_fit_score : null;
  const matches = Array.isArray(fit.context_matches) ? fit.context_matches.filter(Boolean) : [];
  const gaps = Array.isArray(fit.context_gaps) ? fit.context_gaps.filter(Boolean) : [];
  if (score === null && matches.length === 0 && gaps.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 mt-1 ${className}`} data-testid="context-fit">
      {score !== null && (
        <span className="text-[11px] font-medium text-foreground me-1">
          <span>Context fit</span> <span>{Math.round(score)}%</span>
        </span>
      )}
      {matches.map(m => {
        const { prefix, label } = splitBadge(m);
        return (
          <span key={`m-${m}`} className="inline-flex items-center gap-0.5 rounded-full border border-success/30 bg-success/10 text-success px-1.5 py-0.5 text-[10px] max-w-full break-words">
            <Check className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
            {prefix ? <><span>{prefix}</span> <span>{label}</span></> : <span>{label}</span>}
          </span>
        );
      })}
      {gaps.map(g => {
        const { prefix, label } = splitBadge(g);
        return (
          <span key={`g-${g}`} className="inline-flex items-center rounded-full border border-border bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] max-w-full break-words">
            {prefix ? <><span>{prefix}</span> <span>{label}</span></> : <span>{label}</span>}
          </span>
        );
      })}
    </div>
  );
}
