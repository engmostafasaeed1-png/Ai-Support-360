import { useState, useCallback, useEffect, useRef } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { sapModules, issueTypes } from '@/data/clientMockData';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, Check, Sparkles, Brain,
  Clock, AlertTriangle, Info, Loader2, Zap, Target, List,
  Star, BadgeCheck, Circle, Users, Crown, ChevronRight, Search, UserPlus,
  Upload, X, FileText, Paperclip,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRealtimeConsultants, type ConsultantLive } from '@/hooks/useRealtimeConsultants';
import AIModelSelector, { DEFAULT_MODEL, type AIModelId } from '@/components/ai/AIModelSelector';

interface AiCategorization {
  suggested_module: string;
  suggested_priority: string;
  category: string;
  tip: string;
  confidence: number;
}

interface AiSummary {
  summary: string;
  resolution_steps: string[];
  estimated_complexity: string;
  relevant_tcodes?: string[];
}

interface AiMatch {
  required_skills: string[];
  min_experience_years: number;
  preferred_certifications?: string[];
  matching_rationale: string;
}

interface ConsultantRecommendation {
  consultant_id: string;
  match_score: number;
  match_reason: string;
  strengths: string[];
  skill_match_score?: number;
  availability_score?: number;
  name: string;
  avatar_url?: string;
  hourly_rate: number;
  currency: string;
  rating: number;
  total_reviews: number;
  availability: string;
  response_time_minutes: number;
  languages: string[];
  verification_status: string;
  top_skills: string[];
}

interface AiMatchConsultants {
  recommendations: ConsultantRecommendation[];
  overall_rationale: string;
}

const urgencyLevels = [
  { value: 'low', label: 'urgency_low', desc: 'urgency_low_desc', color: 'border-muted hover:border-muted-foreground' },
  { value: 'medium', label: 'urgency_medium', desc: 'urgency_medium_desc', color: 'border-yellow-300 hover:border-yellow-500' },
  { value: 'high', label: 'urgency_high', desc: 'urgency_high_desc', color: 'border-orange-300 hover:border-orange-500' },
  { value: 'critical', label: 'urgency_critical', desc: 'urgency_critical_desc', color: 'border-red-300 hover:border-red-500' },
];

const sessionTypes = [
  { value: 'chat', label: 'session_chat', desc: 'session_chat_desc' },
  { value: 'video', label: 'session_video', desc: 'session_video_desc' },
  { value: 'screen_share', label: 'session_screen', desc: 'session_screen_desc' },
];

