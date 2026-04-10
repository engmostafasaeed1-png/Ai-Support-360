import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Siren, Plus, Radio, Users, Clock, MessageSquare, CheckCircle, FileText } from 'lucide-react';

const statusColors: Record<string, string> = {
  declared: 'bg-red-100 text-red-700',
  investigating: 'bg-orange-100 text-orange-700',
  mitigating: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  post_review: 'bg-blue-100 text-blue-700',
  closed: 'bg-muted text-muted-foreground',
};

export default function MajorIncidentsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<any>(null);

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ['major-incidents'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('major_incidents') as any).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const active = incidents.filter((i: any) => !['resolved', 'closed', 'post_review'].includes(i.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Siren className="w-6 h-6 text-destructive" /> Major Incidents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">P1/P2 incident management with war rooms and post-incident reviews.</p>
        </div>
        <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Siren className="w-4 h-4" /> Declare Major Incident
        </Button>
      </div>

      {/* Active Alert */}
      {active.length > 0 && (
        <Card className="rounded-2xl border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-4 h-4 text-destructive animate-pulse" />
              <span className="text-sm font-bold text-destructive">{active.length} Active Major Incident{active.length > 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-2">
              {active.map((inc: any) => (
                <div key={inc.id} className="flex items-center gap-3 p-2 rounded-lg bg-background/50 cursor-pointer hover:bg-background/80" onClick={() => setSelectedIncident(inc)}>
                  <Badge variant="secondary" className={`text-[10px] ${statusColors[inc.status]}`}>{inc.status.replace(/_/g, ' ')}</Badge>
                  <span className="text-sm font-medium text-foreground truncate flex-1">{inc.title}</span>
                  <Badge variant="outline" className="text-[10px]">{inc.severity.toUpperCase()}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active', value: active.length, icon: Siren, color: 'text-destructive' },
          { label: 'Total', value: incidents.length, icon: FileText, color: 'text-primary' },
          { label: 'Avg Resolution', value: '—', icon: Clock, color: 'text-yellow-600' },
          { label: 'PIR Pending', value: incidents.filter((i: any) => i.status === 'post_review').length, icon: CheckCircle, color: 'text-blue-600' },
        ].map(s => (
          <Card key={s.label} className="rounded-2xl border-border/50"><CardContent className="p-4 flex items-center gap-3">
            <s.icon className={`w-8 h-8 ${s.color}`} /><div><p className="text-2xl font-bold text-foreground">{s.value}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
          </CardContent></Card>
        ))}
      </div>

      {/* Incident List */}
      <div className="space-y-3">
        {isLoading ? [1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />) :
          incidents.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="py-12 text-center">
              <Siren className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No major incidents recorded.</p>
            </CardContent></Card>
          ) : incidents.map((inc: any) => (
            <Card key={inc.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all cursor-pointer" onClick={() => setSelectedIncident(inc)}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className={`text-[10px] ${statusColors[inc.status]}`}>{inc.status.replace(/_/g, ' ')}</Badge>
                      <Badge variant="outline" className="text-[10px]">{inc.severity.toUpperCase()}</Badge>
                    </div>
                    <p className="font-semibold text-foreground">{inc.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{inc.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {inc.affected_users_count > 0 && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{inc.affected_users_count} affected</span>}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(inc.declared_at).toLocaleString()}</span>
                    </div>
                  </div>
                  {inc.war_room_link && (
                    <Button size="sm" variant="outline" className="text-xs gap-1 shrink-0" onClick={e => { e.stopPropagation(); window.open(inc.war_room_link, '_blank'); }}>
                      <Radio className="w-3 h-3" /> War Room
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>

      <CreateMajorIncidentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => queryClient.invalidateQueries({ queryKey: ['major-incidents'] })} />

      {selectedIncident && (
        <Dialog open onOpenChange={() => setSelectedIncident(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Siren className="w-5 h-5 text-destructive" /> {selectedIncident.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Badge variant="secondary" className={statusColors[selectedIncident.status]}>{selectedIncident.status.replace(/_/g, ' ')}</Badge>
                <Badge variant="outline">{selectedIncident.severity.toUpperCase()}</Badge>
              </div>
              {selectedIncident.description && <div><h4 className="text-xs font-medium mb-1">Description</h4><p className="text-sm text-muted-foreground">{selectedIncident.description}</p></div>}
              {selectedIncident.business_impact && <div><h4 className="text-xs font-medium mb-1">Business Impact</h4><p className="text-sm text-muted-foreground">{selectedIncident.business_impact}</p></div>}
              {selectedIncident.root_cause && <div><h4 className="text-xs font-medium mb-1">Root Cause</h4><p className="text-sm text-muted-foreground">{selectedIncident.root_cause}</p></div>}
              {selectedIncident.resolution_summary && <div><h4 className="text-xs font-medium mb-1">Resolution</h4><p className="text-sm text-muted-foreground">{selectedIncident.resolution_summary}</p></div>}
              {selectedIncident.lessons_learned && <div><h4 className="text-xs font-medium mb-1">Lessons Learned</h4><p className="text-sm text-muted-foreground">{selectedIncident.lessons_learned}</p></div>}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateMajorIncidentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', severity: 'p1', business_impact: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.title) { toast.error('Title required'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await (supabase.from('major_incidents') as any).insert({ ...form, created_by: user.id });
      if (error) throw error;
      toast.success('Major incident declared');
      onOpenChange(false);
      onCreated();
    } catch { toast.error('Failed'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><Siren className="w-4 h-4" /> Declare Major Incident</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><label className="text-xs font-medium">Title</label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium">Description</label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium">Business Impact</label><Textarea value={form.business_impact} onChange={e => setForm(p => ({ ...p, business_impact: e.target.value }))} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-destructive text-destructive-foreground">Declare</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
