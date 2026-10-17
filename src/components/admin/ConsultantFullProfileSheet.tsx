import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { useProfileFieldRules } from '@/hooks/useProfileFieldRules';
import { credibility } from '@/lib/consultantCredibility';
import { maskAccount, maskIban } from '@/lib/iban';
import { CERT_BUCKET, certificateDocumentPath } from '@/lib/consultantReview';

type Row = Record<string, unknown>;
export type FullConsultantProfile = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : [];
const content = (v: unknown): string => {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(content).filter(Boolean).join(', ');
  if (typeof v === 'object') return Object.entries(object(v)).map(([k, x]) => `${k}: ${content(x)}`).join(', ');
  return String(v);
};
const outbound = (v: unknown): string | undefined => {
  try { const u = new URL(content(v)); return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined; } catch { return; }
};
const date = (v: unknown) => {
  if (!v) return undefined;
  const d = new Date(String(v)); return isNaN(d.getTime()) ? content(v) : d.toLocaleString();
};
const TABS = ['Overview', 'Personal & links', 'Experience', 'Records', 'Interviews', 'Payout'];

function DocumentLink({ value, label, empty = 'Not provided' }: { value: unknown; label: string; empty?: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string>(); const [error, setError] = useState(false);
  const path = certificateDocumentPath(content(value));
  useEffect(() => {
    let active = true; setUrl(undefined); setError(false);
    if (!path) return;
    supabase.storage.from(CERT_BUCKET).createSignedUrl(path, 60).then(({ data, error }) => {
      if (active) { setUrl(data?.signedUrl); setError(!!error); }
    });
    const timer = setTimeout(() => { if (active) setUrl(undefined); }, 55_000);
    return () => { active = false; clearTimeout(timer); };
  }, [path]);
  if (!path) return <span className="text-muted-foreground">{t(`admin.fullProfile.${empty}`, empty)}</span>;
  if (!url) return <span className="text-muted-foreground">{error ? t('admin.fullProfile.fileError', 'The file could not be opened.') : t('admin.fullProfile.fileLoading', 'Loading document…')}</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline break-all">{label}<ExternalLink className="h-3 w-3 shrink-0" /></a>;
}

export function ConsultantFullProfileBody({ data }: { data: FullConsultantProfile }) {
  const { t } = useTranslation(); const { labels } = useProfileFieldRules();
  const [tab, setTab] = useState('Overview'); const [reveal, setReveal] = useState(false);
  useEffect(() => { setReveal(false); }, [data, tab]);
  useEffect(() => { if (!reveal) return; const timer = setTimeout(() => setReveal(false), 30_000); return () => clearTimeout(timer); }, [reveal]);
  const c = object(data.consultant), p = object(data.profile), a = object(data.account), priv = object(data.private), pay = object(data.payout), counts = object(data.counts);
  const text = (v: unknown) => content(v) || t('admin.fullProfile.notProvided', 'Not provided');
  const label = (s: string) => t(`admin.fullProfile.${s}`, s);
  const bool = (v: unknown) => v == null ? undefined : v ? label('On') : label('Off');
  const fields = (items: [string, unknown][]) => <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{items.map(([name, value]) => <div key={name} className="min-w-0"><dt className="text-xs text-muted-foreground">{label(name)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{text(value)}</dd></div>)}</dl>;
  const table = (name: string, records: Row[], columns: [string, string][]) => <section key={name} className="space-y-2"><h3 className="font-semibold">{label(name)}</h3>{!records.length ? <p className="text-sm text-muted-foreground">{text(null)}</p> : <Table><TableHeader><TableRow>{columns.map(([l]) => <TableHead key={l}>{label(l)}</TableHead>)}</TableRow></TableHeader><TableBody>{records.map((r, i) => <TableRow key={content(r.id) || i}>{columns.map(([l, key]) => <TableCell key={key} className="align-top whitespace-pre-wrap break-words">{key === 'document_url' ? <DocumentLink value={r[key]} label={label('Document')} /> : key === 'verified' ? <Badge variant={r[key] ? 'default' : 'secondary'}>{label(r[key] ? 'Verified' : 'Not verified')}</Badge> : key === 'is_current' || key === 'certified' ? bool(r[key]) || text(null) : text(r[key])}</TableCell>)}</TableRow>)}</TableBody></Table>}</section>;
  const missing = Array.isArray(data.missing_required_fields) ? data.missing_required_fields : [];
  const bankStatus = !Object.keys(pay).length ? 'Missing' : pay.verified_at ? 'Verified' : 'Waiting for verification';
  return <Tabs value={tab} onValueChange={setTab} className="min-w-0">
    <div className="sticky top-0 z-10 bg-background pb-3"><TabsList className="h-auto flex flex-wrap justify-start">{TABS.map(s => <TabsTrigger key={s} value={s}>{label(s)}</TabsTrigger>)}</TabsList></div>
    <TabsContent value="Overview" className="space-y-6">
      {fields([['E-mail', a.email], ['Sign-in provider', a.provider], ['Registered on', date(a.created_at)], ['Last sign-in', date(a.last_sign_in_at)], ['Verification status', c.verification_status], ['Availability status', c.availability_status], ['Profile visible', bool(c.profile_visible)], ['New case alerts', bool(c.new_case_alerts)], ['AI interview badge', c.ai_interview_badge], ['AI interview date', date(c.ai_interview_completed_at)], ['Credibility credits', c.credibility_credits], ['Rating', c.rating], ['Reviews', c.total_reviews], ['Response time (minutes)', c.response_time_minutes], ['Assigned requests', counts.tickets_assigned], ['Bids', counts.bids], ['Signed NDAs', counts.ndas_signed]])}
      <section><h3 className="mb-2 font-semibold">{label('Missing required fields')}</h3><div className="flex flex-wrap gap-2">{missing.length ? missing.map(k => <Badge key={String(k)} variant="outline">{labels.get(String(k)) || String(k)}</Badge>) : <Badge className="bg-success/10 text-success border-success/20">{label('Profile complete')}</Badge>}</div></section>
    </TabsContent>
    <TabsContent value="Personal & links" className="space-y-6">
      {fields([['Display name', p.display_name], ['Phone', p.phone], ['Preferred language', p.preferred_language], ['Nationality', priv.nationality ?? c.nationality], ['Country', c.country], ['City', c.city], ['Time zone', c.timezone], ['Languages', c.languages], ['Languages with levels', c.language_levels], ['Work modes', c.work_modes], ['Working week', c.working_week], ['On-site countries', c.onsite_countries], ['Bio', c.bio], ['Hourly rate', c.hourly_rate], ['Currency', c.currency]])}
      <dl className="grid gap-3 sm:grid-cols-2">{[['LinkedIn', c.linkedin_url], ['GitHub', c.github_url], ['Website', c.personal_website], ['Credly', c.credly_username ? `https://www.credly.com/users/${encodeURIComponent(content(c.credly_username))}` : null], ['Profile video', c.profile_video_url]].map(([name, value]) => <div key={String(name)}><dt className="text-xs text-muted-foreground">{label(String(name))}</dt><dd>{outbound(value) ? <a className="text-sm text-primary underline break-all" href={outbound(value)} target="_blank" rel="noopener noreferrer">{text(value)}</a> : <span className="text-sm text-muted-foreground">{text(value)}</span>}</dd></div>)}</dl>
      <DocumentLink value={priv.cv_url ?? c.cv_url} label={label('CV file')} empty="No CV" />
    </TabsContent>
    <TabsContent value="Experience">{fields([['Main SAP role', c.sap_role], ['Seniority', c.seniority_level], ['Total SAP years', c.total_sap_years], ['SAP roles', c.sap_roles], ['Technologies', c.sap_technologies], ['Industries', c.industries], ['Customer segments', c.customer_segments], ['Vertical solutions', c.vertical_solutions], ['Localization countries', c.localization_countries], ['Localization solutions', c.localization_solutions], ['Deployment experience', c.deployment_experience], ['Project types', c.project_types], ['Project scale', c.project_scale]])}</TabsContent>
    <TabsContent value="Records" className="space-y-8">
      {table('Skills', rows(data.skills), [['Module','sap_module'], ['Level','proficiency_level'], ['Years','years_experience'], ['Certified','certified']])}
      {table('Certifications', rows(data.certifications), [['Name','name'], ['Issuer','issuer'], ['Issue date','issue_date'], ['Expiry date','expiry_date'], ['Verified','verified'], ['Document','document_url']])}
      {table('Work history', rows(data.work_history), [['Company','company_name'], ['Title','job_title'], ['From','start_date'], ['To','end_date'], ['Current','is_current'], ['Description','description']])}
      {table('Education', rows(data.education), [['Institution','institution'], ['Degree','degree'], ['Field of study','field_of_study'], ['From','start_year'], ['To','end_year']])}
      {table('Projects', rows(data.projects), [['Name','project_name'], ['Industry','client_industry'], ['Modules','sap_modules'], ['Role','role'], ['Months','duration_months'], ['Description','description']])}
      {table('Weekly availability', rows(data.availability).filter(r => r.is_recurring), [['Day','day_of_week'], ['From','start_time'], ['To','end_time']])}
      {table('Specific dates', rows(data.availability).filter(r => !r.is_recurring), [['Date','specific_date'], ['From','start_time'], ['To','end_time']])}
    </TabsContent>
    <TabsContent value="Interviews" className="space-y-6">{rows(data.interviews).length ? rows(data.interviews).map((r, i) => <section className="border-b border-border pb-5 space-y-3" key={content(r.id) || i}>{fields([['Type',r.interview_type], ['Style',r.interview_style], ['Status',r.status], ['Overall score',r.overall_score], ['Technical score',r.technical_score], ['Soft-skills score',r.soft_skills_score], ['Created on',date(r.created_at)], ['Started on',date(r.started_at)], ['Completed on',date(r.completed_at)]])}<details><summary className="cursor-pointer text-sm font-medium">{label('AI summary')}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{text(r.ai_summary)}</p></details></section>) : <p className="text-muted-foreground">{text(null)}</p>}</TabsContent>
    <TabsContent value="Payout" className="space-y-5">
      {fields([['Bank details status', label(bankStatus)], ['Disclaimer accepted on',date(pay.acknowledged_at)], ['Disclaimer version', pay.acknowledged_version], ['Account holder',pay.account_holder], ['Bank',pay.bank_name], ['Country',pay.country], ['Currency',pay.currency], ['Notes',pay.notes]])}
      <div className="space-y-3">{(['iban','account_number','swift_bic'] as const).map((key, i) => <div key={key}><p className="text-xs text-muted-foreground">{label(['IBAN','Account number','SWIFT'][i])}</p><p className="font-mono text-sm break-all" dir="ltr">{pay[key] ? reveal ? content(pay[key]) : key === 'iban' ? maskIban(content(pay[key])) : maskAccount(content(pay[key])) : text(null)}</p></div>)}</div>
      <Button size="sm" variant="outline" onClick={() => setReveal(v => !v)} disabled={!pay.iban && !pay.account_number && !pay.swift_bic}>{label(reveal ? 'Hide' : 'Show')}</Button>
      <p className="text-xs text-muted-foreground">{label('Viewing this profile is recorded in the audit log.')}</p>
    </TabsContent>
  </Tabs>;
}

function LoadedProfile({ consultantId }: { consultantId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin-consultant-full-profile', consultantId], queryFn: async () => {
    const { data, error } = await supabase.rpc('admin_consultant_full_profile', { _cid: consultantId });
    if (error) throw new Error(error.message);
    return object(data);
  }, staleTime: 30_000, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  const c = object(q.data?.consultant), p = object(q.data?.profile), a = object(q.data?.account);
  const score = credibility({ certifications: rows(q.data?.certifications), skills: rows(q.data?.skills).map(s => ({ years: Number(s.years_experience ?? 0) })), rating: Number(c.rating ?? 0), aiScore: Number(c.ai_skills_score ?? 0) });
  return <>
    <header className="shrink-0 border-b border-border p-5 pe-16 bg-background">
      <div className="flex items-center gap-3"><Avatar className="h-12 w-12"><AvatarImage src={outbound(p.avatar_url)} /><AvatarFallback>{content(p.display_name).slice(0,2) || '—'}</AvatarFallback></Avatar><div className="min-w-0"><SheetTitle className="break-words">{content(p.display_name) || t('admin.fullProfile.title','Consultant full profile')}</SheetTitle><SheetDescription className="break-all">{content(a.email)}</SheetDescription><div className="flex flex-wrap gap-2 mt-2"><Badge variant="outline">{content(c.verification_status) || t('admin.fullProfile.notProvided','Not provided')}</Badge><span className="text-xs">{t('admin.fullProfile.rating','Rating')}: {content(c.rating) || '—'}</span><span className="text-xs">{t('admin.fullProfile.credibility','Credibility')}: {q.data ? score.total : '—'}/100</span></div></div></div>
      <SheetClose asChild><Button variant="ghost" size="icon" className="absolute end-4 top-4" aria-label={t('common.close','Close')}><X className="h-4 w-4" /></Button></SheetClose>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">{q.isPending ? <div aria-label={t('admin.fullProfile.loading','Loading profile…')} className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}</div> : q.error ? <Alert variant="destructive"><AlertDescription>{q.error.message}</AlertDescription></Alert> : q.data && <ConsultantFullProfileBody data={q.data} />}</div>
  </>;
}

export default function ConsultantFullProfileSheet({ consultantId, onClose }: { consultantId: string | null; onClose: () => void }) {
  return <Sheet open={!!consultantId} onOpenChange={open => !open && onClose()}><SheetContent className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-4xl [&>button]:hidden">{consultantId && <LoadedProfile key={consultantId} consultantId={consultantId} />}</SheetContent></Sheet>;
}