export default function NewRequestPage() {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    sap_module: '', issue_type: '', title: '', description: '',
    urgency: 'medium', preferred_session: 'video', preferred_language: 'en',
  });
  const [submitted, setSubmitted] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedModel, setSelectedModel] = useState<AIModelId>(DEFAULT_MODEL);
  const [manualPickOpen, setManualPickOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [selectedConsultant, setSelectedConsultant] = useState<ConsultantLive | null>(null);
  const { consultants: allConsultants, isLoading: consultantsLoading } = useRealtimeConsultants();

  // Auto-fill from chatbot query params
  useEffect(() => {
    const module = searchParams.get('module');
    const title = searchParams.get('title');
    const description = searchParams.get('description');
    const urgency = searchParams.get('urgency');
    if (module || title || description || urgency) {
      setForm(prev => ({
        ...prev,
        ...(module && { sap_module: module }),
        ...(title && { title }),
        ...(description && { description }),
        ...(urgency && { urgency }),
      }));
      // Jump to step 1 (details) if module is filled, or step 0 if not
      setStep(module ? 1 : 0);
      // Clear params
      setSearchParams({}, { replace: true });
    }
  }, []);
  const [aiCategorization, setAiCategorization] = useState<AiCategorization | null>(null);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiMatch, setAiMatch] = useState<AiMatch | null>(null);
  const [aiRecommendations, setAiRecommendations] = useState<AiMatchConsultants | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const steps = [
    t('ticket_create.step_module'),
    t('ticket_create.step_details'),
    t('ticket_create.step_urgency'),
    t('ticket_create.step_review'),
  ];

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleAiError = (data: any): boolean => {
    if (data?.error === 'Credits exhausted') {
      toast.error('AI credits exhausted. Please contact your administrator to add funds.');
      return true;
    }
    if (data?.error === 'Rate limited') {
      toast.error('AI is busy, please try again in a moment.');
      return true;
    }
    if (data?.error) {
      toast.error(data.error);
      return true;
    }
    return false;
  };

  const runAiCategorize = useCallback(async () => {
    if (form.description.length < 15) return;
    setAiLoading('categorize');
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: { action: 'categorize', title: form.title, description: form.description, sap_module: form.sap_module, model: selectedModel },
      });
      if (error) throw error;
      if (handleAiError(data)) return;
      if (data?.result) setAiCategorization(data.result);
    } catch (err) {
      console.error('AI categorization failed:', err);
      toast.error('AI categorization failed. You can continue without it.');
    } finally {
      setAiLoading(null);
    }
  }, [form.title, form.description, form.sap_module, selectedModel]);

  const runAiSummary = useCallback(async () => {
    setAiLoading('summary');
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: { action: 'summarize', title: form.title, description: form.description, sap_module: form.sap_module, urgency: form.urgency, model: selectedModel },
      });
      if (error) throw error;
      if (handleAiError(data)) return;
      if (data?.result) setAiSummary(data.result);
    } catch (err) {
      console.error('AI summary failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [form.title, form.description, form.sap_module, form.urgency, selectedModel]);

  const runAiMatch = useCallback(async () => {
    setAiLoading('match');
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: { action: 'match', title: form.title, description: form.description, sap_module: form.sap_module, urgency: form.urgency, model: selectedModel },
      });
      if (error) throw error;
      if (handleAiError(data)) return;
      if (data?.result) setAiMatch(data.result);
    } catch (err) {
      console.error('AI matching failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [form.title, form.description, form.sap_module, form.urgency, selectedModel]);

  const runAiMatchConsultants = useCallback(async () => {
    setAiLoading('match_consultants');
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: {
          action: 'match_consultants',
          title: form.title,
          description: form.description,
          sap_module: form.sap_module,
          urgency: form.urgency,
          preferred_language: form.preferred_language,
          model: selectedModel,
        },
      });
      if (error) throw error;
      if (handleAiError(data)) return;
      if (data?.result) setAiRecommendations(data.result);
    } catch (err) {
      console.error('AI consultant matching failed:', err);
      toast.error('Could not load expert recommendations');
    } finally {
      setAiLoading(null);
    }
  }, [form.title, form.description, form.sap_module, form.urgency, form.preferred_language, selectedModel]);

  const handleNext = () => {
    if (step === 1 && !aiCategorization && form.description.length > 15) {
      runAiCategorize();
    }
    if (step === 2) {
      runAiSummary();
      runAiMatch();
      runAiMatchConsultants();
    }
    if (step < steps.length - 1) setStep(step + 1);
  };

  const handleSubmit = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error(t('onboarding.error_auth')); return; }

      const { data: ticketData, error } = await supabase.from('tickets').insert({
        client_id: user.id,
        tenant_id: tenant?.id || null,
        sap_module: form.sap_module,
        title: form.title,
        description: form.description,
        urgency: form.urgency as any,
        preferred_session_type: form.preferred_session as any,
        preferred_language: form.preferred_language,
        ai_suggested_category: aiCategorization?.category || null,
        ai_suggested_priority: aiCategorization?.suggested_priority || null,
      }).select('id').single();

      if (error) throw error;

      // Upload attached files
      if (ticketData && attachedFiles.length > 0) {
        for (const file of attachedFiles) {
          const storagePath = `${ticketData.id}/${user.id}/${Date.now()}_${file.name}`;
          await supabase.storage.from('ticket-documents').upload(storagePath, file);
          await supabase.from('ticket_documents').insert({
            ticket_id: ticketData.id,
            uploaded_by: user.id,
            file_name: file.name,
            file_url: storagePath,
            file_size: file.size,
            mime_type: file.type || null,
            version: 1,
          } as any);
        }
      }

      setSubmitted(true);
      toast.success(t('ticket_create.submit_success'));
    } catch (err) {
      console.error(err);
      toast.error(t('onboarding.error_generic'));
    }
  };

  // ====== SUCCESS PAGE WITH RECOMMENDATIONS ======
  if (submitted) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 py-8">
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">{t('ticket_create.submitted_title')}</h2>
          <p className="text-muted-foreground mb-6">{t('ticket_create.submitted_desc')}</p>
        </div>

        {/* AI Recommended Consultants */}
        <Card className="rounded-2xl border-accent/20 bg-accent/5">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Crown className="w-4 h-4 text-accent" />
                AI-Recommended Experts for Your Ticket
              </CardTitle>
              {aiRecommendations && <p className="text-xs text-muted-foreground mt-1">{aiRecommendations.overall_rationale}</p>}
            </div>
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setManualPickOpen(true)}>
              <UserPlus className="w-3.5 h-3.5" /> Choose Manually
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedConsultant && (
              <div className="p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                  {selectedConsultant.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{selectedConsultant.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedConsultant.specialty} · ${selectedConsultant.rate}/hr</p>
                </div>
                <Badge className="bg-accent text-accent-foreground text-[10px]">Your Pick</Badge>
              </div>
            )}
            {aiRecommendations && aiRecommendations.recommendations.length > 0 ? (
              aiRecommendations.recommendations.slice(0, 5).map((rec, i) => (
                <RecommendationCard key={rec.consultant_id} rec={rec} rank={i + 1} navigate={navigate} />
              ))
            ) : !selectedConsultant ? (
              <p className="text-sm text-muted-foreground text-center py-4">No AI recommendations. Use "Choose Manually" to pick an expert.</p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-center">
          <Button onClick={() => {
            setSubmitted(false); setStep(0);
            setForm({ sap_module: '', issue_type: '', title: '', description: '', urgency: 'medium', preferred_session: 'video', preferred_language: 'en' });
            setAiCategorization(null); setAiSummary(null); setAiMatch(null); setAiRecommendations(null); setAttachedFiles([]);
          }} variant="outline">
            {t('ticket_create.submit_another')}
          </Button>
          <Button className="gradient-primary border-0" asChild>
            <a href="/client">{t('ticket_create.back_dashboard')}</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('ticket_create.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('ticket_create.subtitle')}</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${i <= step ? 'gradient-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {i < step ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${i <= step ? 'text-foreground' : 'text-muted-foreground'}`}>{s}</span>
            {i < steps.length - 1 && <div className={`h-0.5 flex-1 ${i < step ? 'bg-accent' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      {/* AI Model Selector */}
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{t('ai.engine', 'AI Engine')}:</span>
        <AIModelSelector value={selectedModel} onChange={setSelectedModel} compact />
      </div>

      {step === 0 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader><CardTitle className="text-base">{t('ticket_create.select_module')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {sapModules.map(mod => (
                <button key={mod} onClick={() => updateForm('sap_module', mod)}
                  className={`p-3 rounded-xl border text-sm text-start transition-all ${form.sap_module === mod ? 'border-accent bg-accent/10 text-foreground font-medium' : 'border-border/50 text-muted-foreground hover:border-accent/30'}`}>
                  {mod}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Issue Details */}
      {step === 1 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader><CardTitle className="text-base">{t('ticket_create.issue_details')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('ticket_create.issue_type')}</label>
              <div className="grid grid-cols-2 gap-2">
                {issueTypes.map(type => (
                  <button key={type} onClick={() => updateForm('issue_type', type)}
                    className={`p-2.5 rounded-xl border text-sm text-start transition-all ${form.issue_type === type ? 'border-accent bg-accent/10 text-foreground font-medium' : 'border-border/50 text-muted-foreground hover:border-accent/30'}`}>
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('ticket_create.ticket_title')}</label>
              <Input value={form.title} onChange={e => updateForm('title', e.target.value)} placeholder={t('ticket_create.title_placeholder')} className="rounded-xl" maxLength={200} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('ticket_create.description')}</label>
              <Textarea value={form.description} onChange={e => updateForm('description', e.target.value)} placeholder={t('ticket_create.desc_placeholder')} rows={5} className="rounded-xl" maxLength={2000} />
            </div>

            {/* File Attachments */}
            <div>
              <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" /> Attachments
              </label>
              <div className="p-3 rounded-xl border-2 border-dashed border-border/50 bg-muted/20 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const valid = files.filter(f => f.size <= 20 * 1024 * 1024);
                    if (valid.length < files.length) toast.error('Some files exceed 20MB limit');
                    setAttachedFiles(prev => [...prev, ...valid]);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3.5 h-3.5" /> Add Files
                  </Button>
                  <span className="text-[11px] text-muted-foreground">Screenshots, logs, error reports (max 20MB each)</span>
                </div>
                {attachedFiles.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {attachedFiles.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 text-sm">
                        <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="truncate flex-1 text-foreground">{file.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{(file.size / 1024).toFixed(0)} KB</span>
                        <button
                          type="button"
                          onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {form.description.length > 15 && !aiCategorization && (
              <Button variant="outline" size="sm" onClick={runAiCategorize} disabled={aiLoading === 'categorize'} className="gap-1.5">
                {aiLoading === 'categorize' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                {t('ticket_create.ai_analyze')}
              </Button>
            )}

            {aiCategorization && (
              <div className="p-4 rounded-xl bg-accent/5 border border-accent/20">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-accent">{t('ticket_create.ai_triage')}</span>
                  <Badge variant="secondary" className="text-[9px] ms-auto">{aiCategorization.confidence}% {t('ticket_create.confidence')}</Badge>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent">{t('ticket_create.suggested_category')}</Badge>
                    <span>{aiCategorization.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent">{t('ticket_create.suggested_module')}</Badge>
                    <span>{aiCategorization.suggested_module}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={`text-[10px] ${aiCategorization.suggested_priority === 'critical' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                      {t('ticket_create.suggested_priority')}
                    </Badge>
                    <span className="capitalize">{aiCategorization.suggested_priority}</span>
                  </div>
                  <div className="flex items-start gap-2 mt-2">
                    <Info className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <p className="text-muted-foreground text-xs">{aiCategorization.tip}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Urgency & Preferences */}
      {step === 2 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader><CardTitle className="text-base">{t('ticket_create.urgency_prefs')}</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-3 block">{t('ticket_create.urgency_level')}</label>
              <div className="grid grid-cols-2 gap-3">
                {urgencyLevels.map(level => (
                  <button key={level.value} onClick={() => updateForm('urgency', level.value)}
                    className={`p-4 rounded-xl border-2 text-start transition-all ${form.urgency === level.value ? 'border-accent bg-accent/5' : level.color}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {level.value === 'critical' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                      <span className="text-sm font-semibold">{t(`ticket_create.${level.label}`)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{t(`ticket_create.${level.desc}`)}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-3 block">{t('ticket_create.session_type')}</label>
              <div className="grid grid-cols-3 gap-3">
                {sessionTypes.map(type => (
                  <button key={type.value} onClick={() => updateForm('preferred_session', type.value)}
                    className={`p-4 rounded-xl border text-center transition-all ${form.preferred_session === type.value ? 'border-accent bg-accent/10' : 'border-border/50 hover:border-accent/30'}`}>
                    <span className="text-sm font-medium">{t(`ticket_create.${type.label}`)}</span>
                    <p className="text-xs text-muted-foreground mt-1">{t(`ticket_create.${type.desc}`)}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-3 block">{t('client_onboarding.preferred_language')}</label>
              <div className="flex gap-3">
                {[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }].map(lang => (
                  <button key={lang.value} onClick={() => updateForm('preferred_language', lang.value)}
                    className={`px-6 py-3 rounded-xl border transition-all ${form.preferred_language === lang.value ? 'border-accent bg-accent/10 font-medium' : 'border-border/50 text-muted-foreground hover:border-accent/30'}`}>
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Review with AI insights */}
      {step === 3 && (
        <div className="space-y-4">
          <Card className="rounded-2xl border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                {t('ticket_create.review_title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('ticket_create.select_module')}</p>
                  <p className="text-sm font-medium">{form.sap_module || '—'}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('ticket_create.issue_type')}</p>
                  <p className="text-sm font-medium">{form.issue_type || '—'}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('ticket_create.urgency_level')}</p>
                  <Badge variant="secondary" className="text-xs capitalize">{form.urgency}</Badge>
                </div>
                <div className="p-3 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('ticket_create.session_type')}</p>
                  <p className="text-sm font-medium capitalize">{form.preferred_session.replace('_', ' ')}</p>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-0.5">{t('ticket_create.ticket_title')}</p>
                <p className="text-sm font-medium">{form.title || '—'}</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-0.5">{t('ticket_create.description')}</p>
                <p className="text-sm whitespace-pre-wrap">{form.description || '—'}</p>
              </div>
            </CardContent>
          </Card>

          {/* AI Summary */}
          {(aiLoading === 'summary' || aiSummary) && (
            <Card className="rounded-2xl border-accent/20 bg-accent/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-accent">{t('ticket_create.ai_summary')}</span>
                </div>
                {aiLoading === 'summary' ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('ticket_create.ai_analyzing')}
                  </div>
                ) : aiSummary && (
                  <div className="space-y-3">
                    <p className="text-sm">{aiSummary.summary}</p>
                    {aiSummary.resolution_steps.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-accent mb-1.5 flex items-center gap-1">
                          <List className="w-3 h-3" />
                          {t('ticket_create.resolution_steps')}
                        </p>
                        <ol className="space-y-1 list-decimal list-inside">
                          {aiSummary.resolution_steps.map((s, i) => (
                            <li key={i} className="text-xs text-muted-foreground">{s}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {aiSummary.relevant_tcodes && aiSummary.relevant_tcodes.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">T-Codes:</span>
                        {aiSummary.relevant_tcodes.map(tc => (
                          <Badge key={tc} variant="outline" className="text-[9px] font-mono">{tc}</Badge>
                        ))}
                      </div>
                    )}
                    <Badge variant="secondary" className="text-[9px]">
                      {t('ticket_create.complexity')}: {aiSummary.estimated_complexity}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* AI Consultant Match Criteria */}
          {(aiLoading === 'match' || aiMatch) && (
            <Card className="rounded-2xl border-accent/20 bg-accent/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-accent">{t('ticket_create.ai_matching')}</span>
                </div>
                {aiLoading === 'match' ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('ticket_create.ai_matching_desc')}
                  </div>
                ) : aiMatch && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{aiMatch.matching_rationale}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] text-muted-foreground">{t('ticket_create.required_skills')}:</span>
                      {aiMatch.required_skills.map(skill => (
                        <Badge key={skill} variant="secondary" className="text-[9px]">{skill}</Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Min. {aiMatch.min_experience_years}+ {t('onboarding.years_experience')}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{t('ticket_create.avg_match_time')}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* AI Recommended Consultants */}
          {(aiLoading === 'match_consultants' || aiRecommendations || true) && (
            <Card className="rounded-2xl border-accent/20 bg-gradient-to-br from-accent/5 to-primary/5">
              <CardHeader className="pb-2 flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Crown className="w-4 h-4 text-accent" />
                  AI-Recommended Experts
                </CardTitle>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setManualPickOpen(true)}>
                  <UserPlus className="w-3.5 h-3.5" /> Browse & Choose Manually
                </Button>
              </CardHeader>
              <CardContent>
                {/* Selected consultant banner */}
                {selectedConsultant && (
                  <div className="mb-4 p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                      {selectedConsultant.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{selectedConsultant.name}</p>
                      <p className="text-xs text-muted-foreground">{selectedConsultant.specialty} · ${selectedConsultant.rate}/hr</p>
                    </div>
                    <Badge className="bg-accent text-accent-foreground text-[10px]">Selected</Badge>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedConsultant(null)}>Remove</Button>
                  </div>
                )}

                {aiLoading === 'match_consultants' ? (
                  <div className="flex items-center gap-3 py-6 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-accent" />
                    <span className="text-sm text-muted-foreground">Analyzing consultants and ranking best matches...</span>
                  </div>
                ) : aiRecommendations && aiRecommendations.recommendations.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground mb-3">{aiRecommendations.overall_rationale}</p>
                    {aiRecommendations.recommendations.slice(0, 5).map((rec, i) => (
                      <RecommendationCard key={rec.consultant_id} rec={rec} rank={i + 1} navigate={navigate} />
                    ))}
                  </div>
                ) : !selectedConsultant ? (
                  <div className="py-6 text-center">
                    <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No AI recommendations yet. Use "Browse & Choose Manually" to pick an expert.</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Manual Consultant Picker Dialog */}
          <Dialog open={manualPickOpen} onOpenChange={setManualPickOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-accent" />
                  Browse & Select Expert
                </DialogTitle>
              </DialogHeader>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, specialty, or skill..."
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ScrollArea className="h-[50vh]">
                <div className="space-y-2 pr-4">
                  {consultantsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
                    ))
                  ) : (
                    allConsultants
                      .filter(c => {
                        if (!manualSearch) return true;
                        const q = manualSearch.toLowerCase();
                        return c.name.toLowerCase().includes(q) || c.specialty.toLowerCase().includes(q) || c.city.toLowerCase().includes(q);
                      })
                      .map(c => (
                        <div
                          key={c.id}
                          className={`p-3 rounded-xl border cursor-pointer transition-all hover:shadow-sm ${
                            selectedConsultant?.id === c.id
                              ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                              : 'border-border/50 hover:border-accent/30'
                          }`}
                          onClick={() => {
                            setSelectedConsultant(c);
                            setManualPickOpen(false);
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                              {c.avatar}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-foreground">{c.name}</h4>
                                {c.verification_status === 'verified' && <BadgeCheck className="w-3.5 h-3.5 text-accent" />}
                                {c.available && (
                                  <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5">
                                    <Circle className="w-1.5 h-1.5 fill-green-500 text-green-500" /> Online
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{c.specialty} · {c.city}</p>
                            </div>
                            <div className="text-end shrink-0">
                              <div className="flex items-center gap-1">
                                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                                <span className="text-xs font-semibold">{c.rating}</span>
                              </div>
                              <p className="text-xs font-semibold text-foreground">${c.rate}<span className="text-muted-foreground font-normal">/hr</span></p>
                            </div>
                          </div>
                        </div>
                      ))
                  )}
                  {!consultantsLoading && allConsultants.filter(c => {
                    if (!manualSearch) return true;
                    const q = manualSearch.toLowerCase();
                    return c.name.toLowerCase().includes(q) || c.specialty.toLowerCase().includes(q) || c.city.toLowerCase().includes(q);
                  }).length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">No consultants found</div>
                  )}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(step - 1)} disabled={step === 0}>
          <ArrowLeft className="w-4 h-4 me-1 rtl:rotate-180" /> {t('onboarding.back')}
        </Button>
        {step < steps.length - 1 ? (
          <Button onClick={handleNext} className="gradient-primary border-0">
            {t('onboarding.next')} <ArrowRight className="w-4 h-4 ms-1 rtl:rotate-180" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} className="gradient-primary border-0">
            <Check className="w-4 h-4 me-1" /> {t('ticket_create.submit_request')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ====== Recommendation Card Component ======
function RecommendationCard({ rec, rank, navigate }: { rec: ConsultantRecommendation; rank: number; navigate: (path: string) => void }) {
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400';
    if (score >= 75) return 'text-accent bg-accent/10';
    return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400';
  };

  const getRankBadge = (r: number) => {
    if (r === 1) return { label: 'Best Match', cls: 'bg-gradient-to-r from-yellow-400 to-amber-500 text-white' };
    if (r === 2) return { label: '#2', cls: 'bg-muted text-foreground' };
    if (r === 3) return { label: '#3', cls: 'bg-muted text-foreground' };
    return { label: `#${r}`, cls: 'bg-muted text-muted-foreground' };
  };

  const rankBadge = getRankBadge(rank);
  const initials = rec.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="p-4 rounded-xl bg-background border border-border/50 hover:border-accent/30 hover:shadow-sm transition-all">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative shrink-0">
          {rec.avatar_url ? (
            <img src={rec.avatar_url} alt={rec.name} className="w-12 h-12 rounded-xl object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
              {initials}
            </div>
          )}
          <span className={`absolute -top-1 -end-1 w-3.5 h-3.5 rounded-full border-2 border-background ${rec.availability === 'available' ? 'bg-green-500' : rec.availability === 'busy' ? 'bg-yellow-500' : 'bg-muted-foreground/40'}`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm text-foreground">{rec.name}</h4>
            <Badge className={`text-[9px] px-1.5 py-0 h-4 ${rankBadge.cls}`}>{rankBadge.label}</Badge>
            {rec.verification_status === 'verified' && (
              <BadgeCheck className="w-3.5 h-3.5 text-accent shrink-0" />
            )}
          </div>

          {/* Match Score */}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${getScoreColor(rec.match_score)}`}>
              {rec.match_score}% match
            </span>
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              <span className="text-xs font-medium">{rec.rating}</span>
              <span className="text-[10px] text-muted-foreground">({rec.total_reviews})</span>
            </div>
            {rec.availability === 'available' && (
              <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5">
                <Circle className="w-1.5 h-1.5 fill-green-500 text-green-500" /> Online
              </span>
            )}
          </div>

          {/* Match reason */}
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{rec.match_reason}</p>

          {/* Strengths & Skills */}
          <div className="flex flex-wrap gap-1 mt-2">
            {rec.strengths?.slice(0, 3).map((s, i) => (
              <Badge key={i} variant="secondary" className="text-[9px] bg-accent/10 text-accent">{s}</Badge>
            ))}
          </div>

          {/* Bottom row */}
          <div className="flex items-center justify-between mt-2.5">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">${rec.hourly_rate}<span className="font-normal text-muted-foreground">/hr</span></span>
              {rec.response_time_minutes > 0 && (
                <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{rec.response_time_minutes}min avg</span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] gap-1"
              onClick={() => navigate(`/client/consultants/${rec.consultant_id}`)}
            >
              View Profile <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
