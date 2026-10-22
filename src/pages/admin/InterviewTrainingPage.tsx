import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Brain, Plus, Trash2, Save, GripVertical, Lightbulb, Target, BookOpen,
  CheckCircle, AlertTriangle, Settings2, Upload, FileText, X, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { extractFileText, TRAINING_FILE_ACCEPT } from '@/lib/extractFileText';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import KnowledgeDocumentsPanel from '@/components/admin/interview-knowledge/KnowledgeDocumentsPanel';
import KnowledgeCoveragePanel from '@/components/admin/interview-knowledge/KnowledgeCoveragePanel';
import KnowledgePreviewPanel from '@/components/admin/interview-knowledge/KnowledgePreviewPanel';
import KnowledgeSettingsPanel from '@/components/admin/interview-knowledge/KnowledgeSettingsPanel';
import { useKnowledgeReady, useKnowledgeSettings } from '@/hooks/useInterviewKnowledge';

interface TrainingConfig {
  id: string;
  sap_module: string;
  custom_questions: { question: string; expected_topics: string; weight: number; author_name?: string }[];
  training_instructions: string | null;
  difficulty_level: string;
  is_active: boolean;
  created_at: string;
}

const SAP_MODULES = [
  'general', 'SAP FICO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP HCM', 'SAP ABAP',
  'SAP Basis', 'SAP BW', 'SAP CRM', 'SAP HANA', 'S/4HANA', 'SAP Fiori',
  'SAP SuccessFactors', 'SAP Ariba', 'SAP Integration',
];

