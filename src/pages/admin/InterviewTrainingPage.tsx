import { useState } from 'react';
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
  CheckCircle, AlertTriangle, Settings2,
} from 'lucide-react';
import { toast } from 'sonner';

interface TrainingConfig {
  id: string;
  sap_module: string;
  custom_questions: { question: string; expected_topics: string; weight: number }[];
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
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newConfig, setNewConfig] = useState(false);

  const [form, setForm] = useState({
    sap_module: 'general',
    difficulty_level: 'medium',
    training_instructions: '',
    is_active: true,
    custom_questions: [] as { question: string; expected_topics: string; weight: number }[],
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

  const isEditing = editingId !== null || newConfig;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            AI Interviewer Training
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure custom questions, difficulty, and training instructions for the AI interviewer.
          </p>
        </div>
        {!isEditing && (
          <Button onClick={startNew} className="gradient-primary border-0">
            <Plus className="w-4 h-4 me-1.5" /> New Training Config
          </Button>
        )}
      </div>

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
            <div className="grid grid-cols-3 gap-4">
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
                rows={3}
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">These instructions guide the AI interviewer's behavior and focus areas.</p>
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
    </div>
  );
}
