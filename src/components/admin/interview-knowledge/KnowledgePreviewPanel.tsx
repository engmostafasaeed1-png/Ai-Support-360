import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, Search, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { callKnowledge } from '@/hooks/useInterviewKnowledge';

interface PreviewResult {
  plan: { items: Array<{ module: string; version: string | null; versionSource: string; weight: number; questions: number; difficulty: string }>; uncovered: string[]; missingVersion: string[]; model: string | null };
  questions: Array<{ n: number; kind: string; module: string | null; version: string | null; version_specific: boolean; difficulty: string; question: string; key_points: string; source: { type: string; document_ids: string[]; chunk_ids: string[]; library_ids: string[]; knowledge_ids: string[] } }>;
  sources: Array<{ id: string; type: string; title: string; chunk_no: number | null; excerpt: string }>;
  coverage_notes: string[];
  usage: { ai_calls: number; tokens_in: number; tokens_out: number };
  error: string | null;
  references: Array<{ title: string; url: string }>;
  enabled: boolean;
}

export default function KnowledgePreviewPanel({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Admins see full names (name privacy rule); only consultants with at least one module are useful here.
  const consultants = useQuery({
    queryKey: ['ik', 'preview-consultants'],
    enabled: ready,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: skills } = await supabase.from('consultant_skills').select('consultant_id').limit(2000);
      const ids = [...new Set((skills ?? []).map((s) => s.consultant_id))];
      if (!ids.length) return [];
      const { data: cons } = await supabase.from('consultants').select('id, user_id').in('id', ids.slice(0, 500));
      const userIds = (cons ?? []).map((c) => c.user_id).filter(Boolean) as string[];
      const { data: profiles } = userIds.length ? await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds) : { data: [] as any[] };
      const nameOf = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));
      return (cons ?? []).map((c) => ({ id: c.id, name: String(nameOf.get(c.user_id) || c.id.slice(0, 8)) })).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (consultants.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [consultants.data, query]);

  const run = async () => {
    if (!picked) return;
    setBusy(true); setError(null); setResult(null);
    try { setResult(await callKnowledge<PreviewResult>({ action: 'preview', consultant_id: picked.id, lang })); }
    catch (e: any) { setError(e?.code ? t(`ik.errors.${e.code}`, e.message) : e?.message); }
    finally { setBusy(false); }
  };

  const sourceTitle = (q: PreviewResult['questions'][number]) => {
    if (!result) return [];
    const ids = [...q.source.chunk_ids, ...q.source.library_ids, ...q.source.knowledge_ids];
    return result.sources.filter((s) => ids.includes(s.id));
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />{t('ik.preview.title', 'Preview for a consultant')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('ik.preview.subtitle', 'See the plan and 5 sample questions with their sources. Nothing is saved and the consultant is not told.')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="relative">
            <Label htmlFor="ik-pick">{t('ik.preview.consultant', 'Consultant')}</Label>
            <div className="relative">
              <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input id="ik-pick" className="ps-8" value={picked ? picked.name : query} placeholder={t('ik.preview.search', 'Search by name')} onChange={(e) => { setPicked(null); setQuery(e.target.value); }} autoComplete="off" />
            </div>
            {!picked && query.trim() && matches.length > 0 && (
              <ul role="listbox" className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-60 overflow-y-auto">
                {matches.map((c) => (
                  <li key={c.id} role="option" aria-selected={false}>
                    <button type="button" className="w-full text-start px-3 py-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={() => { setPicked(c); setQuery(''); }}>{c.name}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-1" role="group" aria-label={t('ik.preview.language', 'Question language')}>
            {(['en', 'ar'] as const).map((l) => <Button key={l} type="button" size="sm" variant={lang === l ? 'default' : 'outline'} aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'en' ? 'English' : 'العربية'}</Button>)}
          </div>
          <Button onClick={run} disabled={!picked || busy || !ready}>{busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}{t('ik.preview.run', 'Build preview')}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="space-y-5" aria-live="polite">
            {!result.enabled && <p className="text-xs rounded-lg bg-muted p-2.5 text-muted-foreground">{t('ik.preview.off_note', 'The knowledge base is switched off: real interviews still use the current behaviour. This preview shows what would be asked once it is on.')}</p>}
            {result.error && <p className="text-xs text-destructive">{t(`ik.errors.${result.error}`, 'The AI was not available; questions were filled from the library and the profile.')}</p>}
            <section>
              <h3 className="text-sm font-semibold mb-2">{t('ik.preview.plan', 'Plan')}</h3>
              {result.plan.items.length === 0 ? <p className="text-sm text-muted-foreground">{t('ik.preview.no_modules', 'This consultant has no SAP modules in the profile.')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="text-xs text-muted-foreground border-b border-border/60">
                      <th scope="col" className="text-start font-medium px-2 py-1.5">{t('ik.coverage.module', 'Module')}</th>
                      <th scope="col" className="text-start font-medium px-2 py-1.5">{t('ik.coverage.version', 'Version')}</th>
                      <th scope="col" className="text-end font-medium px-2 py-1.5">{t('ik.preview.weight', 'Weight')}</th>
                      <th scope="col" className="text-end font-medium px-2 py-1.5">{t('ik.preview.questions', 'Questions')}</th>
                      <th scope="col" className="text-start font-medium px-2 py-1.5">{t('ik.preview.difficulty', 'Difficulty')}</th>
                    </tr></thead>
                    <tbody>{result.plan.items.map((i) => (
                      <tr key={i.module} className="border-b border-border/30">
                        <td className="px-2 py-1.5">{i.module}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{i.version ?? t('ik.preview.ask_version', 'not given: asked first')}{i.versionSource === 'inferred' ? ` (${t('ik.preview.inferred', 'from the module name')})` : ''}</td>
                        <td className="px-2 py-1.5 text-end tabular-nums">{i.weight.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-end tabular-nums">{i.questions}</td>
                        <td className="px-2 py-1.5">{t(`ik.difficulty.${i.difficulty}`, i.difficulty)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {result.plan.uncovered.length > 0 && <p className="text-xs text-muted-foreground mt-2">{t('ik.preview.uncovered', { list: result.plan.uncovered.join(', '), defaultValue: 'Not covered (limit reached): {{list}}' })}</p>}
              {result.coverage_notes.length > 0 && <p className="text-xs text-muted-foreground mt-1">{result.coverage_notes.join(' · ')}</p>}
            </section>
            <section>
              <h3 className="text-sm font-semibold mb-2">{t('ik.preview.samples', 'Sample questions')}</h3>
              <ol className="space-y-3">
                {result.questions.map((q) => (
                  <li key={q.n} className="rounded-xl border border-border/60 p-3 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {q.module && <Badge variant="outline" className="text-[10px]">{q.module}{q.version ? ` · ${q.version}` : ''}</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{t(`ik.kind.${q.kind}`, q.kind)}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{t(`ik.difficulty.${q.difficulty}`, q.difficulty)}</Badge>
                      {q.version_specific && <Badge className="text-[10px]">{t('ik.preview.version_specific', 'Version-specific')}</Badge>}
                    </div>
                    <p className="text-sm text-foreground" dir="auto">{q.question}</p>
                    {q.key_points && <p className="text-xs text-muted-foreground"><span className="font-medium">{t('ik.preview.key_points', 'Key points (scoring only)')}: </span>{q.key_points}</p>}
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">{t('ik.preview.source', 'Source')}: </span>
                      {q.source.type === 'generated_from_profile' ? t('ik.source.generated_from_profile', 'Generated from the profile') : sourceTitle(q).map((s) => s.type === 'document' ? `${s.title} #${s.chunk_no}` : s.type === 'library' ? `${t('ik.source.library', 'Question library')}: ${s.title.slice(0, 80)}` : `${t('ik.source.knowledge', 'Knowledge base')}: ${s.title}`).join(' · ') || t(`ik.source.${q.source.type}`, q.source.type)}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
            {result.references.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold mb-1">{t('ik.preview.references', 'Official SAP references (administrators only)')}</h3>
                <ul className="space-y-1">{result.references.map((r) => <li key={r.url}><a className="text-xs text-primary underline inline-flex items-center gap-1" href={r.url} target="_blank" rel="noopener noreferrer">{r.title || r.url}<ExternalLink className="h-3 w-3" /></a></li>)}</ul>
              </section>
            )}
            <p className="text-[11px] text-muted-foreground">{t('ik.preview.usage', { calls: result.usage.ai_calls, tin: result.usage.tokens_in, tout: result.usage.tokens_out, defaultValue: 'AI calls: {{calls}} · tokens in {{tin}} / out {{tout}}' })}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
