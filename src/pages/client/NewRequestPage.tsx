import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { sapModules, issueTypes } from '@/data/clientMockData';
import {
  ArrowLeft, ArrowRight, Check, Upload, Sparkles, Brain,
  Clock, AlertTriangle, Info,
} from 'lucide-react';

const urgencyLevels = [
  { value: 'low', label: 'Low', desc: 'Can wait a few days', color: 'border-muted hover:border-muted-foreground' },
  { value: 'medium', label: 'Medium', desc: 'Should be addressed soon', color: 'border-yellow-300 hover:border-yellow-500' },
  { value: 'high', label: 'High', desc: 'Business impact, needs quick attention', color: 'border-orange-300 hover:border-orange-500' },
  { value: 'critical', label: 'Critical', desc: 'System down or blocked', color: 'border-red-300 hover:border-red-500' },
];

const sessionTypes = [
  { value: 'chat', label: 'Chat', desc: 'Text-based async support' },
  { value: 'video', label: 'Video Call', desc: 'Live video consultation' },
  { value: 'screen_share', label: 'Screen Share', desc: 'Remote screen sharing session' },
];

const steps = ['SAP Module', 'Issue Details', 'Urgency & Preferences', 'Review & Submit'];

export default function NewRequestPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    sap_module: '',
    issue_type: '',
    title: '',
    description: '',
    urgency: 'medium',
    preferred_session: 'video',
    preferred_language: 'en',
    attachments: [] as string[],
  });
  const [submitted, setSubmitted] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ category: string; priority: string; tip: string } | null>(null);

  const updateForm = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleNext = () => {
    if (step === 1 && !aiSuggestion && form.description.length > 20) {
      setAiSuggestion({
        category: form.sap_module || 'SAP S/4HANA',
        priority: form.urgency === 'critical' ? 'Critical' : 'High',
        tip: 'Based on your description, this appears to be a configuration issue. Check transaction code SPRO for relevant settings before the session.',
      });
    }
    if (step < steps.length - 1) setStep(step + 1);
  };

  const handleSubmit = () => setSubmitted(true);

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <Check className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Support Request Submitted!</h2>
        <p className="text-muted-foreground mb-6">
          Your request has been submitted successfully. Our AI engine is now matching you with the best consultant.
          You'll receive a notification once a consultant is matched.
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => { setSubmitted(false); setStep(0); setForm({ sap_module: '', issue_type: '', title: '', description: '', urgency: 'medium', preferred_session: 'video', preferred_language: 'en', attachments: [] }); setAiSuggestion(null); }} variant="outline">
            Submit Another
          </Button>
          <Button className="gradient-primary border-0" asChild>
            <a href="/client">Back to Dashboard</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">New Support Request</h1>
        <p className="text-sm text-muted-foreground mt-1">Describe your SAP issue and we'll match you with the best expert.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
              i <= step ? 'gradient-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {i < step ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${i <= step ? 'text-foreground' : 'text-muted-foreground'}`}>
              {s}
            </span>
            {i < steps.length - 1 && <div className={`h-0.5 flex-1 ${i < step ? 'bg-accent' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: SAP Module */}
      {step === 0 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Select SAP Module</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {sapModules.map((mod) => (
                <button
                  key={mod}
                  onClick={() => updateForm('sap_module', mod)}
                  className={`p-3 rounded-xl border text-sm text-start transition-all ${
                    form.sap_module === mod
                      ? 'border-accent bg-accent/10 text-foreground font-medium'
                      : 'border-border/50 text-muted-foreground hover:border-accent/30'
                  }`}
                >
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
          <CardHeader>
            <CardTitle className="text-base">Issue Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Issue Type</label>
              <div className="grid grid-cols-2 gap-2">
                {issueTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => updateForm('issue_type', type)}
                    className={`p-2.5 rounded-xl border text-sm text-start transition-all ${
                      form.issue_type === type
                        ? 'border-accent bg-accent/10 text-foreground font-medium'
                        : 'border-border/50 text-muted-foreground hover:border-accent/30'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Title</label>
              <Input
                value={form.title}
                onChange={(e) => updateForm('title', e.target.value)}
                placeholder="Brief summary of your issue"
                className="rounded-xl"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Description</label>
              <Textarea
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                placeholder="Describe your SAP issue in detail. Include error messages, transaction codes, and steps to reproduce..."
                rows={5}
                className="rounded-xl"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Attachments</label>
              <div className="border-2 border-dashed border-border/50 rounded-xl p-8 text-center hover:border-accent/30 transition-colors cursor-pointer">
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Drop files here or click to upload</p>
                <p className="text-xs text-muted-foreground mt-1">Screenshots, logs, documents (max 10MB each)</p>
              </div>
            </div>

            {/* AI Suggestion */}
            {aiSuggestion && (
              <div className="p-4 rounded-xl bg-accent/5 border border-accent/20">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-accent">AI Triage Assistant</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent">Suggested Category</Badge>
                    <span className="text-foreground">{aiSuggestion.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] bg-orange-100 text-orange-700">Suggested Priority</Badge>
                    <span className="text-foreground">{aiSuggestion.priority}</span>
                  </div>
                  <div className="flex items-start gap-2 mt-2">
                    <Info className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <p className="text-muted-foreground text-xs">{aiSuggestion.tip}</p>
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
          <CardHeader>
            <CardTitle className="text-base">Urgency & Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium text-foreground mb-3 block">Urgency Level</label>
              <div className="grid grid-cols-2 gap-3">
                {urgencyLevels.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => updateForm('urgency', level.value)}
                    className={`p-4 rounded-xl border-2 text-start transition-all ${
                      form.urgency === level.value
                        ? 'border-accent bg-accent/5'
                        : level.color
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {level.value === 'critical' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                      <span className="text-sm font-semibold text-foreground">{level.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{level.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-3 block">Preferred Session Type</label>
              <div className="grid grid-cols-3 gap-3">
                {sessionTypes.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => updateForm('preferred_session', type.value)}
                    className={`p-4 rounded-xl border text-center transition-all ${
                      form.preferred_session === type.value
                        ? 'border-accent bg-accent/10'
                        : 'border-border/50 hover:border-accent/30'
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">{type.label}</span>
                    <p className="text-xs text-muted-foreground mt-1">{type.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-3 block">Preferred Language</label>
              <div className="flex gap-3">
                {[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }].map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => updateForm('preferred_language', lang.value)}
                    className={`px-6 py-3 rounded-xl border transition-all ${
                      form.preferred_language === lang.value
                        ? 'border-accent bg-accent/10 font-medium text-foreground'
                        : 'border-border/50 text-muted-foreground hover:border-accent/30'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Review */}
      {step === 3 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              Review Your Request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">SAP Module</p>
                <p className="text-sm font-medium text-foreground">{form.sap_module || '—'}</p>
              </div>
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Issue Type</p>
                <p className="text-sm font-medium text-foreground">{form.issue_type || '—'}</p>
              </div>
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Urgency</p>
                <Badge variant="secondary" className={`text-xs ${urgencyLevels.find((u) => u.value === form.urgency)?.value === 'critical' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {form.urgency}
                </Badge>
              </div>
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Preferred Session</p>
                <p className="text-sm font-medium text-foreground capitalize">{form.preferred_session.replace('_', ' ')}</p>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Title</p>
              <p className="text-sm font-medium text-foreground">{form.title || '—'}</p>
            </div>
            <div className="p-4 rounded-xl bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{form.description || '—'}</p>
            </div>

            {/* AI Matching Preview */}
            <div className="p-4 rounded-xl bg-accent/5 border border-accent/20">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-accent">AI will match you with the best consultant</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Avg match time: 5 min</span>
                <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> 98% match accuracy</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(step - 1)}
          disabled={step === 0}
        >
          <ArrowLeft className="w-4 h-4 me-1" /> Back
        </Button>
        {step < steps.length - 1 ? (
          <Button onClick={handleNext} className="gradient-primary border-0">
            Next <ArrowRight className="w-4 h-4 ms-1" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} className="gradient-primary border-0">
            <Check className="w-4 h-4 me-1" /> Submit Request
          </Button>
        )}
      </div>
    </div>
  );
}
