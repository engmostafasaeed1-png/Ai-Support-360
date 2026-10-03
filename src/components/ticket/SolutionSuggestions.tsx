import { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb, Loader2, RefreshCw, ThumbsUp, ThumbsDown, CheckCircle2, ShieldCheck, Info, ExternalLink, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import {
  BASIS_LABEL,
  SAP_DOCS_LICENSE_URL,
  canSuggest,
  hasReferences,
  licenseLabel,
  normalizeSuggestResult,
  shieldText,
  suggestSignature,
  type SuggestResult,
  type Suggestion,
} from '@/lib/aiSuggest';

interface Props {
  title: string;
  description: string;
  areas: string[];
  other: string;
  details: string;
  urgency: string;
  language: string;
  model?: string;
  /** The client says the suggestions solved the problem: the screen stops and no ticket is created. */
  onSolved: () => void;
}

// One answer per draft for the life of the page, so going back and forth does not ask again.
const cache = new Map<string, SuggestResult>();

const confidenceClass: Record<Suggestion['confidence'], string> = {
  high: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-muted text-muted-foreground',
};

/** Links to SAP's own websites: notes cited by reviewed sources, matching SAP Community discussions, and SAP Community's search. Nothing of SAP's is copied. */
function SapLinks({ result }: { result: SuggestResult }) {
  if (!hasReferences(result)) return null;
  const { notes, references } = result;
  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-background p-3" data-testid="sap-references">
      <p className="text-xs font-semibold text-foreground">More from SAP</p>
      {notes.length > 0 && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">SAP Notes cited in the sources:</span>
            {notes.map(n => (
              <a
                key={n.number}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 font-mono text-[11px] text-primary hover:bg-accent/10"
              >
                <span>{n.number}</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(opens SAP for Me in a new tab)</span>
              </a>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">Opens SAP for Me. You need your own SAP login.</p>
        </div>
      )}
      {references.community.length > 0 && (
        <ul className="space-y-1">
          {references.community.map(item => (
            <li key={item.url} className="flex items-start gap-1.5 text-xs">
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{item.title}</a>
              {item.solved && <Badge variant="secondary" className="text-[9px]">Solved</Badge>}
            </li>
          ))}
        </ul>
      )}
      {references.communitySearchUrl && (
        <a
          href={references.communitySearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Search className="h-3 w-3" aria-hidden="true" /> Search SAP Community for this
        </a>
      )}
      <p className="text-[10px] text-muted-foreground">Links open SAP websites in a new tab. We do not copy SAP content.</p>
    </div>
  );
}

export default function SolutionSuggestions({ title, description, areas, other, details, urgency, language, model, onSolved }: Props) {
  const signature = suggestSignature({ title, description, areas, other, details, language });
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(() => (cache.has(signature) ? 'done' : 'idle'));
  const [result, setResult] = useState<SuggestResult | null>(() => cache.get(signature) ?? null);
  const [verdicts, setVerdicts] = useState<Record<number, 'helpful' | 'not_helpful'>>({});
  const [sending, setSending] = useState(false);
  const latest = useRef(signature);
  latest.current = signature;

  const run = useCallback(async (force = false) => {
    if (!canSuggest(description)) return;
    const key = signature;
    if (!force && cache.has(key)) {
      setResult(cache.get(key)!);
      setStatus('done');
      return;
    }
    setStatus('loading');
    setVerdicts({});
    try {
      const { data, error } = await supabase.functions.invoke('ai-suggest', {
        body: {
          title,
          description,
          sap_modules: areas,
          sap_module_other: other || undefined,
          area_details: details || undefined,
          urgency,
          preferred_language: language,
          model,
        },
      });
      if (latest.current !== key) return; // the draft changed while we waited
      if (error || data?.error) throw new Error(String(data?.error || error?.message || 'failed'));
      const normalized = normalizeSuggestResult(data);
      cache.set(key, normalized);
      setResult(normalized);
      setStatus('done');
    } catch (err) {
      if (latest.current !== key) return;
      console.error('Suggestions failed:', err);
      setStatus('error');
    }
  }, [signature, title, description, areas, other, details, urgency, language, model]);

  // ask once when the card is shown for a draft that is long enough and not asked yet
  useEffect(() => {
    if (status === 'idle' && canSuggest(description)) void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const sendFeedback = async (verdict: 'helpful' | 'not_helpful' | 'solved', ids: string[]) => {
    const { error } = await (supabase.from('ai_suggestion_feedback') as any).insert({
      verdict,
      item_ids: ids.slice(0, 10),
      mode: result?.mode ?? null,
      areas: areas.slice(0, 12),
    });
    return !error;
  };

  const rate = async (index: number, verdict: 'helpful' | 'not_helpful') => {
    if (verdicts[index]) return;
    setVerdicts(prev => ({ ...prev, [index]: verdict }));
    await sendFeedback(verdict, result?.suggestions[index]?.source_ids ?? []);
  };

  const solved = async () => {
    if (!result) return;
    setSending(true);
    const ids = [...new Set(result.suggestions.flatMap(s => s.source_ids))];
    await sendFeedback('solved', ids);
    setSending(false);
    toast.success('Thank you. We are glad it helped.');
    onSolved();
  };

  if (result && result.enabled === false) return null;
  if (!canSuggest(description) && status === 'idle') return null;

  return (
    <Card className="rounded-2xl border-accent/20 bg-accent/5" data-testid="solution-suggestions">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Lightbulb className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-accent">Possible solutions to try first</span>
          {status === 'done' && (
            <Button variant="ghost" size="sm" className="ms-auto h-7 gap-1 text-xs" onClick={() => void run(true)} aria-label="Look again">
              <RefreshCw className="h-3 w-3" /> Look again
            </Button>
          )}
        </div>

        {status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Looking through the knowledge base...
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" /> Suggestions are not available right now. You can go on with your request.
            <Button variant="outline" size="sm" className="ms-auto h-7 text-xs" onClick={() => void run(true)}>Try again</Button>
          </div>
        )}

        {status === 'done' && result && (
          <>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
              {shieldText(result)}
            </p>

            {result.suggestions.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {result.note || 'We have nothing to suggest yet. Go on with your request and an expert will help you.'}
                </p>
                <SapLinks result={result} />
              </>
            ) : (
              <div className="space-y-3">
                {result.suggestions.map((s, i) => (
                  <div key={i} className="space-y-2 rounded-xl border border-border/50 bg-background p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{s.title}</h4>
                      <Badge variant="secondary" className="text-[10px]">{BASIS_LABEL[s.basis]}</Badge>
                      <Badge variant="secondary" className={`text-[10px] ${confidenceClass[s.confidence]}`}>{s.confidence} confidence</Badge>
                    </div>
                    {s.summary && <p className="text-xs text-muted-foreground">{s.summary}</p>}
                    <ol className="list-inside list-decimal space-y-1">
                      {s.steps.map((step, j) => (
                        <li key={j} className="text-xs text-foreground">{step}</li>
                      ))}
                    </ol>
                    {s.tcodes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">T-Codes:</span>
                        {s.tcodes.map(tc => (
                          <Badge key={tc} variant="outline" className="font-mono text-[9px]">{tc}</Badge>
                        ))}
                      </div>
                    )}
                    {s.docs.length > 0 && (
                      <div className="space-y-0.5 rounded-lg bg-muted/40 p-2" data-testid="sap-docs-source">
                        {s.docs.map(d => (
                          <p key={d.url} className="text-[11px] text-muted-foreground">
                            Source:{' '}
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{d.title}</a>
                            {d.source ? `, ${d.source}` : ''}. © SAP SE,{' '}
                            <a href={SAP_DOCS_LICENSE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{licenseLabel(d.license)}</a>.
                            {' '}Shortened and reworded.
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground">Did this help?</span>
                      <Button
                        variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!verdicts[i]}
                        aria-pressed={verdicts[i] === 'helpful'} onClick={() => void rate(i, 'helpful')}
                      >
                        <ThumbsUp className="h-3 w-3" /> Helpful
                      </Button>
                      <Button
                        variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!verdicts[i]}
                        aria-pressed={verdicts[i] === 'not_helpful'} onClick={() => void rate(i, 'not_helpful')}
                      >
                        <ThumbsDown className="h-3 w-3" /> Not helpful
                      </Button>
                    </div>
                  </div>
                ))}
                {result.note && <p className="text-xs text-muted-foreground">{result.note}</p>}
                <SapLinks result={result} />
                <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
                  <Button size="sm" className="gradient-primary gap-1.5 border-0" disabled={sending} onClick={() => void solved()}>
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    This solved my problem
                  </Button>
                  <span className="text-[11px] text-muted-foreground">Otherwise just go on: an expert will take over.</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
