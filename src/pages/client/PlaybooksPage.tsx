import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, BookOpen, Play, CheckCircle, Clock, Zap, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function PlaybooksPage() {
  const [search, setSearch] = useState('');

  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('playbooks') as any).select('*').eq('is_active', true).order('usage_count', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: executions = [] } = useQuery({
    queryKey: ['my-playbook-executions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await (supabase.from('playbook_executions') as any).select('*, playbooks(title)').eq('executed_by', user.id).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = playbooks.filter((p: any) => !search || p.title.toLowerCase().includes(search.toLowerCase()));

  const startPlaybook = async (playbook: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await (supabase.from('playbook_executions') as any).insert({
        playbook_id: playbook.id,
        executed_by: user.id,
        status: 'in_progress',
        current_step: 0,
        step_results: [],
      });
      if (error) throw error;
      toast.success(`Started playbook: ${playbook.title}`);
    } catch { toast.error('Failed to start'); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" /> Playbooks
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Step-by-step guided workflows for common issue resolution.</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search playbooks..." value={search} onChange={e => setSearch(e.target.value)} className="ps-9 rounded-xl" />
      </div>

      {/* Recent Executions */}
      {executions.length > 0 && (
        <Card className="rounded-2xl border-accent/20 bg-accent/5">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5"><Zap className="w-4 h-4 text-accent" /> Recent Runs</h3>
            <div className="space-y-1.5">
              {executions.slice(0, 5).map((exec: any) => (
                <div key={exec.id} className="flex items-center gap-2 text-sm">
                  {exec.status === 'completed' ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Clock className="w-3.5 h-3.5 text-yellow-600" />}
                  <span className="text-foreground truncate flex-1">{exec.playbooks?.title}</span>
                  <Badge variant="secondary" className="text-[9px]">{exec.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Playbook Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />) :
          filtered.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No playbooks available.</p>
            </div>
          ) : filtered.map((pb: any) => {
            const steps = Array.isArray(pb.steps) ? pb.steps : [];
            return (
              <Card key={pb.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <BookOpen className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground">{pb.title}</p>
                      <div className="flex gap-1.5 mt-0.5">
                        {pb.category && <Badge variant="outline" className="text-[9px]">{pb.category}</Badge>}
                        {pb.sap_module && <Badge variant="secondary" className="text-[9px]">{pb.sap_module}</Badge>}
                        {pb.source_ticket_id && <Badge className="text-[9px] bg-primary/10 text-primary border-0">Auto-generated</Badge>}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{pb.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{steps.length} steps</span>
                      {pb.avg_completion_minutes && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />~{pb.avg_completion_minutes}m</span>}
                      <span>{pb.usage_count} runs</span>
                    </div>
                    <Button size="sm" className="gap-1 text-xs gradient-primary border-0" onClick={() => startPlaybook(pb)}>
                      <Play className="w-3 h-3" /> Start
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