export default function InterviewTrainingPage() {
  const { t } = useTranslation();
  const knowledgeReady = useKnowledgeReady();
  const knowledgeSettings = useKnowledgeSettings();
  const ready = knowledgeReady.data === true;
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newConfig, setNewConfig] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<{ name: string; text: string }[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genCount, setGenCount] = useState(5);

  const [form, setForm] = useState({
    sap_module: 'general',
    difficulty_level: 'medium',
    training_instructions: '',
    is_active: true,
    custom_questions: [] as { question: string; expected_topics: string; weight: number; author_name?: string }[],
  });

  const { data: configs, isLoading } = useQuery({
    queryKey: ['interview-training-configs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interview_training_config')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as TrainingConfig[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (config: typeof form & { id?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (config.id) {
        const { error } = await supabase.from('interview_training_config').update({
          sap_module: config.sap_module,
          difficulty_level: config.difficulty_level,
          training_instructions: config.training_instructions || null,
          is_active: config.is_active,
          custom_questions: config.custom_questions as any,
        }).eq('id', config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('interview_training_config').insert([{
          sap_module: config.sap_module,
          difficulty_level: config.difficulty_level,
          training_instructions: config.training_instructions || null,
          is_active: config.is_active,
          custom_questions: config.custom_questions as any,
          created_by: user?.id,
        }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interview-training-configs'] });
      toast.success('Training config saved');
      setEditingId(null);
      setNewConfig(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('interview_training_config').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interview-training-configs'] });
      toast.success('Config deleted');
    },
  });

  const startEdit = (config: TrainingConfig) => {
    setEditingId(config.id);
    setNewConfig(false);
    setForm({
      sap_module: config.sap_module,
      difficulty_level: config.difficulty_level,
      training_instructions: config.training_instructions || '',
      is_active: config.is_active,
      custom_questions: (config.custom_questions || []) as any,
    });
  };

  const startNew = () => {
    setNewConfig(true);
    setEditingId(null);
    setForm({
      sap_module: 'general',
      difficulty_level: 'medium',
      training_instructions: '',
      is_active: true,
      custom_questions: [],
    });
  };

  const addQuestion = () => {
    setForm(f => ({
      ...f,
      custom_questions: [...f.custom_questions, { question: '', expected_topics: '', weight: 1 }],
    }));
  };

  const removeQuestion = (idx: number) => {
    setForm(f => ({
      ...f,
      custom_questions: f.custom_questions.filter((_, i) => i !== idx),
    }));
  };

  const updateQuestion = (idx: number, field: string, value: any) => {
    setForm(f => ({
      ...f,
      custom_questions: f.custom_questions.map((q, i) =>
        i === idx ? { ...q, [field]: value } : q
      ),
    }));
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setExtracting(true);
    const added: { name: string; text: string }[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await extractFileText(file);
        if (!text) { toast.error(`${file.name}: no readable text found`); continue; }
        added.push({ name: file.name, text });
      } catch (e: any) {
        toast.error(e?.message || `Could not read ${file.name}`);
      }
    }
    setExtracting(false);
    if (!added.length) return;
    setSources(prev => [...prev, ...added]);
    setForm(f => {
      const blocks = added.map(a => `--- Reference: ${a.name} ---\n${a.text.slice(0, 6000)}`).join('\n\n');
      const next = [f.training_instructions.trim(), blocks].filter(Boolean).join('\n\n');
      return { ...f, training_instructions: next.slice(0, 20000) };
    });
    toast.success(`${added.length} file(s) added`);
  };

  const generateFromFiles = async () => {
    const source_text = sources.map(s => `# ${s.name}\n${s.text}`).join('\n\n').slice(0, 80000);
    if (!source_text) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-interview-questions', {
        body: { sap_module: form.sap_module, difficulty: form.difficulty_level, count: genCount, source_text },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      const qs = (data?.questions || []) as { question: string; best_answer: string; key_points: string; category: string }[];
      if (!qs.length) throw new Error('No questions generated');
      setForm(f => ({
        ...f,
        custom_questions: [...f.custom_questions, ...qs.map(q => ({ question: q.question, expected_topics: q.key_points, weight: 2 }))],
      }));
      const { data: u } = await supabase.auth.getUser();
      await supabase.from('interview_question_library' as any).insert(qs.map(q => ({
        sap_module: form.sap_module, difficulty: form.difficulty_level, category: q.category || null,
        question: q.question, best_answer: q.best_answer, key_points: q.key_points,
        source: 'ai', created_by: u.user?.id ?? null,
      })) as any);
      toast.success(`${qs.length} questions added — remember to Save Config`);
    } catch (e: any) {
      toast.error(e?.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const isEditing = editingId !== null || newConfig;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            AI Interviewer Training
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure custom questions, difficulty, and training instructions for the AI interviewer.
          </p>
        </div>
      </div>

      {knowledgeReady.data === false && (
        <p role="status" className="rounded-xl border border-border/60 bg-muted/50 p-3 text-sm text-muted-foreground">
          {t('ik.not_applied', 'Knowledge documents, coverage and the consultant preview need a database update that is prepared but not applied yet. Until then interviews work as before.')}
        </p>
      )}
      {ready && knowledgeSettings.data && (
        <p className="text-xs text-muted-foreground">
          {knowledgeSettings.data.enabled ? t('ik.state_on', 'Knowledge base is ON for interview questions.') : t('ik.state_off', 'Knowledge base is OFF: interviews use the current behaviour until it is switched on in Settings.')}
        </p>
      )}

      <Tabs defaultValue="configs" className="space-y-4">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="w-max">
            <TabsTrigger value="configs">{t('ik.tabs.configs', 'Training configs')}</TabsTrigger>
            <TabsTrigger value="documents">{t('ik.tabs.documents', 'Knowledge documents')}</TabsTrigger>
            <TabsTrigger value="coverage">{t('ik.tabs.coverage', 'Coverage')}</TabsTrigger>
            <TabsTrigger value="preview">{t('ik.tabs.preview', 'Preview for a consultant')}</TabsTrigger>
            <TabsTrigger value="settings">{t('ik.tabs.settings', 'Settings')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="documents"><KnowledgeDocumentsPanel ready={ready} /></TabsContent>
        <TabsContent value="coverage"><KnowledgeCoveragePanel ready={ready} /></TabsContent>
        <TabsContent value="preview"><KnowledgePreviewPanel ready={ready} /></TabsContent>
        <TabsContent value="settings"><KnowledgeSettingsPanel ready={ready} /></TabsContent>
        <TabsContent value="configs" className="space-y-6">
        {!isEditing && (
          <div className="flex justify-end">
            <Button onClick={startNew} className="gradient-primary border-0">
              <Plus className="w-4 h-4 me-1.5" /> New Training Config
            </Button>
          </div>
        )}

      {/* Editor */}
      {isEditing && (
        <Card className="rounded-2xl border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              {editingId ? 'Edit Training Config' : 'New Training Config'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs mb-1.5 block">SAP Module</Label>
                <Select value={form.sap_module} onValueChange={v => setForm(f => ({ ...f, sap_module: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SAP_MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Difficulty Level</Label>
                <Select value={form.difficulty_level} onValueChange={v => setForm(f => ({ ...f, difficulty_level: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                  <Label className="text-xs">Active</Label>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1.5 block flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Training Instructions
              </Label>
              <Textarea
                value={form.training_instructions}
                onChange={e => setForm(f => ({ ...f, training_instructions: e.target.value }))}
                placeholder="E.g., Focus on real-world troubleshooting scenarios. Ask about config steps for month-end closing. Probe for S/4HANA migration experience..."
                rows={5}
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">These instructions guide the AI interviewer's behavior and focus areas.</p>

              <div className="mt-3 p-3 rounded-xl border border-dashed border-border bg-background space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileInputRef} type="file" multiple accept={TRAINING_FILE_ACCEPT} className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
                  <Button size="sm" variant="outline" className="text-xs h-8" disabled={extracting} onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-3.5 h-3.5 me-1.5" /> {extracting ? 'Reading files...' : 'Upload files'}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">PDF, Word (.docx), TXT, MD or CSV — up to 10 MB each</span>
                </div>
                {sources.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {sources.map((s, i) => (
                        <Badge key={i} variant="secondary" className="gap-1.5">
                          <FileText className="w-3 h-3" /> {s.name} · {Math.round(s.text.length / 1000)}k chars
                          <button aria-label={`Remove ${s.name}`} onClick={() => setSources(prev => prev.filter((_, j) => j !== i))}><X className="w-3 h-3" /></button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={String(genCount)} onValueChange={v => setGenCount(Number(v))}>
                        <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[3, 5, 8, 10].map(n => <SelectItem key={n} value={String(n)}>{n} questions</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="text-xs h-8 gradient-primary border-0" disabled={generating} onClick={generateFromFiles}>
                        <Sparkles className="w-3.5 h-3.5 me-1.5" /> {generating ? 'Generating...' : 'Generate questions from files'}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">The file content is also added to the instructions above, so the AI interviewer uses it during interviews. Generated questions are added to the Mandatory Questions list and the Question library.</p>
                  </>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-primary" /> Mandatory Questions ({form.custom_questions.length})
                </Label>
                <Button size="sm" variant="outline" onClick={addQuestion} className="text-xs h-7">
                  <Plus className="w-3 h-3 me-1" /> Add Question
                </Button>
              </div>
              {form.custom_questions.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border/50 rounded-xl">
                  No mandatory questions yet. The AI will ask its own relevant questions.
                </div>
              ) : (
                <div className="space-y-3">
                  {form.custom_questions.map((q, i) => (
                    <div key={i} className="flex gap-3 items-start p-3 rounded-xl bg-background border border-border/50">
                      <GripVertical className="w-4 h-4 text-muted-foreground/40 mt-2 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Input
                          value={q.question}
                          onChange={e => updateQuestion(i, 'question', e.target.value)}
                          placeholder="e.g., Explain the SAP FICO month-end closing process step by step."
                          className="text-sm"
                        />
                        <Input
                          value={q.author_name || ''}
                          onChange={e => updateQuestion(i, 'author_name', e.target.value)}
                          placeholder="Written by (real consultant), e.g. Ahmed Ali — Senior SAP FICO Consultant"
                          className="text-xs"
                          maxLength={120}
                        />
                        <div className="flex gap-2">
                          <Input
                            value={q.expected_topics}
                            onChange={e => updateQuestion(i, 'expected_topics', e.target.value)}
                            placeholder="Expected keywords: GL posting, reconciliation, balance carry-forward..."
                            className="text-xs flex-1"
                          />
                          <Select value={String(q.weight)} onValueChange={v => updateQuestion(i, 'weight', Number(v))}>
                            <SelectTrigger className="w-24 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Normal</SelectItem>
                              <SelectItem value="2">Important</SelectItem>
                              <SelectItem value="3">Critical</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => removeQuestion(i)} className="shrink-0 text-red-400 hover:text-red-600 h-8 w-8">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => saveMutation.mutate({ ...form, id: editingId || undefined })} disabled={saveMutation.isPending} className="gradient-primary border-0">
                <Save className="w-4 h-4 me-1.5" /> {saveMutation.isPending ? 'Saving...' : 'Save Config'}
              </Button>
              <Button variant="outline" onClick={() => { setEditingId(null); setNewConfig(false); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (configs || []).length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-12 text-center">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground">No Training Configs Yet</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Create training configurations to customize AI interview behavior per SAP module.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(configs || []).map(config => (
            <Card key={config.id} className={`rounded-2xl border-border/50 ${!config.is_active ? 'opacity-60' : ''}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      config.is_active ? 'bg-primary/10' : 'bg-muted'
                    }`}>
                      <Brain className={`w-5 h-5 ${config.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{config.sap_module}</h3>
                        <Badge variant="secondary" className={`text-[10px] ${
                          config.difficulty_level === 'easy' ? 'bg-green-100 text-green-700' :
                          config.difficulty_level === 'medium' ? 'bg-blue-100 text-blue-700' :
                          config.difficulty_level === 'hard' ? 'bg-orange-100 text-orange-700' :
                          'bg-red-100 text-red-700'
                        }`}>{config.difficulty_level}</Badge>
                        {config.is_active ? (
                          <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                            <CheckCircle className="w-2.5 h-2.5 me-0.5" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
                            <AlertTriangle className="w-2.5 h-2.5 me-0.5" /> Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {config.training_instructions || 'No custom instructions'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(config.custom_questions || []).length} mandatory question(s)
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => startEdit(config)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-xs text-red-500 hover:text-red-700" onClick={() => deleteMutation.mutate(config.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
