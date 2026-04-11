import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Siren, Plus, Radio, Users, Clock, FileText, CheckCircle, ExternalLink } from 'lucide-react';

const statusColors: Record<string, string> = {
  new: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  in_progress: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  waiting_on_client: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  closed: 'bg-muted text-muted-foreground',
};

const urgencyColors: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export default function MajorIncidentsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ['major-incident-tickets'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('ticket_type', 'major_incident')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const active = incidents.filter((t: any) => !['resolved', 'closed'].includes(t.status));
  const resolved = incidents.filter((t: any) => t.status === 'resolved').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Siren className="w-6 h-6 text-destructive" /> Major Incidents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            P1/P2 critical tickets requiring immediate attention
          </p>
        </div>
        <Button
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Siren className="w-4 h-4" /> Declare Major Incident
        </Button>
      </div>

      {/* Active Alert Banner */}
      {active.length > 0 && (
        <Card className="rounded-2xl border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-4 h-4 text-destructive animate-pulse" />
              <span className="text-sm font-bold text-destructive">
                {active.length} Active Major Incident{active.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-2">
              {active.slice(0, 3).map((t: any) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-background/50 cursor-pointer hover:bg-background/80 transition-colors"
                  onClick={() => navigate(`/client/tickets/${t.id}`)}
                >
                  <Badge variant="secondary" className={`text-[10px] ${urgencyColors[t.urgency] || ''}`}>
                    {t.urgency?.toUpperCase()}
                  </Badge>
                  <span className="text-sm font-medium text-foreground truncate flex-1">{t.title}</span>
                  <Badge variant="secondary" className={`text-[10px] ${statusColors[t.status] || ''}`}>
                    {t.status?.replace(/_/g, ' ')}
                  </Badge>
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
          { label: 'Resolved', value: resolved, icon: CheckCircle, color: 'text-emerald-600' },
          { label: 'Avg Resolution', value: '—', icon: Clock, color: 'text-yellow-600' },
        ].map((s) => (
          <Card key={s.label} className="rounded-2xl border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ticket List */}
      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : incidents.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center">
              <Siren className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No major incidents recorded.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Declare a major incident to create a critical ticket
              </p>
            </CardContent>
          </Card>
        ) : (
          incidents.map((ticket: any) => (
            <Card
              key={ticket.id}
              className="rounded-2xl border-border/50 hover:shadow-premium transition-all cursor-pointer"
              onClick={() => navigate(`/client/tickets/${ticket.id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status] || ''}`}>
                        {ticket.status?.replace(/_/g, ' ')}
                      </Badge>
                      <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency] || ''}`}>
                        {ticket.urgency?.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{ticket.sap_module}</Badge>
                    </div>
                    <p className="font-semibold text-foreground">{ticket.title}</p>
                    {ticket.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(ticket.created_at).toLocaleString()}
                      </span>
                      {ticket.sla_breached && (
                        <Badge variant="destructive" className="text-[10px]">SLA Breached</Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/client/tickets/${ticket.id}`);
                    }}
                  >
                    <ExternalLink className="w-3 h-3" /> View Ticket
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <CreateMajorIncidentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['major-incident-tickets'] })}
      />
    </div>
  );
}

function CreateMajorIncidentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    sap_module: 'SAP ERP',
    urgency: 'critical' as string,
  });
  const [saving, setSaving] = useState(false);

  const sapModules = [
    'SAP ERP', 'SAP S/4HANA', 'SAP FI/CO', 'SAP MM', 'SAP SD', 'SAP PP',
    'SAP HR/HCM', 'SAP BW/BI', 'SAP CRM', 'SAP SCM', 'SAP Basis', 'SAP Security',
    'SAP ABAP', 'SAP Fiori', 'SAP Integration', 'Other',
  ];

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('tickets').insert({
        client_id: user.id,
        title: form.title,
        description: form.description,
        sap_module: form.sap_module,
        urgency: form.urgency as any,
        ticket_type: 'major_incident',
        status: 'new' as any,
      });
      if (error) throw error;

      toast.success('Major incident declared as ticket');
      setForm({ title: '', description: '', sap_module: 'SAP ERP', urgency: 'critical' });
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Siren className="w-4 h-4" /> Declare Major Incident
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Title *</label>
            <Input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Brief incident summary..."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              placeholder="Impact, affected systems, symptoms..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">SAP Module</label>
              <Select value={form.sap_module} onValueChange={(v) => setForm((p) => ({ ...p, sap_module: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sapModules.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Urgency</label>
              <Select value={form.urgency} onValueChange={(v) => setForm((p) => ({ ...p, urgency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical (P1)</SelectItem>
                  <SelectItem value="high">High (P2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-destructive text-destructive-foreground"
          >
            {saving ? 'Declaring...' : 'Declare Incident'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
