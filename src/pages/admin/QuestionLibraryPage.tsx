import { useMemo, useRef, useState } from 'react';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { Library, Plus, Upload, Sparkles, Pencil, Trash2, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const SAP_MODULES = [
  'general', 'SAP FICO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP HCM', 'SAP ABAP',
  'SAP Basis', 'SAP BW', 'SAP CRM', 'SAP HANA', 'S/4HANA', 'SAP Fiori',
  'SAP SuccessFactors', 'SAP Ariba', 'SAP Integration', 'SAP BTP',
];
const LEVELS = ['easy', 'medium', 'hard', 'expert'] as const;

type Entry = {
  id?: string;
  sap_module: string;
  difficulty: string;
  category: string | null;
  question: string;
  best_answer: string;
  key_points: string | null;
  tags: string[];
  author_name: string | null;
  source?: string;
  is_active: boolean;
};

const empty: Entry = { sap_module: 'general', difficulty: 'medium', category: '', question: '', best_answer: '', key_points: '', tags: [], author_name: '', is_active: true };

const db = () => (supabase as any).from('interview_question_library');

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const TEMPLATE_HEADERS = ['sap_module', 'difficulty', 'category', 'question', 'best_answer', 'key_points', 'tags', 'author_name'];

export default function QuestionLibraryPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [mod, setMod] = useState('all');
  const [lvl, setLvl] = useState('all');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [saving, setSaving] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState({ sap_module: 'SAP FICO', difficulty: 'medium', count: 5, topic: '' });
  const [genLoading, setGenLoading] = useState(false);
  const [drafts, setDrafts] = useState<(Entry & { keep: boolean })[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['question-library'],
    queryFn: async () => {
      const { data, error } = await db().select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Entry[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['question-library'] });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter((r) =>
      (mod === 'all' || r.sap_module === mod) &&
      (lvl === 'all' || r.difficulty === lvl) &&
      (!s || r.question.toLowerCase().includes(s) || r.best_answer.toLowerCase().includes(s) || r.tags.join(' ').toLowerCase().includes(s)));
  }, [rows, search, mod, lvl]);

  const save = async () => {
    if (!editing || !editing.question.trim()) return toast.error('Question is required');
    setSaving(true);
    const { id, ...rest } = editing;
    const payload = { ...rest, question: rest.question.trim(), category: rest.category || null, key_points: rest.key_points || null, author_name: rest.author_name || null };
    const { error } = id ? await db().update(payload).eq('id', id) : await db().insert({ ...payload, source: 'manual' });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Saved');
    setEditing(null);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this question?')) return;
    const { error } = await db().delete().eq('id', id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const toggle = async (r: Entry) => {
    await db().update({ is_active: !r.is_active }).eq('id', r.id);
    refresh();
  };

  const downloadTemplate = () => {
    const csv = TEMPLATE_HEADERS.join(',') + '\n"SAP FICO","medium","GL","What is a document splitting?","Document splitting ...","zero-balance, segment reporting","new gl;splitting","Ahmed Ali — Senior FICO"\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'question-library-template.csv';
    a.click();
  };

  const importCsv = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return toast.error('File too large (max 2 MB)');
    const rowsCsv = parseCsv(await file.text());
    if (rowsCsv.length < 2) return toast.error('No rows found');
    const head = rowsCsv[0].map((h) => h.trim().toLowerCase());
    const idx = (k: string) => head.indexOf(k);
    if (idx('question') < 0) return toast.error('CSV needs a "question" column — download the template');
    const items = rowsCsv.slice(1).map((r) => {
      const g = (k: string) => (idx(k) >= 0 ? (r[idx(k)] || '').trim() : '');
      const d = g('difficulty').toLowerCase();
      return {
        sap_module: g('sap_module') || 'general',
        difficulty: (LEVELS as readonly string[]).includes(d) ? d : 'medium',
        category: g('category') || null,
        question: g('question').slice(0, 2000),
        best_answer: g('best_answer').slice(0, 6000),
        key_points: g('key_points') || null,
        tags: g('tags') ? g('tags').split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
        author_name: g('author_name') || null,
        source: 'import',
        is_active: true,
      };
    }).filter((x) => x.question);
    if (!items.length) return toast.error('No valid questions');
    for (let i = 0; i < items.length; i += 200) {
      const { error } = await db().insert(items.slice(i, i + 200));
      if (error) return toast.error(error.message);
    }
    toast.success(`Imported ${items.length} questions`);
    refresh();
  };

  const generate = async () => {
    setGenLoading(true);
    setDrafts([]);
    const { data, error } = await supabase.functions.invoke('generate-interview-questions', {
      body: { ...gen, topic: gen.topic || undefined },
    });
    setGenLoading(false);
    const msg = (data as any)?.error || error?.message;
    if (msg || !data?.questions) return toast.error(msg || 'Generation failed');
    setDrafts(data.questions.map((q: any) => ({ ...empty, ...q, sap_module: gen.sap_module, difficulty: gen.difficulty, keep: true })));
  };

  const saveDrafts = async () => {
    const keep = drafts.filter((d) => d.keep).map(({ keep, id, ...d }) => ({ ...d, source: 'ai', author_name: d.author_name || null }));
    if (!keep.length) return;
    const { error } = await db().insert(keep);
    if (error) return toast.error(error.message);
    toast.success(`Added ${keep.length} questions`);
    setGenOpen(false);
    setDrafts([]);
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Library className="h-6 w-6 text-primary" /> Interview question library</h1>
          <p className="text-muted-foreground text-sm mt-1">SAP interview questions with best answers. The AI interviewer asks these and scores answers against them. Admins only.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4 mr-2" />CSV template</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Import CSV</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />
          <Button variant="outline" onClick={() => setGenOpen(true)}><Sparkles className="h-4 w-4 mr-2" />AI generate</Button>
          <Button onClick={() => setEditing({ ...empty })}><Plus className="h-4 w-4 mr-2" />Add question</Button>
        </div>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Input placeholder="Search questions, answers, tags…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
          <Select value={mod} onValueChange={setMod}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All modules</SelectItem>{SAP_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={lvl} onValueChange={setLvl}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All levels</SelectItem>{LEVELS.map((l) => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}</SelectContent>
          </Select>
          <span className="ms-auto self-center text-sm text-muted-foreground">{filtered.length} of {rows.length}</span>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-40 rounded-2xl" /> : filtered.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-10 text-center text-muted-foreground">No questions yet. Add one, import a CSV, or let AI draft some.</CardContent></Card>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {filtered.map((r) => (
            <AccordionItem key={r.id} value={r.id!} className="border rounded-2xl bg-card px-4">
              <AccordionTrigger className="hover:no-underline text-start">
                <div className="flex flex-col gap-1.5 pe-3">
                  <span className={`font-medium ${r.is_active ? '' : 'text-muted-foreground line-through'}`}>{r.question}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">{r.sap_module}</Badge>
                    <Badge variant="outline" className="capitalize">{r.difficulty}</Badge>
                    {r.category && <Badge variant="outline">{r.category}</Badge>}
                    {r.source && r.source !== 'manual' && <Badge variant="outline">{r.source === 'ai' ? 'AI draft' : 'Imported'}</Badge>}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div><Label className="text-xs text-muted-foreground">Best answer</Label><p className="text-sm whitespace-pre-wrap mt-1">{r.best_answer || '—'}</p></div>
                {r.key_points && <div><Label className="text-xs text-muted-foreground">Key points</Label><p className="text-sm mt-1">{r.key_points}</p></div>}
                {r.author_name && <p className="text-xs text-muted-foreground">Written by {r.author_name}</p>}
                {r.tags.length > 0 && <div className="flex flex-wrap gap-1">{r.tags.map((t) => <Badge key={t} variant="secondary" className="text-xs">#{t}</Badge>)}</div>}
                <div className="flex items-center gap-3 pt-2 border-t">
                  <div className="flex items-center gap-2"><Switch checked={r.is_active} onCheckedChange={() => toggle(r)} /><span className="text-sm">Used in interviews</span></div>
                  <Button size="sm" variant="outline" className="ms-auto" onClick={() => setEditing({ ...r })}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => remove(r.id!)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit question' : 'Add question'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><Label>SAP module</Label>
                  <Select value={editing.sap_module} onValueChange={(v) => setEditing({ ...editing, sap_module: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SAP_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>Difficulty</Label>
                  <Select value={editing.difficulty} onValueChange={(v) => setEditing({ ...editing, difficulty: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LEVELS.map((l) => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>Category</Label><Input value={editing.category || ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="e.g. Asset accounting" /></div>
              </div>
              <div><Label>Question *</Label><Textarea rows={2} maxLength={2000} value={editing.question} onChange={(e) => setEditing({ ...editing, question: e.target.value })} /></div>
              <div><Label>Best answer</Label><Textarea rows={7} maxLength={6000} value={editing.best_answer} onChange={(e) => setEditing({ ...editing, best_answer: e.target.value })} /></div>
              <div><Label>Key points to listen for</Label><Input value={editing.key_points || ''} onChange={(e) => setEditing({ ...editing, key_points: e.target.value })} placeholder="comma-separated" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Tags</Label><Input value={editing.tags.join(', ')} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="comma-separated" /></div>
                <div><Label>Written by</Label><Input value={editing.author_name || ''} onChange={(e) => setEditing({ ...editing, author_name: e.target.value })} placeholder="Name — title" /></div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={genOpen} onOpenChange={(o) => { setGenOpen(o); if (!o) setDrafts([]); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />AI draft questions & best answers</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><Label>Module</Label>
              <Select value={gen.sap_module} onValueChange={(v) => setGen({ ...gen, sap_module: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SAP_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Difficulty</Label>
              <Select value={gen.difficulty} onValueChange={(v) => setGen({ ...gen, difficulty: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LEVELS.map((l) => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>How many</Label><Input type="number" min={1} max={10} value={gen.count} onChange={(e) => setGen({ ...gen, count: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></div>
            <div><Label>Topic (optional)</Label><Input value={gen.topic} maxLength={300} onChange={(e) => setGen({ ...gen, topic: e.target.value })} placeholder="e.g. period-end close" /></div>
          </div>
          <Button onClick={generate} disabled={genLoading}>{genLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Writing… this can take a minute</> : 'Generate drafts'}</Button>
          {drafts.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Review and edit before saving. Untick any you don't want.</p>
              {drafts.map((d, i) => (
                <Card key={i} className="rounded-xl"><CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2"><Switch checked={d.keep} onCheckedChange={(v) => setDrafts(drafts.map((x, j) => j === i ? { ...x, keep: v } : x))} /><span className="text-xs text-muted-foreground">Keep</span></div>
                  <Textarea rows={2} value={d.question} onChange={(e) => setDrafts(drafts.map((x, j) => j === i ? { ...x, question: e.target.value } : x))} />
                  <Textarea rows={5} value={d.best_answer} onChange={(e) => setDrafts(drafts.map((x, j) => j === i ? { ...x, best_answer: e.target.value } : x))} />
                  <Input value={d.key_points || ''} onChange={(e) => setDrafts(drafts.map((x, j) => j === i ? { ...x, key_points: e.target.value } : x))} />
                </CardContent></Card>
              ))}
            </div>
          )}
          {drafts.length > 0 && <DialogFooter><Button onClick={saveDrafts}>Save {drafts.filter((d) => d.keep).length} to library</Button></DialogFooter>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
