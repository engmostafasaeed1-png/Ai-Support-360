import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, ClipboardList, Star } from 'lucide-react';
import InterviewHistory from '@/components/consultant/InterviewHistory';

interface ModuleScore {
  module: string;
  avg: number;
  count: number;
}

interface ConsultantRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  verificationStatus: string;
  interviewCount: number;
  avgScore: number | null;
  lastInterviewAt: string | null;
  moduleScores: ModuleScore[];
}

export default function ConsultantInterviewsPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: consultants, isLoading } = useQuery({
    queryKey: ['admin-consultant-interviews'],
    queryFn: async () => {
      const { data: cons, error: consErr } = await supabase
        .from('consultants')
        .select('id, user_id, verification_status')
        .order('created_at', { ascending: false });
      if (consErr) throw consErr;

      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url');
      const profileByUser = new Map((profs || []).map((p: any) => [p.user_id, p]));

      const { data: sessions, error: sessErr } = await supabase
        .from('interview_sessions')
        .select('id, consultant_id, overall_score, created_at');
      if (sessErr) throw sessErr;

      const sessionIds = (sessions || []).map((s) => s.id);
      const { data: answers } = sessionIds.length
        ? await supabase
            .from('interview_answers')
            .select('interview_id, score, sap_module')
            .in('interview_id', sessionIds)
        : { data: [] as any[] };
      const sessionConsultant = new Map((sessions || []).map((s) => [s.id, s.consultant_id]));

      const byConsultant = new Map<string, { count: number; scores: number[]; last: string; modules: Map<string, number[]> }>();
      for (const s of sessions || []) {
        const entry = byConsultant.get(s.consultant_id) || { count: 0, scores: [] as number[], last: s.created_at, modules: new Map<string, number[]>() };
        entry.count += 1;
        if (s.overall_score != null) entry.scores.push(s.overall_score);
        if (s.created_at > entry.last) entry.last = s.created_at;
        byConsultant.set(s.consultant_id, entry);
      }
      for (const a of answers || []) {
        const consultantId = sessionConsultant.get(a.interview_id);
        if (!consultantId || a.score == null) continue;
        const entry = byConsultant.get(consultantId);
        if (!entry) continue;
        const mod = (a.sap_module || 'General').trim() || 'General';
        const list: number[] = entry.modules.get(mod) || [];
        list.push(a.score);
        entry.modules.set(mod, list);
      }

      return (cons || []).map((c: any): ConsultantRow => {
        const agg = byConsultant.get(c.id);
        const prof = profileByUser.get(c.user_id) as any;
        const moduleScores: ModuleScore[] = agg
          ? Array.from(agg.modules.entries())
              .map(([module, scores]) => ({
                module,
                avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
                count: scores.length,
              }))
              .sort((a, b) => b.count - a.count || a.module.localeCompare(b.module))
          : [];
        return {
          id: c.id,
          name: prof?.display_name || 'Unknown',
          avatarUrl: prof?.avatar_url || null,
          verificationStatus: c.verification_status,
          interviewCount: agg?.count || 0,
          avgScore: agg && agg.scores.length > 0
            ? Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length)
            : null,
          lastInterviewAt: agg?.last || null,
          moduleScores,
        };
      });
    },
  });

  const filtered = useMemo(() => {
    const list = consultants || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [consultants, search]);

  const selected = consultants?.find((c) => c.id === selectedId) || null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Consultant Interviews</h1>
        <p className="text-sm text-muted-foreground">
          Interview history, per-question scores and AI summaries for every consultant.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="rounded-2xl border-border/50 h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-accent" />
              Consultants
            </CardTitle>
            <div className="relative pt-2">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search consultants…"
                className="ps-9"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
            {isLoading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No consultants found.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-start transition-colors ${
                    selectedId === c.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border/30 hover:bg-muted/20'
                  }`}
                >
                  <Avatar className="w-9 h-9 shrink-0">
                    {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={c.name} />}
                    <AvatarFallback>{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.interviewCount} interview{c.interviewCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  {c.avgScore != null && (
                    <Badge variant="secondary" className="gap-1 shrink-0">
                      <Star className="w-3 h-3" />
                      {c.avgScore}
                    </Badge>
                  )}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div>
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10">
                  {selected.avatarUrl && <AvatarImage src={selected.avatarUrl} alt={selected.name} />}
                  <AvatarFallback>{selected.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selected.interviewCount} interview{selected.interviewCount === 1 ? '' : 's'}
                    {selected.avgScore != null && ` · average score ${selected.avgScore}/100`}
                    {selected.lastInterviewAt && ` · last ${new Date(selected.lastInterviewAt).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              {selected.moduleScores.length > 0 && (
                <Card className="rounded-2xl border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Scores by SAP area</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {selected.moduleScores.map((m) => (
                      <Badge key={m.module} variant="secondary" className="gap-1.5 px-3 py-1.5">
                        <span className="font-medium">{m.module}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-bold">{m.avg}/100</span>
                        <span className="text-muted-foreground text-xs">({m.count} q)</span>
                      </Badge>
                    ))}
                  </CardContent>
                </Card>
              )}
              <InterviewHistory consultantId={selected.id} />
            </div>
          ) : (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Select a consultant to see their interview history, scores per question and AI summary.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
