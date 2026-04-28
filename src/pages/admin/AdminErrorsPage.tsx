import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

type ErrorRow = {
  id: string;
  level: string;
  source: string;
  message: string;
  stack: string | null;
  url: string | null;
  route: string | null;
  user_agent: string | null;
  user_id: string | null;
  context: Record<string, unknown> | null;
  fingerprint: string | null;
  occurrence_count: number;
  resolved: boolean;
  resolved_at: string | null;
  resolved_notes: string | null;
  created_at: string;
  updated_at: string;
};

const LEVEL_STYLES: Record<string, string> = {
  fatal: 'bg-destructive/15 text-destructive border-destructive/30',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
  warn: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
};

export default function AdminErrorsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ErrorRow | null>(null);
  const [notes, setNotes] = useState('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-errors', tab, search],
    queryFn: async () => {
      let q = supabase.from('error_reports').select('*').order('created_at', { ascending: false }).limit(200);
      if (tab === 'open') q = q.eq('resolved', false);
      if (tab === 'resolved') q = q.eq('resolved', true);
      if (search.trim()) q = q.ilike('message', `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as ErrorRow[];
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('error_reports')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: auth.user?.id ?? null,
          resolved_notes: notes || null,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Marked as resolved');
      qc.invalidateQueries({ queryKey: ['admin-errors'] });
      setSelected(null);
      setNotes('');
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('error_reports')
        .update({ resolved: false, resolved_at: null, resolved_notes: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Reopened');
      qc.invalidateQueries({ queryKey: ['admin-errors'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('error_reports').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['admin-errors'] });
      setSelected(null);
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-destructive" />
            Error Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All client and server errors are logged here so you can take action.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search message…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)
          ) : !data?.length ? (
            <div className="py-16 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
              No errors {tab === 'open' ? 'open' : ''} 🎉
            </div>
          ) : (
            data.map((row) => (
              <button
                key={row.id}
                onClick={() => {
                  setSelected(row);
                  setNotes(row.resolved_notes ?? '');
                }}
                className="w-full text-left p-4 rounded-xl border border-border/50 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Badge variant="outline" className={LEVEL_STYLES[row.level] || ''}>
                    {row.level}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{row.message}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                      <span>{row.source}</span>
                      {row.route && <span className="font-mono">{row.route}</span>}
                      <span>×{row.occurrence_count}</span>
                      <span>{formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}</span>
                      {row.resolved && (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700">
                          Resolved
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge variant="outline" className={LEVEL_STYLES[selected?.level || 'error']}>
                {selected?.level}
              </Badge>
              <span className="truncate">{selected?.message}</span>
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Source</div>
                  <div className="font-medium">{selected.source}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Occurrences</div>
                  <div className="font-medium">×{selected.occurrence_count}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Route</div>
                  <div className="font-mono">{selected.route || '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">When</div>
                  <div>{new Date(selected.created_at).toLocaleString()}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">URL</div>
                  <div className="font-mono break-all">{selected.url || '—'}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">User</div>
                  <div className="font-mono break-all">{selected.user_id || 'Anonymous'}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">User agent</div>
                  <div className="text-xs break-all">{selected.user_agent || '—'}</div>
                </div>
              </div>

              {selected.stack && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Stack trace</div>
                  <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-auto max-h-48">{selected.stack}</pre>
                </div>
              )}

              {selected.context && Object.keys(selected.context).length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Context</div>
                  <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-auto max-h-40">
                    {JSON.stringify(selected.context, null, 2)}
                  </pre>
                </div>
              )}

              {!selected.resolved && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Resolution notes</div>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What action did you take?"
                    rows={3}
                  />
                </div>
              )}

              {selected.resolved && selected.resolved_notes && (
                <div className="bg-emerald-500/5 rounded-lg p-3 text-xs">
                  <div className="text-muted-foreground mb-1">Resolution notes</div>
                  <div>{selected.resolved_notes}</div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => selected && deleteMutation.mutate(selected.id)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Delete
            </Button>
            {selected?.resolved ? (
              <Button variant="outline" onClick={() => selected && reopenMutation.mutate(selected.id)}>
                Reopen
              </Button>
            ) : (
              <Button
                onClick={() => selected && resolveMutation.mutate({ id: selected.id, notes })}
                disabled={resolveMutation.isPending}
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Mark Resolved
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
