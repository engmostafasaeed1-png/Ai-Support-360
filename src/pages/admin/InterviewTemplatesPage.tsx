import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { LayoutTemplate, Plus, Pencil, Trash2, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

const SAP_MODULES = [
  'general', 'SAP FICO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP HCM', 'SAP ABAP',
  'SAP Basis', 'SAP BW', 'SAP CRM', 'SAP HANA', 'S/4HANA', 'SAP Fiori',
  'SAP SuccessFactors', 'SAP Ariba', 'SAP Integration', 'SAP BTP',
];
const SENIORITY = [
  { v: 'any', l: 'Any experience' },
  { v: 'junior', l: 'Junior (0–2 yrs)' },
  { v: 'mid', l: 'Mid (3–6 yrs)' },
  { v: 'senior', l: 'Senior (7–11 yrs)' },
  { v: 'expert', l: 'Expert (12+ yrs)' },
];
const ROLES = [
  { v: 'any', l: 'Any role' },
  { v: 'functional', l: 'Functional consultant' },
  { v: 'technical', l: 'Technical / developer' },
  { v: 'architect', l: 'Solution architect' },
  { v: 'manager', l: 'Project / delivery manager' },
];

type Tpl = {
  id?: string;
  sap_module: string;
  seniority: string;
  role_focus: string;
  title: string;
  focus_areas: string;
  instructions: string;
  sample_questions: string;
  question_count: number;
  is_active: boolean;
};

const empty: Tpl = {
  sap_module: 'SAP FICO', seniority: 'any', role_focus: 'any', title: '',
  focus_areas: '', instructions: '', sample_questions: '', question_count: 8, is_active: true,
};

const STARTER: Record<string, string> = {
  'SAP FICO': 'GL, AP/AR, asset accounting, period-end close, cost centers, profitability analysis, FI-MM/SD integration',
  'SAP MM': 'Procurement cycle, inventory management, valuation, MRP, vendor master, invoice verification, release strategies',
  'SAP SD': 'Order-to-cash, pricing, credit management, delivery & billing, output determination, SD-FI integration',
  'SAP PP': 'BOMs, routings, MRP runs, production orders, capacity planning, shop floor confirmations',
  'SAP HCM': 'Org management, personnel administration, time management, payroll schemas and rules',
  'SAP ABAP': 'Reports, ALV, BAPIs/BAdIs/enhancements, CDS views, performance tuning, debugging, OData',
  'SAP Basis': 'System landscape, transports, kernel/upgrades, user & role admin, monitoring, performance, backups',
  'SAP BTP': 'CAP, Integration Suite, extensions, security & destinations, Cloud Foundry/Kyma, event mesh',
  'S/4HANA': 'Universal journal, conversion vs greenfield, Fiori apps, simplification items, migration cockpit',
};

const tbl = () => supabase.from('interview_templates' as any);

export default function InterviewTemplatesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Tpl | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');

  const { data = [], isLoading } = useQuery({
    queryKey: ['interview-templates'],
    queryFn: async () => {
      const { data, error } = await tbl().select('*').order('sap_module').order('seniority');
      if (error) throw error;
      return (data || []) as unknown as Tpl[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['interview-templates'] });

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) return toast.error('Please add a title');
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { id, ...rest } = editing;
    const payload = { ...rest, question_count: Math.min(20, Math.max(3, Number(rest.question_count) || 8)) };
    const res = id
      ? await tbl().update(payload).eq('id', id)
      : await tbl().insert({ ...payload, created_by: u.user?.id });
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success('Template saved');
    setEditing(null);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    const { error } = await tbl().delete().eq('id', id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const toggle = async (t: Tpl) => {
    const { error } = await tbl().update({ is_active: !t.is_active }).eq('id', t.id!);
    if (error) return toast.error(error.message);
    refresh();
  };

  const rows = filter === 'all' ? data : data.filter((t) => t.sap_module === filter);
  const label = (list: { v: string; l: string }[], v: string) => list.find((x) => x.v === v)?.l || v;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <LayoutTemplate className="h-6 w-6 text-primary" /> Interview templates
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One template per SAP area, experience level and role. During an AI interview, the matching template
            guides the AI to write questions that fit the consultant's role and years of experience.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All SAP areas</SelectItem>
              {SAP_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setEditing({ ...empty })}><Plus className="me-1 h-4 w-4" /> New template</Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No templates yet. Click "New template" to add one for an SAP area.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((t) => (
            <Card key={t.id} className="rounded-2xl">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{t.title}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{t.sap_module}</Badge>
                      <Badge variant="secondary">{label(SENIORITY, t.seniority)}</Badge>
                      <Badge variant="outline">{label(ROLES, t.role_focus)}</Badge>
                      <Badge variant="outline">{t.question_count} questions</Badge>
                    </div>
                  </div>
                  <Switch checked={t.is_active} onCheckedChange={() => toggle(t)} aria-label="Use in interviews" />
                </div>
                {t.focus_areas && <p className="line-clamp-2 text-sm text-muted-foreground">{t.focus_areas}</p>}
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ ...t })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id!)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit template' : 'New template'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label>SAP area</Label>
                  <Select value={editing.sap_module} onValueChange={(v) => setEditing({ ...editing, sap_module: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SAP_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1"><Label>Experience level</Label>
                  <Select value={editing.seniority} onValueChange={(v) => setEditing({ ...editing, seniority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SENIORITY.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1"><Label>Role</Label>
                  <Select value={editing.role_focus} onValueChange={(v) => setEditing({ ...editing, role_focus: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                  </Select></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div className="space-y-1"><Label>Title</Label>
                  <Input value={editing.title} maxLength={120} placeholder="e.g. Senior FICO functional consultant"
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
                <div className="space-y-1"><Label>Number of questions</Label>
                  <Input type="number" min={3} max={20} value={editing.question_count}
                    onChange={(e) => setEditing({ ...editing, question_count: Number(e.target.value) })} /></div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between"><Label>Focus areas</Label>
                  {STARTER[editing.sap_module] && (
                    <Button type="button" size="sm" variant="ghost"
                      onClick={() => setEditing({ ...editing, focus_areas: STARTER[editing.sap_module] })}>
                      <Wand2 className="me-1 h-3.5 w-3.5" /> Use suggested topics
                    </Button>)}
                </div>
                <Textarea rows={3} maxLength={800} value={editing.focus_areas}
                  placeholder="Topics the AI should cover, separated by commas"
                  onChange={(e) => setEditing({ ...editing, focus_areas: e.target.value })} />
              </div>
              <div className="space-y-1"><Label>Instructions for the AI</Label>
                <Textarea rows={3} maxLength={1200} value={editing.instructions}
                  placeholder="e.g. Ask about at least one full implementation project and a production issue they solved."
                  onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} /></div>
              <div className="space-y-1"><Label>Example questions (optional, one per line)</Label>
                <Textarea rows={4} maxLength={1200} value={editing.sample_questions}
                  onChange={(e) => setEditing({ ...editing, sample_questions: e.target.value })} /></div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                <Label>Use in interviews</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="me-1 h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
