import MatchScoreBreakdown, { type MatchCriterion } from '@/components/client/MatchScoreBreakdown';
import FavouriteButton, { FavouriteChip } from '@/components/favourites/FavouriteButton';
import ConsultantRing, { ConsultantRingPills } from '@/components/consultant/ConsultantRing';
import GroupInvitePanel from '@/components/favourites/GroupInvitePanel';
import { useClientFavourites } from '@/hooks/useClientFavourites';
import MatchWhyChips from '@/components/match/MatchWhyChips';
import MatchClarifyingQuestions from '@/components/match/MatchClarifyingQuestions';
import type { Chip, ClarifyKey } from '../../../supabase/functions/_shared/ticketMatch';
import TaskProgressPanel, { TaskDoneNote } from '@/components/progress/TaskProgressPanel';
import { makeSteps, setStep as withStep, type ProgressStep, type StepDef, type StepState } from '@/lib/progressSteps';
import { MATCH_STEP_LABELS, matchSteps, understoodSummary, type MatchPhase } from '@/lib/matchProgress';
import { clearPending, readPending, requestFingerprint, requestStorage, saveTicketOnce } from '@/lib/ticketSubmission';
import { TimeoutError } from '@/lib/withTimeout';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { issueTypes } from '@/data/clientMockData';
import SapAreaPicker from '@/components/ticket/SapAreaPicker';
import SolutionSuggestions from '@/components/ticket/SolutionSuggestions';
import SapNotesField from '@/components/ticket/SapNotesField';
import { MAX_SAP_AREAS, MAX_OTHER_AREA_LENGTH, MAX_AREA_DETAILS_LENGTH, OTHER_AREA, areasSummary, areaLabel, isOtherArea, resolveArea } from '@/lib/sapAreas';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { checkAttachments, ATTACHMENT_HINT } from '@/lib/attachments';
import { safeFileName } from '@/lib/storagePath';
import { invokeWithTimeout } from '@/lib/invokeWithTimeout';
import { isNetworkError } from '@/lib/friendlyError';
import { z } from 'zod';
import {
  ArrowLeft, ArrowRight, Check, Sparkles, Brain,
  Clock, AlertTriangle, Info, Loader2, Zap, Target, List,
  Star, BadgeCheck, Circle, Users, Crown, ChevronRight, Search, UserPlus,
  Upload, X, FileText, Paperclip, Link2, Mic, Heart,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeConsultants, type ConsultantLive } from '@/hooks/useRealtimeConsultants';
import AIModelSelector, { DEFAULT_MODEL, type AIModelId } from '@/components/ai/AIModelSelector';
import { TrustBadge } from '@/components/consultant/TrustBadge';
import VoiceInput from '@/components/ui/voice-input';
import CriticalRequestOption from '@/components/ticket/CriticalRequestOption';
import { useCriticalTerms, notifyCriticalByEmail } from '@/hooks/useCriticalService';
import RequestContextSection, { industryLabelFor } from '@/components/ticket/RequestContextSection';
import ContextFitBadges from '@/components/client/ContextFitBadges';
import { buildTicketContext, withTicketContext, type TicketContextInput } from '@/lib/ticketContext';
import { useClientProfileData } from '@/hooks/useClientProfile';
import { NO_CRITICAL_CHOICE, choiceSummary, criticalColumns, type CriticalChoice } from '@/lib/criticalService';

const ticketSchema = z.object({
  sap_module: z.string().min(1, 'Please select an SAP module'),
  sap_modules: z.array(z.string().min(1)).min(1, 'Please choose at least one SAP module or area').max(MAX_SAP_AREAS, `Choose ${MAX_SAP_AREAS} SAP areas at most`),
  sap_module_other: z.string().max(MAX_OTHER_AREA_LENGTH, 'The name of the other area is too long'),
  area_details: z.string().max(MAX_AREA_DETAILS_LENGTH, 'The details about the areas are too long'),
  issue_type: z.string().min(1, 'Please select an issue type'),
  title: z.string().min(5, 'Title must be at least 5 characters').max(200, 'Title too long'),
  description: z.string().min(20, 'Please describe your issue in at least 20 characters').max(5000, 'Description too long'),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  preferred_session: z.enum(['chat', 'video', 'screen_share']),
  preferred_language: z.enum(['en', 'ar']),
}).superRefine((val, ctx) => {
  if (val.sap_modules.some(isOtherArea) && val.sap_module_other.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sap_module_other'], message: 'Please name the other SAP area' });
  }
});

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
  score_breakdown?: MatchCriterion[];
  why?: Chip[];
  coverage?: number;
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
  credibility_credits?: number;
  ai_interview_badge?: string | null;
  solved_similar?: number;
  resolved_in_areas?: number;
  context_fit_score?: number | null;
  context_matches?: string[];
  context_gaps?: string[];
}

// an expert the client asks to take the ticket (suggested by the AI or chosen by hand)
interface PickedExpert {
  id: string;
  name: string;
  subtitle: string;
  source: 'ai' | 'manual';
}

const MAX_INVITED_EXPERTS = 3;

interface AiMatchConsultants {
  recommendations: ConsultantRecommendation[];
  overall_rationale: string;
}

const expertsFound = (n: number) => (n === 1 ? '1 expert found' : `${n} experts found`);

/** A short, honest sentence for a failed match call (shown in the progress panel, not only in a toast). */
function matchErrorText(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (err instanceof TimeoutError) return 'Finding experts took too long and was stopped.';
  if (/credits exhausted/i.test(msg)) return 'AI credits are used up. Please ask your administrator to add credits.';
  if (/rate limited/i.test(msg)) return 'The matching service is busy. Please try again in a moment.';
  if (isNetworkError(err)) return 'The connection was lost while we were finding experts.';
  return 'We could not load expert recommendations.';
}

