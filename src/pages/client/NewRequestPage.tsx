import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { sapModules, issueTypes } from '@/data/clientMockData';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, Check, Upload, Sparkles, Brain,
  Clock, AlertTriangle, Info, Loader2, Zap, Target, List,
} from 'lucide-react';

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
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    sap_module: '', issue_type: '', title: '', description: '',
    urgency: 'medium', preferred_session: 'video', preferred_language: 'en',
  });
  const [submitted, setSubmitted] = useState(false);
  const [aiCategorization, setAiCategorization] = useState<AiCategorization | null>(null);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiMatch, setAiMatch] = useState<AiMatch | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const steps = [
    t('ticket_create.step_module'),
    t('ticket_create.step_details'),
    t('ticket_create.step_urgency'),
    t('ticket_create.step_review'),
  ];

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const runAiCategorize = useCallback(async () => {
    if (form.description.length < 15) return;
    setAiLoading('categorize');
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: { action: 'categorize', title: form.title, description: form.description, sap_module: form.sap_module },
      });
      if (error) throw error;
      if (data?.result) setAiCategorization(data.result);
    } catch (err) {
      console.error('AI categorization failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [form.title, form.description, form.sap_module]);

  const runAiSummary = useCallback(async () => {
    setAiLoading('summary');
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: { action: 'summarize', title: form.title, description: form.description, sap_module: form.sap_module, urgency: form.urgency },
      });
      if (error) throw error;
      if (data?.result) setAiSummary(data.result);
    } catch (err) {
      console.error('AI summary failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [form.title, form.description, form.sap_module, form.urgency]);

  const runAiMatch = useCallback(async () => {
    setAiLoading('match');
    try {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: { action: 'match', title: form.title, description: form.description, sap_module: form.sap_module, urgency: form.urgency },
      });
      if (error) throw error;
      if (data?.result) setAiMatch(data.result);
    } catch (err) {
      console.error('AI matching failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [form.title, form.description, form.sap_module, form.urgency]);

  const handleNext = () => {
    if (step === 1 && !aiCategorization && form.description.length > 15) {
      runAiCategorize();
    }
    if (step === 2) {
      // Run summary + match when entering review
      runAiSummary();
      runAiMatch();
    }
    if (step < steps.length - 1) setStep(step + 1);
  };

  const handleSubmit = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error(t('onboarding.error_auth')); return; }

      const { error } = await supabase.from('tickets').insert({
        client_id: user.id,
        sap_module: form.sap_module,
        title: form.title,
        description: form.description,
        urgency: form.urgency as any,
        preferred_session_type: form.preferred_session as any,
        preferred_language: form.preferred_language,
        ai_suggested_category: aiCategorization?.category || null,
        ai_suggested_priority: aiCategorization?.suggested_priority || null,
      });

      if (error) throw error;
      setSubmitted(true);
      toast.success(t('ticket_create.submit_success'));
    } catch (err) {
      console.error(err);
      toast.error(t('onboarding.error_generic'));
    }
  };

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <Check className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2">{t('ticket_create.submitted_title')}</h2>
        <p className="text-muted-foreground mb-6">{t('ticket_create.submitted_desc')}</p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => { setSubmitted(false); setStep(0); setForm({ sap_module: '', issue_type: '', title: '', description: '', urgency: 'medium', preferred_session: 'video', preferred_language: 'en' }); setAiCategorization(null); setAiSummary(null); setAiMatch(null); }} variant="outline">
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

      {/* Step 1: SAP Module */}
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

            {/* AI Analyze button */}
            {form.description.length > 15 && !aiCategorization && (
              <Button variant="outline" size="sm" onClick={runAiCategorize} disabled={aiLoading === 'categorize'} className="gap-1.5">
                {aiLoading === 'categorize' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                {t('ticket_create.ai_analyze')}
              </Button>
            )}

            {/* AI Categorization Result */}
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

          {/* AI Consultant Match */}
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