/** A short sentence for a failed save; the form is kept and Retry never creates a second ticket. */
function saveErrorText(err: unknown, generic: string): string {
  const e = err as { code?: string; message?: string; friendly?: boolean } | null;
  if (e?.friendly && e.message) return e.message;
  if (e?.code === '53400') return String(e.message);
  if (e?.code === '23514') return 'Please check the title (up to 300 characters) and the description (up to 50,000 characters).';
  if (isNetworkError(err)) return 'We could not confirm that your request was saved. Press Retry: it will not create a second ticket.';
  return generic;
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
    sap_module: '', sap_modules: [] as string[], sap_module_other: '', area_details: '', sap_notes_tried: [] as string[],
    issue_type: '', title: '', description: '',
    urgency: 'medium', preferred_session: 'video', preferred_language: 'en',
    ticket_type: 'standard',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  // the text the AI triage was run for: when the title, the description or the areas change afterwards, the result is out of date
  const [triageKey, setTriageKey] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedModel, setSelectedModel] = useState<AIModelId>(DEFAULT_MODEL);
  const [manualPickOpen, setManualPickOpen] = useState(false);
  const [groupPickOpen, setGroupPickOpen] = useState(false);
  const fav = useClientFavourites();
  const [manualSearch, setManualSearch] = useState('');
  // the experts the client asks (up to 3): they get a match request when the ticket is created
  const [picked, setPicked] = useState<PickedExpert[]>([]);
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);
  // One id per request, kept in this tab until the request is done: a retry, or a retry after a page refresh,
  // sends the same id, the database answers "already there" and no second ticket is created.
  const storage = useMemo(() => requestStorage(), []);
  // set once the ticket is saved: Retry then only repeats the steps after the save
  const savedTicketRef = useRef<string | null>(null);
  const [submitSteps, setSubmitSteps] = useState<ProgressStep[] | null>(null);
  const [submitStartedAt, setSubmitStartedAt] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // "Show my request now": the confirmation opens and the expert ranking finishes behind it
  const continueInBackground = useRef(false);
  const [bgMatching, setBgMatching] = useState(false);
  const [bgMatchError, setBgMatchError] = useState<string | null>(null);
  // a request that was saved just before the page was reloaded
  const [restoredTicket, setRestoredTicket] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    const pending = readPending(storage);
    if (!pending) return;
    let cancelled = false;
    void supabase.from('tickets').select('id, title').eq('id', pending.id).maybeSingle().then(({ data }) => {
      if (cancelled || !data) return;
      setRestoredTicket({ id: data.id, title: data.title });
      clearPending(storage);
    });
    return () => { cancelled = true; };
  }, [storage]);
  // Optional matching context; prefilled once from the company profile
  const { data: companyProfile } = useClientProfileData();
  const [contextInput, setContextInput] = useState<TicketContextInput>({});
  const contextPrefilled = useRef(false);
  useEffect(() => {
    if (!companyProfile || contextPrefilled.current) return;
    contextPrefilled.current = true;
    setContextInput(prev => ({
      ...prev,
      industry: prev.industry || industryLabelFor(companyProfile.industry),
      customer_segment: prev.customer_segment || companyProfile.customer_segment || '',
      country: prev.country || companyProfile.country || '',
    }));
  }, [companyProfile]);
  const ticketContext = useMemo(() => buildTicketContext(contextInput), [contextInput]);
  // What did not get through on the last try: shown on the confirmation page, not only in a toast.
  const [sendIssues, setSendIssues] = useState<{ files: string[]; links: number; expertIds: string[] }>({ files: [], links: 0, expertIds: [] });
  const [solvedBySuggestion, setSolvedBySuggestion] = useState(false);
  // the optional critical reply service (only offered under the urgency Critical)
  const [critical, setCritical] = useState<CriticalChoice>(NO_CRITICAL_CHOICE);
  const criticalTerms = useCriticalTerms().data;
  const togglePick = (expert: PickedExpert) => {
    setPicked(prev => {
      if (prev.some(p => p.id === expert.id)) return prev.filter(p => p.id !== expert.id);
      if (prev.length >= MAX_INVITED_EXPERTS) {
        toast.info(`You can ask ${MAX_INVITED_EXPERTS} experts at most. Remove one first.`);
        return prev;
      }
      return [...prev, expert];
    });
  };
  const [linkedTickets, setLinkedTickets] = useState<{ id: string; title: string; linkType: string }[]>([]);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkType, setLinkType] = useState('related');

  const { data: linkSearchResults = [] } = useQuery({
    queryKey: ['ticket-link-search', linkSearch],
    enabled: linkSearch.length >= 2,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('tickets')
        .select('id, title, status, sap_module')
        .eq('client_id', user.id)
        .ilike('title', `%${linkSearch}%`)
        .limit(5);
      return (data || []).filter(t => !linkedTickets.some(l => l.id === t.id));
    },
  });
  const { consultants: allConsultants, isLoading: consultantsLoading } = useRealtimeConsultants();

  // "Invite" from the consultant directory or its map: that consultant is pre-selected as an expert to ask.
  const inviteId = useRef(searchParams.get('invite'));
  useEffect(() => {
    const id = inviteId.current;
    if (!id || consultantsLoading) return;
    inviteId.current = null;
    const c = allConsultants.find(x => x.id === id);
    if (c) setPicked(prev => (prev.some(p => p.id === c.id) || prev.length >= MAX_INVITED_EXPERTS ? prev : [...prev, { id: c.id, name: c.name, subtitle: `${c.specialty} · $${c.rate}/hr`, source: 'manual' }]));
  }, [allConsultants, consultantsLoading]);

  // Auto-fill from chatbot query params
  useEffect(() => {
    const module = searchParams.get('module');
    const title = searchParams.get('title');
    const description = searchParams.get('description');
    const urgency = searchParams.get('urgency');
    if (module || title || description || urgency) {
      // the AI chat names a module in its own way: use the area of the master list, or "Other" with the text
      const area = module ? resolveArea(module) : null;
      setForm(prev => ({
        ...prev,
        ...(module && area && { sap_module: area, sap_modules: [area] }),
        ...(module && !area && {
          sap_module: areasSummary([OTHER_AREA], module.slice(0, MAX_OTHER_AREA_LENGTH)),
          sap_modules: [OTHER_AREA],
          sap_module_other: module.slice(0, MAX_OTHER_AREA_LENGTH),
        }),
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
  // Set after the client answers the clarifying questions; matching runs again with the improved description.
  const [matchRerunPending, setMatchRerunPending] = useState(false);
  const [skipQuestions, setSkipQuestions] = useState(false);

  const steps = [
    t('ticket_create.step_module'),
    t('ticket_create.step_details'),
    t('ticket_create.step_urgency'),
    t('ticket_create.step_review'),
  ];

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value } as typeof prev));
  const currentTriageKey = JSON.stringify([form.title.trim(), form.description.trim(), form.sap_module]);
  const triageIsStale = !!aiCategorization && triageKey !== currentTriageKey;

  // sap_module keeps ONE short line (at most 100 characters) for the AI calls and the review; the full list is sap_modules
  const setAreas = (areas: string[]) => {
    setForm(prev => ({ ...prev, sap_modules: areas, sap_module: areasSummary(areas, prev.sap_module_other) }));
    setFieldErrors(prev => ({ ...prev, sap_modules: '' }));
  };
  const setOtherArea = (text: string) => {
    setForm(prev => ({ ...prev, sap_module_other: text, sap_module: areasSummary(prev.sap_modules, text) }));
    setFieldErrors(prev => ({ ...prev, sap_module_other: '' }));
  };

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
      const { data, error } = await invokeWithTimeout('ai-ticket', {
        body: { action: 'categorize', title: form.title, description: form.description, sap_module: form.sap_module, model: selectedModel },
      });
      if (error) throw error;
      if (handleAiError(data)) return;
      if (data?.result) {
        setAiCategorization(data.result);
        setTriageKey(JSON.stringify([form.title.trim(), form.description.trim(), form.sap_module]));
      }
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
      const { data, error } = await invokeWithTimeout('ai-ticket', {
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
      const { data, error } = await invokeWithTimeout('ai-ticket', {
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

  // The request as the matcher reads it; also used for the instant "We understood: ..." line.
  const matchTicket = useMemo(() => ({
    title: form.title,
    description: form.description,
    area_details: form.area_details,
    sap_modules: form.sap_modules,
    sap_module: form.sap_module,
    sap_module_other: form.sap_module_other || null,
    sap_notes_tried: form.sap_notes_tried,
    urgency: form.urgency,
    preferred_language: form.preferred_language,
    ...(ticketContext ?? {}),
  }), [form.title, form.description, form.area_details, form.sap_modules, form.sap_module, form.sap_module_other, form.sap_notes_tried, form.urgency, form.preferred_language, ticketContext]);
  const matchKey = JSON.stringify([matchTicket, selectedModel]);
  // One match call per request content: a running or finished call is reused (the review step and the submit share it).
  const matchPromise = useRef<{ key: string; promise: Promise<AiMatchConsultants> } | null>(null);
  const [recsKey, setRecsKey] = useState('');
  const [matchRun, setMatchRun] = useState<{ phase: MatchPhase | 'cancelled'; startedAt: number; understood: string; error?: string; found?: number } | null>(null);
  const matchToken = useRef(0);

  const fetchMatches = useCallback((ticketId?: string): Promise<AiMatchConsultants> => {
    if (matchPromise.current?.key === matchKey) return matchPromise.current.promise;
    const promise = (async () => {
      const { data, error } = await invokeWithTimeout('ai-ticket', {
        body: withTicketContext({
          action: 'match_consultants',
          ...(ticketId && { ticket_id: ticketId }),
          title: form.title,
          description: form.description,
          sap_module: form.sap_module,
          sap_modules: form.sap_modules,
          sap_module_other: form.sap_module_other || undefined,
          area_details: form.area_details,
          urgency: form.urgency,
          preferred_language: form.preferred_language,
          sap_notes_tried: form.sap_notes_tried.length ? form.sap_notes_tried : undefined,
          model: selectedModel,
          // Feature O: favourites and "do not suggest" of this company (or of the client without one).
          ...(tenant?.id && { tenant_id: tenant.id }),
        }, ticketContext),
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return (data?.result as AiMatchConsultants | undefined) ?? { recommendations: [], overall_rationale: '' };
    })();
    matchPromise.current = { key: matchKey, promise };
    promise.catch(() => { if (matchPromise.current?.promise === promise) matchPromise.current = null; });
    return promise;
  }, [matchKey, form.title, form.description, form.sap_module, form.sap_modules, form.sap_module_other, form.area_details, form.urgency, form.preferred_language, form.sap_notes_tried, selectedModel, ticketContext, tenant?.id]);

  const runAiMatchConsultants = useCallback(async () => {
    const token = ++matchToken.current;
    const key = matchKey;
    setMatchRun({ phase: 'ranking', startedAt: Date.now(), understood: understoodSummary(matchTicket) });
    try {
      const result = await fetchMatches();
      if (token !== matchToken.current) return; // cancelled, or a newer run started
      setAiRecommendations(result);
      setRecsKey(key);
      setMatchRun(prev => prev && { ...prev, phase: 'done', found: result.recommendations.length });
    } catch (err) {
      if (token !== matchToken.current) return;
      console.error('AI consultant matching failed:', err);
      setMatchRun(prev => prev && { ...prev, phase: 'error', error: matchErrorText(err) });
    }
  }, [matchKey, matchTicket, fetchMatches]);

  // Cancel only stops waiting: nothing is saved or sent by a match run.
  const cancelMatch = () => {
    matchToken.current++;
    setMatchRun(prev => prev && { ...prev, phase: 'cancelled' });
  };

  useEffect(() => {
    if (!matchRerunPending) return;
    setMatchRerunPending(false);
    runAiMatchConsultants();
  }, [matchRerunPending, runAiMatchConsultants]);

  const validateStep = (currentStep: number): boolean => {
    const result = ticketSchema.safeParse(form);
    const errors: Record<string, string> = {};

    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        errors[field] = issue.message;
      }
    }

    // Step-specific validation
    if (currentStep === 0) {
      const stepErrors: Record<string, string> = {};
      if (errors.sap_modules) stepErrors.sap_modules = errors.sap_modules;
      if (errors.sap_module_other) stepErrors.sap_module_other = errors.sap_module_other;
      if (errors.area_details) stepErrors.area_details = errors.area_details;
      if (Object.keys(stepErrors).length > 0) {
        setFieldErrors(stepErrors);
        toast.error(Object.values(stepErrors)[0]);
        return false;
      }
    }
    if (currentStep === 1) {
      const stepErrors: Record<string, string> = {};
      if (errors.title) stepErrors.title = errors.title;
      if (errors.description) stepErrors.description = errors.description;
      if (Object.keys(stepErrors).length > 0) {
        setFieldErrors(stepErrors);
        toast.error(Object.values(stepErrors)[0]);
        return false;
      }
    }

    if (currentStep === 2 && form.urgency === 'critical' && critical.on && !critical.agreed) {
      toast.error('Please confirm the terms of the critical request, or switch it off');
      return false;
    }

    setFieldErrors({});
    return true;
  };

  const handleNext = () => {
    if (!validateStep(step)) return;

    if (step === 1 && form.description.length > 15 && (!aiCategorization || triageIsStale)) {
      setAiCategorization(null);
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
    // a second click while the first request is still running must not create a second ticket
    if (submitLock.current) return;
    if (!savedTicketRef.current) {
      const result = ticketSchema.safeParse(form);
      if (!result.success) {
        toast.error(result.error.issues[0]?.message || 'Please fix form errors');
        return;
      }
      if (form.urgency === 'critical' && critical.on && !critical.agreed) {
        toast.error('Please confirm the terms of the critical request, or switch it off');
        return;
      }
    }
    submitLock.current = true;
    setSubmitting(true);
    try {
      await submitRequest();
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const markSubmit = (key: string, state: StepState, detail?: string) =>
    setSubmitSteps(prev => (prev ? withStep(prev, key, state, detail) : prev));

  const finishSubmit = () => {
    savedTicketRef.current = null;
    toast.success(t('ticket_create.submit_success'));
    // the finished steps stay on screen for a moment, then the confirmation with the experts opens
    window.setTimeout(() => { setSubmitted(true); setSubmitSteps(null); }, 900);
  };

  const showRequestNow = () => {
    continueInBackground.current = true;
    savedTicketRef.current = null;
    setSubmitted(true);
    setSubmitSteps(null);
    toast.success(t('ticket_create.submit_success'));
  };

  // Steps after the save: read the request, then rank the experts (reusing the ranking of the review step when nothing changed).
  const runSubmitMatching = async (ticketId: string) => {
    setSubmitError(null);
    markSubmit('understand', 'done', understoodSummary(matchTicket));
    if (aiRecommendations && recsKey === matchKey) {
      markSubmit('rank', 'done', `Ready from your review: ${expertsFound(aiRecommendations.recommendations.length)}`);
      finishSubmit();
      return;
    }
    markSubmit('rank', 'active');
    setBgMatching(true);
    setBgMatchError(null);
    const key = matchKey;
    try {
      const result = await fetchMatches(ticketId);
      setAiRecommendations(result);
      setRecsKey(key);
      markSubmit('rank', 'done', expertsFound(result.recommendations.length));
      if (!continueInBackground.current) finishSubmit();
    } catch (err) {
      console.error('AI consultant matching failed:', err);
      if (continueInBackground.current) {
        setBgMatchError(matchErrorText(err));
      } else {
        markSubmit('rank', 'error');
        setSubmitError(`Your request is saved. ${matchErrorText(err)}`);
      }
    } finally {
      setBgMatching(false);
    }
  };

  const retryBgMatch = async () => {
    if (!createdTicketId) return;
    setBgMatching(true);
    setBgMatchError(null);
    const key = matchKey;
    try {
      const result = await fetchMatches(createdTicketId);
      setAiRecommendations(result);
      setRecsKey(key);
    } catch (err) {
      setBgMatchError(matchErrorText(err));
    } finally {
      setBgMatching(false);
    }
  };

  const submitRequest = async () => {
    // the ticket is already saved and a later step failed: repeat only what comes after the save
    if (savedTicketRef.current) {
      await runSubmitMatching(savedTicketRef.current);
      return;
    }
    const defs: StepDef[] = [{ key: 'save', label: 'Saving your request' }];
    if (attachedFiles.length > 0) defs.push({ key: 'files', label: 'Attaching your files', detail: `0 of ${attachedFiles.length}` });
    if (picked.length > 0 || linkedTickets.length > 0) {
      defs.push({ key: 'send', label: picked.length > 0 ? 'Sending your requests to the experts you chose' : 'Linking related tickets' });
    }
    defs.push({ key: 'understand', label: MATCH_STEP_LABELS.understand }, { key: 'rank', label: MATCH_STEP_LABELS.rank, open: true });
    setSubmitSteps(withStep(makeSteps(defs), 'save', 'active'));
    setSubmitError(null);
    setSubmitStartedAt(Date.now());
    continueInBackground.current = false;

    let ticketId: string;
    let userId: string;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw Object.assign(new Error(t('onboarding.error_auth')), { friendly: true });
      userId = user.id;
      const fingerprint = requestFingerprint([form.title.trim(), form.description.trim(), form.sap_modules, form.urgency, form.ticket_type, criticalColumns(form.urgency, critical)]);
      const saved = await saveTicketOnce({
        storage,
        fingerprint,
        insert: (id) => supabase.from('tickets').insert(withTicketContext({
          id,
          client_id: user.id,
          tenant_id: tenant?.id || null,
          sap_module: form.sap_modules[0] || form.sap_module,
          sap_modules: form.sap_modules,
          sap_module_other: form.sap_modules.some(isOtherArea) ? form.sap_module_other.trim() : null,
          area_details: form.area_details.trim() || null,
          sap_notes_tried: form.sap_notes_tried,
          title: form.title,
          description: form.description,
          urgency: form.urgency as any,
          preferred_session_type: form.preferred_session as any,
          preferred_language: form.preferred_language,
          ai_suggested_category: (!triageIsStale && aiCategorization?.category) || null,
          ai_suggested_priority: (!triageIsStale && aiCategorization?.suggested_priority) || null,
          ticket_type: form.ticket_type,
          ...criticalColumns(form.urgency, critical),
        }, ticketContext) as any),
      });
      ticketId = saved.id;
    } catch (err) {
      console.error(err);
      markSubmit('save', 'error');
      setSubmitError(saveErrorText(err, t('onboarding.error_generic')));
      return;
    }
    savedTicketRef.current = ticketId;
    setCreatedTicketId(ticketId);
    markSubmit('save', 'done');
    // the consultants who were alerted by the database also get an e-mail (best effort, in the background)
    if (form.urgency === 'critical' && critical.on) void notifyCriticalByEmail(ticketId);

    // Upload attached files
    const failedFiles: string[] = [];
    if (attachedFiles.length > 0) {
      const total = attachedFiles.length;
      markSubmit('files', 'active', `0 of ${total}`);
      for (const [i, file] of attachedFiles.entries()) {
        const storagePath = `${ticketId}/${userId}/${Date.now()}_${safeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from('ticket-documents').upload(storagePath, file);
        if (uploadError) {
          failedFiles.push(file.name);
        } else {
          await supabase.from('ticket_documents').insert({
            ticket_id: ticketId,
            uploaded_by: userId,
            file_name: file.name,
            file_url: storagePath,
            file_size: file.size,
            mime_type: file.type || null,
            version: 1,
          } as any);
        }
        markSubmit('files', 'active', `${i + 1} of ${total}`);
      }
      markSubmit('files', 'done', failedFiles.length ? `${total - failedFiles.length} of ${total} attached` : `${total} of ${total} attached`);
    }

    // Create ticket links, then ask the experts the client picked (the existing match-request flow)
    let failedLinks = 0;
    const notSentExpertIds: string[] = [];
    if (picked.length > 0 || linkedTickets.length > 0) {
      markSubmit('send', 'active');
      for (const link of linkedTickets) {
        const { error: linkError } = await supabase.from('ticket_links').insert({
          source_ticket_id: ticketId,
          target_ticket_id: link.id,
          link_type: link.linkType,
          created_by: userId,
        } as any);
        if (linkError && linkError.code !== '23505') failedLinks++;
      }
      for (const expert of picked) {
        const { error: askError } = await supabase.from('ticket_match_requests').insert({
          ticket_id: ticketId,
          consultant_id: expert.id,
          sent_by: userId,
        } as any);
        if (askError && askError.code !== '23505') notSentExpertIds.push(expert.id);
      }
      const sentCount = picked.length - notSentExpertIds.length;
      markSubmit('send', 'done', picked.length > 0 ? `${sentCount} of ${picked.length} sent` : undefined);
    }
    // what did not get through is shown on the confirmation page
    setSendIssues({ files: failedFiles, links: failedLinks, expertIds: notSentExpertIds });
    clearPending(storage);
    await runSubmitMatching(ticketId);
  };

  const backToForm = () => {
    setSubmitSteps(null);
    setSubmitError(null);
  };

  const continueWithoutMatches = () => {
    savedTicketRef.current = null;
    setSubmitted(true);
    setSubmitSteps(null);
    setSubmitError(null);
  };

  // ====== THE SUGGESTIONS SOLVED IT: no ticket ======
  if (solvedBySuggestion) {
    return (
      <div className="max-w-xl mx-auto space-y-6 py-12 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <Check className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold">Great, we are glad it helped</h2>
        <p className="text-muted-foreground">No ticket was created. If the problem comes back you can open a request at any time. Your draft is still here.</p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => setSolvedBySuggestion(false)}>Back to my request</Button>
          <Button className="gradient-primary border-0" asChild>
            <a href="/client">{t('ticket_create.back_dashboard')}</a>
          </Button>
        </div>
      </div>
    );
  }

  // ====== SUCCESS PAGE WITH RECOMMENDATIONS ======
  if (submitted) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 py-8">
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-6 motion-safe:animate-scale-in">
            <Check className="w-10 h-10 text-success" />
          </div>
          <h2 className="text-2xl font-bold mb-2">{t('ticket_create.submitted_title')}</h2>
          <p className="text-muted-foreground mb-6">{t('ticket_create.submitted_desc')}</p>
          {form.urgency === 'critical' && critical.on && criticalTerms && (
            <div className="mb-6 space-y-2" data-testid="submitted-critical">
              <p className="text-sm font-medium text-red-700">{`Your critical request is on its way: ${choiceSummary(critical, criticalTerms)}.`}</p>
              {createdTicketId && (
                <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" asChild>
                  <a href={`/client/tickets/${createdTicketId}`}>Watch the countdown</a>
                </Button>
              )}
            </div>
          )}
        </div>

        {(sendIssues.files.length > 0 || sendIssues.links > 0 || sendIssues.expertIds.length > 0) && (
          <Card className="rounded-2xl border-amber-300/60 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20" role="alert" data-testid="send-issues">
            <CardContent className="space-y-2 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Your request was saved, but not everything went through
              </p>
              <ul className="list-disc space-y-1 ps-5 text-amber-900/90 dark:text-amber-200/90">
                {sendIssues.files.length > 0 && <li>These files could not be attached: {sendIssues.files.join(', ')}.</li>}
                {sendIssues.links > 0 && <li>{sendIssues.links === 1 ? '1 linked ticket' : `${sendIssues.links} linked tickets`} could not be linked.</li>}
                {sendIssues.expertIds.length > 0 && (
                  <li>The request could not be sent to: {picked.filter((p) => sendIssues.expertIds.includes(p.id)).map((p) => p.name).join(', ')}.</li>
                )}
              </ul>
              {createdTicketId && (
                <a className="inline-block text-xs font-medium text-primary underline" href={`/client/tickets/${createdTicketId}`}>
                  Open the ticket to add the missing files or send the requests again
                </a>
              )}
            </CardContent>
          </Card>
        )}

        {/* AI Recommended Consultants */}
        <Card className="rounded-2xl border-accent/20 bg-accent/5">
          <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Crown className="w-4 h-4 text-accent" />
                AI-Recommended Experts for Your Ticket
              </CardTitle>
              {aiRecommendations && <p className="text-xs text-muted-foreground mt-1">{aiRecommendations.overall_rationale}</p>}
            </div>
            {createdTicketId && (
              <Button variant="outline" size="sm" className="text-xs gap-1" asChild>
                <a href={`/client/tickets/${createdTicketId}`}><UserPlus className="w-3.5 h-3.5" /> Invite more experts</a>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {picked.map(expert => (
              <div key={expert.id} className="p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                  {expert.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{expert.name}</p>
                  <p className="text-xs text-muted-foreground">{expert.subtitle}</p>
                </div>
                {sendIssues.expertIds.includes(expert.id) ? (
                  <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">Not sent</Badge>
                ) : (
                  <Badge className="bg-accent text-accent-foreground text-[10px]">Request sent</Badge>
                )}
              </div>
            ))}
            {bgMatching ? (
              <div className="space-y-2" data-testid="bg-matching">
                <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" /> Still ranking the best experts for your request...
                </p>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-muted/40 motion-safe:animate-pulse" aria-hidden="true" />
                ))}
              </div>
            ) : bgMatchError ? (
              <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
                <p>{`Your request is saved. ${bgMatchError}`}</p>
                <Button size="sm" variant="outline" onClick={() => void retryBgMatch()}>Retry</Button>
              </div>
            ) : aiRecommendations && aiRecommendations.recommendations.length > 0 ? (
              <div className="space-y-3 motion-safe:animate-fade-in">
                <TaskDoneNote text={expertsFound(aiRecommendations.recommendations.length)} />
                {aiRecommendations.recommendations.slice(0, 5).map((rec, i) => (
                  <RecommendationCard key={rec.consultant_id} rec={rec} rank={i + 1} navigate={navigate} />
                ))}
              </div>
            ) : picked.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No AI recommendations. You can invite experts from your ticket page.</p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-center">
          <Button onClick={() => {
            setSubmitted(false); setStep(0);
            setForm({ sap_module: '', sap_modules: [], sap_module_other: '', area_details: '', sap_notes_tried: [], issue_type: '', title: '', description: '', urgency: 'medium', preferred_session: 'video', preferred_language: 'en', ticket_type: 'standard' });
            setAiCategorization(null); setAiSummary(null); setAiMatch(null); setAiRecommendations(null); setAttachedFiles([]); setLinkedTickets([]);
            setPicked([]); setCreatedTicketId(null); setSendIssues({ files: [], links: 0, expertIds: [] }); setCritical(NO_CRITICAL_CHOICE);
            clearPending(storage); savedTicketRef.current = null; continueInBackground.current = false;
            setMatchRun(null); setRecsKey(''); matchPromise.current = null; setBgMatchError(null);
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

      {restoredTicket && (
        <Card className="rounded-2xl border-success/30 bg-success/5" role="status" data-testid="restored-ticket">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <p className="min-w-0 flex-1">{`Your request "${restoredTicket.title}" was saved before the page reloaded. You do not need to send it again.`}</p>
            <Button size="sm" variant="outline" asChild>
              <a href={`/client/tickets/${restoredTicket.id}`}>Open it</a>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRestoredTicket(null)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

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

      <div className={submitSteps ? 'hidden' : 'space-y-6'}>
      {step === 0 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader><CardTitle className="text-base">{t('ticket_create.select_module')}</CardTitle></CardHeader>
          <CardContent>
            <SapAreaPicker
              areas={form.sap_modules}
              other={form.sap_module_other}
              details={form.area_details}
              onAreasChange={setAreas}
              onOtherChange={setOtherArea}
              onDetailsChange={text => { updateForm('area_details', text); setFieldErrors(prev => ({ ...prev, area_details: '' })); }}
              areasError={fieldErrors.sap_modules}
              otherError={fieldErrors.sap_module_other}
              detailsError={fieldErrors.area_details}
            />
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">{t('ticket_create.ticket_title')}</label>
                <VoiceInput size="sm" onTranscript={(t) => updateForm('title', t)} />
              </div>
              <Input value={form.title} onChange={e => { updateForm('title', e.target.value); setFieldErrors(prev => ({ ...prev, title: '' })); }} placeholder={t('ticket_create.title_placeholder')} className={`rounded-xl ${fieldErrors.title ? 'border-destructive' : ''}`} maxLength={200} />
              {fieldErrors.title && <p className="text-[11px] text-destructive mt-1">{fieldErrors.title}</p>}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">{t('ticket_create.description')}</label>
                <VoiceInput size="sm" onTranscript={(t) => updateForm('description', form.description + t)} />
              </div>
              <Textarea value={form.description} onChange={e => { updateForm('description', e.target.value); setFieldErrors(prev => ({ ...prev, description: '' })); }} placeholder={t('ticket_create.desc_placeholder')} rows={5} className={`rounded-xl ${fieldErrors.description ? 'border-destructive' : ''}`} maxLength={2000} />
              {fieldErrors.description && <p className="text-[11px] text-destructive mt-1">{fieldErrors.description}</p>}
            </div>

            <SapNotesField
              value={form.sap_notes_tried}
              onChange={notes => setForm(prev => ({ ...prev, sap_notes_tried: notes }))}
            />

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
                    const { accepted: valid, problems } = checkAttachments(files);
                    if (problems.length > 0) toast.error(problems.join(' '));
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
                  <span className="text-[11px] text-muted-foreground">Screenshots, logs and error reports: {ATTACHMENT_HINT}</span>
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

            {/* Link Existing Tickets */}
            <div>
              <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Link to Existing Tickets
              </label>
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select value={linkType} onValueChange={setLinkType}>
                    <SelectTrigger className="w-full sm:w-[140px] rounded-xl h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="related">Related to</SelectItem>
                      <SelectItem value="blocks">Blocks</SelectItem>
                      <SelectItem value="blocked_by">Blocked by</SelectItem>
                      <SelectItem value="duplicate">Duplicate of</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={linkSearch}
                      onChange={e => setLinkSearch(e.target.value)}
                      placeholder="Search tickets to link..."
                      className="ps-8 rounded-xl h-9 text-xs"
                    />
                  </div>
                </div>
                {linkSearchResults.length > 0 && linkSearch.length >= 2 && (
                  <div className="border border-border/50 rounded-xl overflow-hidden">
                    {linkSearchResults.map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setLinkedTickets(prev => [...prev, { id: t.id, title: t.title, linkType }]);
                          setLinkSearch('');
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/30 transition-colors border-b border-border/20 last:border-0"
                      >
                        <p className="font-medium text-foreground truncate">{t.title}</p>
                        <div className="flex gap-1.5 mt-0.5">
                          <Badge variant="secondary" className="text-[9px]">{t.sap_module}</Badge>
                          <Badge variant="secondary" className="text-[9px]">{t.status?.replace(/_/g, ' ')}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {linkedTickets.length > 0 && (
                  <div className="space-y-1.5">
                    {linkedTickets.map((link, i) => (
                      <div key={link.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 text-sm">
                        <Link2 className="w-3.5 h-3.5 text-primary shrink-0" />
                        <Badge variant="secondary" className="text-[9px] shrink-0">{link.linkType.replace(/_/g, ' ')}</Badge>
                        <span className="truncate flex-1 text-foreground">{link.title}</span>
                        <button
                          type="button"
                          onClick={() => setLinkedTickets(prev => prev.filter((_, idx) => idx !== i))}
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
            {form.description.length > 15 && (!aiCategorization || triageIsStale) && (
              <Button variant="outline" size="sm" onClick={runAiCategorize} disabled={aiLoading === 'categorize'} className="gap-1.5">
                {aiLoading === 'categorize' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                {t('ticket_create.ai_analyze')}
              </Button>
            )}

            {aiCategorization && !triageIsStale && (
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

      {step === 2 && (
        <SolutionSuggestions
          title={form.title}
          description={form.description}
          areas={form.sap_modules}
          other={form.sap_module_other}
          details={form.area_details}
          urgency={form.urgency}
          language={form.preferred_language}
          model={selectedModel}
          notesTried={form.sap_notes_tried}
          onSolved={() => setSolvedBySuggestion(true)}
        />
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

            <CriticalRequestOption urgency={form.urgency} value={critical} onChange={setCritical} />

            {/* Major Incident Toggle */}
            <div>
              <label className="text-sm font-medium mb-3 block">Ticket Type</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => updateForm('ticket_type', 'standard')}
                  className={`p-4 rounded-xl border-2 text-start transition-all ${form.ticket_type === 'standard' ? 'border-accent bg-accent/5' : 'border-border/50 hover:border-accent/30'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">Standard</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Regular support ticket</p>
                </button>
                <button
                  onClick={() => {
                    updateForm('ticket_type', 'major_incident');
                    updateForm('urgency', 'critical');
                  }}
                  className={`p-4 rounded-xl border-2 text-start transition-all ${form.ticket_type === 'major_incident' ? 'border-destructive bg-destructive/5' : 'border-red-300 hover:border-red-500'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                    <span className="text-sm font-semibold text-destructive">Major Incident</span>
                  </div>
                  <p className="text-xs text-muted-foreground">P1/P2 critical — requires immediate action</p>
                </button>
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
            <RequestContextSection value={contextInput} onChange={setContextInput} />
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
                  <p className="text-sm font-medium">{form.sap_modules.length > 0 ? form.sap_modules.map(n => areaLabel(n, form.sap_module_other)).join(', ') : '—'}</p>
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
              {form.urgency === 'critical' && critical.on && criticalTerms && (
                <div className="p-3 rounded-xl border border-red-200 bg-red-50/60 dark:bg-red-950/20" data-testid="review-critical">
                  <p className="text-xs text-muted-foreground mb-0.5">Critical reply service</p>
                  <p className="text-sm font-medium">{choiceSummary(critical, criticalTerms)}</p>
                </div>
              )}
              {form.area_details.trim() && (
                <div className="p-3 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-0.5">More details about the areas</p>
                  <p className="text-sm whitespace-pre-wrap">{form.area_details.trim()}</p>
                </div>
              )}
              {form.sap_notes_tried.length > 0 && (
                <div className="p-3 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-0.5">SAP Notes already tried</p>
                  <p className="text-sm font-mono">{form.sap_notes_tried.join(', ')}</p>
                </div>
              )}
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
          {(
            <Card className="rounded-2xl border-accent/20 bg-gradient-to-br from-accent/5 to-primary/5">
              <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Crown className="w-4 h-4 text-accent" />
                  AI-Recommended Experts
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  {fav.ready && (
                    <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setGroupPickOpen(true)}>
                      <Heart className="w-3.5 h-3.5" /> From my groups
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setManualPickOpen(true)}>
                    <UserPlus className="w-3.5 h-3.5" /> Browse & Choose Manually
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* The experts the client will ask (up to 3): they get a request when the ticket is created */}
                {picked.length > 0 && (
                  <div className="mb-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Experts you will ask to take this ticket ({picked.length} of {MAX_INVITED_EXPERTS})</p>
                    {picked.map(expert => (
                      <div key={expert.id} className="p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center gap-3">
                        <ConsultantRing consultantId={expert.id} name={expert.name} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{expert.name}</p>
                          <p className="text-xs text-muted-foreground">{expert.subtitle}</p>
                        </div>
                        <Badge className="bg-accent text-accent-foreground text-[10px]">{expert.source === 'ai' ? 'Suggested' : 'Your pick'}</Badge>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => togglePick(expert)}>Remove</Button>
                      </div>
                    ))}
                  </div>
                )}

                {matchRun && (matchRun.phase === 'ranking' || matchRun.phase === 'error') ? (
                  <TaskProgressPanel
                    title="Finding the best experts"
                    steps={matchSteps(matchRun.phase, matchRun.understood)}
                    startedAt={matchRun.startedAt}
                    error={matchRun.phase === 'error' ? matchRun.error : null}
                    onRetry={() => void runAiMatchConsultants()}
                    cancel={{ label: 'Cancel', onClick: cancelMatch }}
                    errorAction={{ label: 'Choose experts myself', onClick: () => { setMatchRun(null); setManualPickOpen(true); } }}
                    skeletonCount={3}
                    className="border-border/40 shadow-none"
                  />
                ) : matchRun?.phase === 'cancelled' ? (
                  <div className="space-y-3 py-6 text-center" data-testid="match-cancelled">
                    <p className="text-sm text-muted-foreground">Finding experts was stopped. Your request is not affected.</p>
                    <Button size="sm" variant="outline" onClick={() => void runAiMatchConsultants()}>Find the best experts</Button>
                  </div>
                ) : aiRecommendations && aiRecommendations.recommendations.length > 0 ? (
                  <div className="space-y-3 motion-safe:animate-fade-in">
                    {matchRun?.phase === 'done' && <TaskDoneNote text={expertsFound(matchRun.found ?? aiRecommendations.recommendations.length)} />}
                    {(aiRecommendations as any).questions?.length > 0 && !skipQuestions && (
                      <MatchClarifyingQuestions
                        questions={(aiRecommendations as any).questions as ClarifyKey[]}
                        onSkip={skipQuestions ? undefined : () => setSkipQuestions(true)}
                        onSubmit={(answers) => {
                          const extra = [answers.module && `SAP module: ${answers.module}`, answers.error && `Error / transaction: ${answers.error}`, answers.country && `Country: ${answers.country}`].filter(Boolean).join('\n');
                          if (extra) setForm(prev => ({ ...prev, description: `${prev.description.trim()}\n\n${extra}`.slice(0, 8000) }));
                          setMatchRerunPending(true);
                        }}
                      />
                    )}
                    <p className="text-xs text-muted-foreground mb-3">{aiRecommendations.overall_rationale}</p>
                    {(((aiRecommendations as any).questions?.length ?? 0) === 0 || skipQuestions) && aiRecommendations.recommendations.slice(0, 5).map((rec, i) => (
                      <RecommendationCard
                        key={rec.consultant_id}
                        rec={rec}
                        rank={i + 1}
                        navigate={navigate}
                        picked={picked.some(p => p.id === rec.consultant_id)}
                        pickDisabled={picked.length >= MAX_INVITED_EXPERTS}
                        onTogglePick={() => togglePick({ id: rec.consultant_id, name: rec.name, subtitle: `${rec.top_skills?.[0] || 'SAP'} · $${rec.hourly_rate}/hr`, source: 'ai' })}
                      />
                    ))}
                  </div>
                ) : picked.length === 0 ? (
                  <div className="py-6 text-center">
                    <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No AI recommendations yet. Use "Browse & Choose Manually" to pick an expert.</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Feature O: pick experts from the client's groups (the request still has at most MAX_INVITED_EXPERTS) */}
          <Dialog open={groupPickOpen} onOpenChange={setGroupPickOpen}>
            <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Heart className="w-5 h-5 text-destructive" /> From my groups</DialogTitle>
              </DialogHeader>
              <GroupInvitePanel
                candidates={allConsultants.filter(c => c.verification_status === 'verified' && !picked.some(p => p.id === c.id)).map(c => ({ id: c.id, name: c.name, subtitle: c.specialty }))}
                modules={form.sap_modules?.length ? form.sap_modules : [form.sap_module]}
                limit={Math.max(1, MAX_INVITED_EXPERTS - picked.length)}
                actionLabel="Add to this request"
                note={`Up to ${MAX_INVITED_EXPERTS} experts per new request. Each one gets their own request when the ticket is created and still decides whether to accept.`}
                onConfirm={(ids) => {
                  const add = allConsultants.filter(c => ids.includes(c.id)).map(c => ({ id: c.id, name: c.name, subtitle: `${c.specialty} · $${c.rate}/hr`, source: 'manual' as const }));
                  setPicked(prev => [...prev, ...add.filter(a => !prev.some(p => p.id === a.id))].slice(0, MAX_INVITED_EXPERTS));
                  setGroupPickOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>

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
                          role="button"
                          tabIndex={0}
                          aria-pressed={picked.some(p => p.id === c.id)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all hover:shadow-sm ${
                            picked.some(p => p.id === c.id)
                              ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                              : 'border-border/50 hover:border-accent/30'
                          }`}
                          onClick={() => togglePick({ id: c.id, name: c.name, subtitle: `${c.specialty} · $${c.rate}/hr`, source: 'manual' })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              togglePick({ id: c.id, name: c.name, subtitle: `${c.specialty} · $${c.rate}/hr`, source: 'manual' });
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <ConsultantRing consultantId={c.id} name={c.name} initials={c.avatar} size="sm" interactive={false} />
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
                              <p className="text-xs text-muted-foreground">{c.specialty}{c.place ? ` · ${c.place}` : ''}</p>
                              <TrustBadge badge={c.ai_interview_badge} credits={c.credibility_credits} className="mt-1" />
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
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">{picked.length} of {MAX_INVITED_EXPERTS} chosen</span>
                <Button size="sm" onClick={() => setManualPickOpen(false)}>Done</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      </div>

      {/* Submitting: step-by-step progress instead of the form (the form stays filled in behind it) */}
      {submitSteps && (
        <TaskProgressPanel
          title="Submitting your request"
          steps={submitSteps}
          startedAt={submitStartedAt}
          error={submitError}
          onRetry={() => void handleSubmit()}
          cancel={submitSteps.some(s => s.key === 'rank' && s.state === 'active') ? { label: 'Show my request now', onClick: showRequestNow } : undefined}
          errorAction={savedTicketRef.current ? { label: 'Continue without recommendations', onClick: continueWithoutMatches } : { label: 'Back to the form', onClick: backToForm }}
          note={submitSteps.some(s => s.key === 'rank' && s.state === 'active') ? undefined : 'Please keep this page open until your request is saved.'}
          skeletonCount={submitSteps.some(s => s.key === 'rank' && s.state === 'active') ? 3 : 0}
        />
      )}

      {/* Navigation */}
      {!submitSteps && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(step - 1)} disabled={step === 0 || submitting}>
            <ArrowLeft className="w-4 h-4 me-1 rtl:rotate-180" /> {t('onboarding.back')}
          </Button>
          {step < steps.length - 1 ? (
            <Button onClick={handleNext} className="gradient-primary border-0">
              {t('onboarding.next')} <ArrowRight className="w-4 h-4 ms-1 rtl:rotate-180" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting} aria-busy={submitting} className="gradient-primary border-0">
              {submitting ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Check className="w-4 h-4 me-1" />} {t('ticket_create.submit_request')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ====== Recommendation Card Component ======
function RecommendationCard({ rec, rank, navigate, picked, pickDisabled, onTogglePick }: {
  rec: ConsultantRecommendation;
  rank: number;
  navigate: (path: string) => void;
  picked?: boolean;
  pickDisabled?: boolean;
  onTogglePick?: () => void;
}) {
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
        <ConsultantRing consultantId={rec.consultant_id} name={rec.name} initials={initials} avatarUrl={rec.avatar_url} size="md"
          rating={rec.rating} reviews={rec.total_reviews} badge={rec.ai_interview_badge} verified={rec.verification_status === 'verified'}
          statusClass={rec.availability === 'available' ? 'bg-success' : rec.availability === 'busy' ? 'bg-warning' : 'bg-muted-foreground/40'} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm text-foreground">{rec.name}</h4>
            <FavouriteButton consultantId={rec.consultant_id} name={rec.name} size="sm" />
            <FavouriteChip consultantId={rec.consultant_id} />
            <Badge className={`text-[9px] px-1.5 py-0 h-4 ${rankBadge.cls}`}>{rankBadge.label}</Badge>
            {rec.verification_status === 'verified' && (
              <BadgeCheck className="w-3.5 h-3.5 text-accent shrink-0" />
            )}
            <TrustBadge badge={rec.ai_interview_badge} credits={rec.credibility_credits} />
          </div>
          <ConsultantRingPills consultantId={rec.consultant_id} rating={rec.rating} reviews={rec.total_reviews} className="mt-1" />

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

          <MatchWhyChips why={rec.why} />

          <ContextFitBadges fit={rec} />

          <MatchScoreBreakdown breakdown={rec.score_breakdown} />

          {/* Experience on similar issues: counts only, no names and no tickets */}
          {((rec.solved_similar ?? 0) > 0 || (rec.resolved_in_areas ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(rec.solved_similar ?? 0) > 0 && (
                <Badge variant="secondary" className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
                  <BadgeCheck className="w-2.5 h-2.5" /> Solved {rec.solved_similar} similar {rec.solved_similar === 1 ? 'issue' : 'issues'} before
                </Badge>
              )}
              {(rec.resolved_in_areas ?? 0) > 0 && (
                <Badge variant="secondary" className="text-[9px]">{rec.resolved_in_areas} resolved in these areas</Badge>
              )}
            </div>
          )}

          {/* Strengths & Skills */}
          <div className="flex flex-wrap gap-1 mt-2">
            {rec.strengths?.slice(0, 3).map((s, i) => (
              <Badge key={i} variant="secondary" className="text-[9px] bg-accent/10 text-accent">{s}</Badge>
            ))}
          </div>

          {/* Bottom row */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">${rec.hourly_rate}<span className="font-normal text-muted-foreground">/hr</span></span>
              {rec.response_time_minutes > 0 && (
                <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{rec.response_time_minutes}min avg</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onTogglePick && (
                <Button
                  size="sm"
                  variant={picked ? 'default' : 'outline'}
                  className="h-7 text-[10px] gap-1"
                  disabled={!picked && pickDisabled}
                  aria-pressed={!!picked}
                  onClick={onTogglePick}
                >
                  {picked ? <Check className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />} {picked ? 'Asked' : 'Ask this expert'}
                </Button>
              )}
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
    </div>
  );
}
