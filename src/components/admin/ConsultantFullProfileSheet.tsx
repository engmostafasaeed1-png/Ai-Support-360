import FavouriteCount from '@/components/admin/FavouriteCount';
import ClientViewHint from '@/components/admin/ClientViewHint';
import { useEffect, useState, type ReactNode } from 'react';
import { safeRpc } from '@/lib/safeRpc';
import ProfileItemDecision from '@/components/admin/ProfileItemDecision';
import DecisionEmailNotice from '@/components/admin/DecisionEmailNotice';
import { decisionOptions, isVerificationState } from '@/lib/consultantReview';
import { consultantOutcome } from '@/lib/adminMessageEmail';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
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
import PayoutReadinessBadge from '@/components/admin/PayoutReadinessBadge';
import ConsultantLocation from '@/components/consultant/ConsultantLocation';
import { SuccessBreakdown } from '@/components/admin/SuccessAdmin';

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
const TABS = ['Overview', 'Personal & links', 'Experience', 'Records', 'Interviews', 'Review & history', 'Payout'];

function DocumentLink({ value, label, empty = 'Not provided', bucket = CERT_BUCKET }: { value: unknown; label: string; empty?: string; bucket?: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string>(); const [error, setError] = useState(false);
  const path = certificateDocumentPath(content(value));
  useEffect(() => {
    let active = true; setUrl(undefined); setError(false);
    if (!path) return;
    supabase.storage.from(bucket).createSignedUrl(path, 60).then(({ data, error }) => {
      if (active) { setUrl(data?.signedUrl); setError(!!error); }
    });
    const timer = setTimeout(() => { if (active) setUrl(undefined); }, 55_000);
    return () => { active = false; clearTimeout(timer); };
  }, [path, bucket]);
  if (!path) return <span className="text-muted-foreground">{t(`admin.fullProfile.${empty}`, empty)}</span>;
  if (!url) return <span className="text-muted-foreground">{error ? t('admin.fullProfile.fileError', 'The file could not be opened.') : t('admin.fullProfile.fileLoading', 'Loading document…')}</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline break-all">{label}<ExternalLink className="h-3 w-3 shrink-0" /></a>;
}

export function ConsultantFullProfileBody({ data, onChanged }: { data: FullConsultantProfile; onChanged?: () => void }) {
  const { t, i18n } = useTranslation(); const { labels } = useProfileFieldRules();
  const [tab, setTab] = useState('Overview'); const [reveal, setReveal] = useState(false);
  useEffect(() => { setReveal(false); }, [data, tab]);
  useEffect(() => { if (!reveal) return; const timer = setTimeout(() => setReveal(false), 30_000); return () => clearTimeout(timer); }, [reveal]);
  const c = object(data.consultant), p = object(data.profile), a = object(data.account), priv = object(data.private), pay = object(data.payout), counts = object(data.counts);
  const text = (v: unknown) => content(v) || t('admin.fullProfile.notProvided', 'Not provided');
  const label = (s: string) => t(`profileReview.labels.${s.replace(/\./g, '')}`, t(`admin.fullProfile.${s}`, s));
  const canFinance = data.finance_allowed === true;
  const bool = (v: unknown) => v == null ? undefined : v ? label('On') : label('Off');
  const fields = (items: [string, unknown][]) => <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{items.map(([name, value]) => <div key={name} className="min-w-0"><dt className="text-xs text-muted-foreground">{label(name)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{text(value)}</dd></div>)}</dl>;
  const table = (name: string, records: Row[], columns: [string, string][]) => <section key={name} className="space-y-2"><h3 className="font-semibold">{label(name)}</h3>{!records.length ? <p className="text-sm text-muted-foreground">{text(null)}</p> : <Table><TableHeader><TableRow>{columns.map(([l]) => <TableHead key={l}>{label(l)}</TableHead>)}</TableRow></TableHeader><TableBody>{records.map((r, i) => <TableRow key={content(r.id) || i}>{columns.map(([l, key]) => <TableCell key={key} className="align-top whitespace-pre-wrap break-words">{key === 'evidence_path' ? <DocumentLink value={r[key]} label={label('Evidence')} bucket="achievement-evidence" /> : key === 'reference_url' ? outbound(r[key]) ? <a href={outbound(r[key])} target="_blank" rel="noopener noreferrer" className="text-primary underline">{label('Reference')}</a> : text(null) : key === 'review' && typeof c.id === 'string' && typeof r.id === 'string' ? <ProfileItemDecision consultantId={c.id} kind={name === 'Success stories' ? 'success_story' : 'certificate'} itemId={r.id} label={content(r.title ?? r.name)} onChanged={onChanged} /> : key === 'document_url' ? <DocumentLink value={r[key]} label={label('Document')} /> : key === 'verified' ? <Badge variant={r[key] ? 'default' : 'secondary'}>{label(r[key] ? 'Verified' : 'Not verified')}</Badge> : key === 'is_current' || key === 'certified' ? bool(r[key]) || text(null) : text(r[key])}</TableCell>)}</TableRow>)}</TableBody></Table>}</section>;
  const missing = Array.isArray(data.missing_required_fields) ? data.missing_required_fields : [];
  const bankStatus = !Object.keys(pay).length ? 'Missing' : pay.verified_at ? 'Verified' : 'Waiting for verification';
  return <Tabs value={tab} onValueChange={setTab} dir={i18n?.dir() === 'rtl' ? 'rtl' : 'ltr'} className="min-w-0">
    <section className="mb-4 space-y-2 border-b border-border pb-4"><h3 className="font-semibold">{label('Completeness checklist')} <Badge variant={missing.length ? 'destructive' : 'outline'}>{t('requiredProfile.missing', { count: missing.length, defaultValue: '{{count}} missing' })}</Badge></h3><div className="flex flex-wrap gap-2">{missing.length ? missing.map(k => <Badge key={String(k)} variant="outline">{labels.get(String(k)) || String(k)}</Badge>) : <Badge variant="outline">{label('Required fields complete')}</Badge>}</div>{data.completion != null && fields([['Completion', object(data.completion).percent ?? object(data.completion).percentage], ['Checklist', object(data.completion).missing_items]])}</section>
    <div className="sticky top-0 z-10 bg-background pb-3"><TabsList className="h-auto flex flex-wrap justify-start">{TABS.map(s => <TabsTrigger key={s} value={s}>{label(s)}</TabsTrigger>)}</TabsList></div>
    <TabsContent value="Overview" className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><PayoutReadinessBadge ready={Object.keys(pay).length > 0} /><ConsultantLocation audience="admin" city={c.city as string | null} country={c.country as string | null} className="text-sm" /></div>
      {typeof c.id === 'string' && <FavouriteCount consultantId={c.id} />}
      {fields([['E-mail', a.email], ['Sign-in provider', a.provider], ['Registered on', date(a.created_at)], ['Last sign-in', date(a.last_sign_in_at)], ['Verification status', c.verification_status], ['Availability status', c.availability_status], ['Profile visible', bool(c.profile_visible)], ['New case alerts', bool(c.new_case_alerts)], ['AI interview badge', c.ai_interview_badge], ['AI interview date', date(c.ai_interview_completed_at)], ['Credibility credits', c.credibility_credits], ['Rating', c.rating], ['Reviews', c.total_reviews], ['Response time (minutes)', c.response_time_minutes], ['Assigned requests', counts.tickets_assigned], ['Bids', counts.bids], ['Signed NDAs', counts.ndas_signed]])}
      {typeof c.id === 'string' && <SuccessBreakdown consultantId={c.id} />}
    </TabsContent>
    <TabsContent value="Personal & links" className="space-y-6">
      {fields([['Display name', p.display_name], ['Phone', p.phone], ['Preferred language', p.preferred_language], ['Nationality', priv.nationality ?? c.nationality], ['Country', c.country], ['City', c.city], ['Time zone', c.timezone], ['Languages', c.languages], ['Languages with levels', c.language_levels], ['Work modes', c.work_modes], ['Working week', c.working_week], ['On-site countries', c.onsite_countries], ['Bio', c.bio], ['Hourly rate', c.hourly_rate], ['Currency', c.currency]])}
      <dl className="grid gap-3 sm:grid-cols-2">{[['LinkedIn', c.linkedin_url], ['GitHub', c.github_url], ['Website', c.personal_website], ['Credly', c.credly_username ? `https://www.credly.com/users/${encodeURIComponent(content(c.credly_username))}` : null], ['Profile video', c.profile_video_url]].map(([name, value]) => <div key={String(name)}><dt className="text-xs text-muted-foreground">{label(String(name))}</dt><dd>{outbound(value) ? <a className="text-sm text-primary underline break-all" href={outbound(value)} target="_blank" rel="noopener noreferrer">{text(value)}</a> : <span className="text-sm text-muted-foreground">{text(value)}</span>}</dd></div>)}</dl>
      {fields([['LinkedIn checked', date(c.linkedin_checked_at)], ['Credly checked', date(c.credly_checked_at)]])}
      <DocumentLink value={priv.cv_url ?? c.cv_url} label={label('CV file')} empty="No CV" />
    </TabsContent>
    <TabsContent value="Experience">{fields([['Professional roles', c.sap_roles], ['Primary role', c.sap_role], ['Role details', c.role_details], ['Main SAP role', c.sap_role], ['Seniority', c.seniority_level], ['Total SAP years', c.total_sap_years], ['SAP roles', c.sap_roles], ['Technologies', c.sap_technologies], ['Industries', c.industries], ['Customer segments', c.customer_segments], ['Vertical solutions', c.vertical_solutions], ['Localization countries', c.localization_countries], ['Localization solutions', c.localization_solutions], ['Deployment experience', c.deployment_experience], ['Project types', c.project_types], ['Project scale', c.project_scale]])}</TabsContent>
    <TabsContent value="Records" className="space-y-8">
      {table('Skills', rows(data.skills), [['Module','sap_module'], ['Level','proficiency_level'], ['Years','years_experience'], ['Versions','versions'], ['Certified','certified']])}
      {table('Certifications', rows(data.certifications), [['Name','name'], ['Issuer','issuer'], ['Issue date','issue_date'], ['Expiry date','expiry_date'], ['Verified','verified'], ['Document','document_url'], ['Review','review']])}
      {table('Work history', rows(data.work_history), [['Company','company_name'], ['Title','job_title'], ['From','start_date'], ['To','end_date'], ['Current','is_current'], ['Description','description']])}
      {table('Education', rows(data.education), [['Institution','institution'], ['Degree','degree'], ['Field of study','field_of_study'], ['From','start_year'], ['To','end_year']])}
      {table('Projects', rows(data.projects), [['Name','project_name'], ['Industry','client_industry'], ['Modules','sap_modules'], ['Role','role'], ['Months','duration_months'], ['Description','description']])}
      {table('Weekly availability', rows(data.availability).filter(r => r.is_recurring), [['Day','day_of_week'], ['From','start_time'], ['To','end_time']])}
      {table('Specific dates', rows(data.availability).filter(r => !r.is_recurring), [['Date','specific_date'], ['From','start_time'], ['To','end_time']])}
    </TabsContent>
    <TabsContent value="Interviews" className="space-y-6">{rows(data.interviews).length ? rows(data.interviews).map((r, i) => <section className="border-b border-border pb-5 space-y-3" key={content(r.id) || i}>{fields([['Type',r.interview_type], ['Style',r.interview_style], ['Status',r.status], ['Overall score',r.overall_score], ['Technical score',r.technical_score], ['Soft-skills score',r.soft_skills_score], ['Created on',date(r.created_at)], ['Started on',date(r.started_at)], ['Completed on',date(r.completed_at)]])}<details><summary className="cursor-pointer text-sm font-medium">{label('AI summary')}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{text(r.ai_summary)}</p></details></section>) : <p className="text-muted-foreground">{text(null)}</p>}</TabsContent>
    <TabsContent value="Review & history" className="space-y-6">
      {typeof c.id === 'string' && <section className="space-y-4"><h3 className="font-semibold">{label('Verifiable items')}</h3>{(['linkedin', 'credly'] as const).map(kind => <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3" key={kind}><span>{kind === 'linkedin' ? 'LinkedIn' : 'Credly'}</span><ProfileItemDecision consultantId={c.id as string} kind={kind} label={kind === 'linkedin' ? 'LinkedIn' : 'Credly'} onChanged={onChanged} /></div>)}{rows(data.certifications).map(r => typeof r.id === 'string' && <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"><span className="min-w-0 break-words">{text(r.name)}</span><ProfileItemDecision consultantId={c.id as string} kind="certificate" itemId={r.id} label={text(r.name)} onChanged={onChanged} /></div>)}{rows(data.verification_items).map(r => typeof r.id === 'string' && <div key={r.id} className="space-y-2 border-b border-border pb-3">{fields([['Document', r.label], ['Status', r.status], ['Comment', r.consultant_note]])}<ProfileItemDecision consultantId={c.id as string} kind="document" itemId={r.id} label={text(r.label)} onChanged={onChanged} /></div>)}</section>}
      {table('Success stories', rows(data.achievements), [['Title','title'], ['Role','role_played'], ['SAP area','sap_area'], ['Version','sap_version'], ['Industry','industry'], ['Outcome','outcome'], ['Year','year'], ['Status','status'], ['Review reason','review_reason'], ['Reference','reference_url'], ['Evidence','evidence_path'], ['Review','review']])}
      {table('Reviews', rows(data.reviews), [['Rating','score'], ['Comment','comment'], ['Created on','created_at']])}
      {fields([['Responsiveness', data.responsiveness], ['Success statistics', data.success], ['Flags and warnings', data.flags], ['Referral', data.referral]])}
      {table('NDAs', rows(data.ndas), [['Signed on','signed_at'], ['Client signed on','client_signed_at'], ['Revoked on','revoked_at']])}
      {table('Policy acceptance', rows(data.policy_acceptances), [['Version','version'], ['Accepted on','accepted_at']])}
      {table('Previous decisions', rows(data.review_history), [['From','old_status'], ['To','new_status'], ['Comment','reason'], ['Created on','created_at']])}
      {table('Item decision history', rows(data.item_history), [['Action','action'], ['Details','metadata'], ['Created on','created_at']])}
      {data.review_view_version !== 1 && <Alert><AlertDescription>{t('profileReview.pending', 'Additional review sections will be available after the database update is applied.')}</AlertDescription></Alert>}
    </TabsContent>
    <TabsContent value="Payout" className="space-y-5">
      {!canFinance && <Alert><AlertDescription>{t('profileReview.finance', 'Payout details are masked. Finance permission is required to reveal them.')}</AlertDescription></Alert>}
      {fields([['Bank details status', label(bankStatus)], ['Disclaimer accepted on',date(pay.acknowledged_at)], ['Disclaimer version', pay.acknowledged_version], ['Account holder',pay.account_holder], ['Bank',pay.bank_name], ['Country',pay.country], ['Currency',pay.currency], ['Notes',pay.notes]])}
      <div className="space-y-3">{(['iban','account_number','swift_bic'] as const).map((key, i) => <div key={key}><p className="text-xs text-muted-foreground">{label(['IBAN','Account number','SWIFT'][i])}</p><p className="font-mono text-sm break-all" dir="ltr">{pay[key] ? reveal && canFinance ? content(pay[key]) : key === 'iban' ? maskIban(content(pay[key])) : maskAccount(content(pay[key])) : text(null)}</p></div>)}</div>
      <Button size="sm" variant="outline" onClick={() => setReveal(v => !v)} reason={!canFinance ? { key: 'permission_missing', message: t('profileReview.finance', 'Finance permission is required to reveal payout details.') } : !pay.iban && !pay.account_number && !pay.swift_bic && 'no_data_yet'}>{label(reveal ? 'Hide' : 'Show')}</Button>
      <p className="text-xs text-muted-foreground">{label('Viewing this profile is recorded in the audit log.')}</p>
    </TabsContent>
  </Tabs>;
}

export function ProfileDecisionBar({ consultantId, status, onChanged }: { consultantId: string; status: unknown; onChanged: () => void }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (!isVerificationState(status)) return null;
  const options = decisionOptions(status);
  const option = options.find(o => o.to === target);
  const save = async () => {
    if (!option || busy) return;
    setBusy(true);
    const result = await safeRpc('admin_review_consultant', { _cid: consultantId, _status: option.to, _comment: comment.trim() || null });
    setBusy(false);
    if (result.error) { toast.error(result.error.message); return; }
    setTarget(null); setComment(''); onChanged();
  };
  return <><div className="flex flex-wrap justify-end gap-2">{options.map(o => <Button key={o.to} size="sm" variant={o.tone === 'danger' ? 'destructive' : 'outline'} onClick={() => { setTarget(o.to); setComment(''); }}>{t(`profileReview.status.${o.to}`, o.label)}</Button>)}</div>
    <Dialog open={!!option} onOpenChange={open => !open && setTarget(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{option && t(`profileReview.status.${option.to}`, option.title)}</DialogTitle><DialogDescription>{t('profileReview.comment', 'Comment')}</DialogDescription></DialogHeader><Textarea value={comment} maxLength={1000} onChange={e => setComment(e.target.value)} aria-label={t('profileReview.comment', 'Comment')} />
      {option && <DecisionEmailNotice consultantId={consultantId} subject="consultant_profile" outcomes={[consultantOutcome(status, option.to) ?? 'review']} comment={comment} link="/consultant/verification" />}
      <DialogFooter><Button variant="ghost" onClick={() => setTarget(null)} busy={busy}>{t('common.cancel', 'Cancel')}</Button><Button onClick={save} busy={busy}>{t('profileReview.save', 'Save decision')}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

function LoadedProfile({ consultantId, decisionBar, fullPage }: { consultantId: string; decisionBar?: ReactNode; fullPage?: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin-consultant-full-profile', consultantId], queryFn: async () => {
    const { data, error } = await safeRpc('admin_consultant_full_profile', { _cid: consultantId });
    if (error) throw new Error(error.message);
    const profile = { ...object(data) };
    // Older RPCs predate finance scoping: fail closed until the prepared SQL is applied.
    if (profile.finance_allowed !== true) { const pay = object(profile.payout); profile.payout = Object.keys(pay).length ? { verified_at: pay.verified_at, acknowledged_at: pay.acknowledged_at, iban: pay.iban ? maskIban(content(pay.iban)) : undefined, account_number: pay.account_number ? maskAccount(content(pay.account_number)) : undefined, swift_bic: pay.swift_bic ? maskAccount(content(pay.swift_bic)) : undefined } : null; }
    return profile;
  }, staleTime: 30_000, gcTime: 0, refetchOnMount: 'always', retry: false, refetchOnWindowFocus: false });
  const c = object(q.data?.consultant), p = object(q.data?.profile), a = object(q.data?.account);
  const score = credibility({ certifications: rows(q.data?.certifications), skills: rows(q.data?.skills).map(s => ({ years: Number(s.years_experience ?? 0) })), rating: Number(c.rating ?? 0), aiScore: Number(c.ai_skills_score ?? 0) });
  return <>
    <header className="shrink-0 border-b border-border p-5 pe-16 bg-background">
      <div className="flex items-center gap-3"><Avatar className="h-12 w-12"><AvatarImage src={outbound(p.avatar_url)} /><AvatarFallback>{content(p.display_name).slice(0,2) || '—'}</AvatarFallback></Avatar><div className="min-w-0"><SheetTitle className="break-words">{content(p.display_name) || t('admin.fullProfile.title','Consultant full profile')}</SheetTitle><SheetDescription className="break-all">{content(a.email)}</SheetDescription><ClientViewHint id={consultantId} className="mt-0.5" /><div className="flex flex-wrap gap-2 mt-2"><Badge variant="outline">{content(c.verification_status) || t('admin.fullProfile.notProvided','Not provided')}</Badge><span className="text-xs">{t('admin.fullProfile.rating','Rating')}: {content(c.rating) || '—'}</span><span className="text-xs">{t('admin.fullProfile.credibility','Credibility')}: {q.data ? score.total : '—'}/100</span></div></div></div>
      <div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><a href={`/admin/approvals?consultant=${encodeURIComponent(consultantId)}&profile=page`} target="_blank" rel="noopener noreferrer">{t('profileReview.fullPage', 'Open in full page')}<ExternalLink className="ms-2 h-3 w-3" /></a></Button></div>
      {!fullPage && <SheetClose asChild><Button variant="ghost" size="icon" className="absolute end-4 top-4" aria-label={t('common.close','Close')}><X className="h-4 w-4" /></Button></SheetClose>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">{q.isPending ? <div aria-label={t('admin.fullProfile.loading','Loading profile…')} className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}</div> : q.error ? <Alert variant="destructive"><AlertDescription>{q.error.message}</AlertDescription></Alert> : q.data && <ConsultantFullProfileBody data={q.data} onChanged={() => void q.refetch()} />}</div>
    <footer className="shrink-0 border-t border-border bg-background p-4 pe-20 sm:pe-4">{decisionBar ?? <ProfileDecisionBar consultantId={consultantId} status={c.verification_status} onChanged={() => void q.refetch()} />}</footer>
  </>;
}

export default function ConsultantFullProfileSheet({ consultantId, onClose, decisionBar, fullPage = false }: { consultantId: string | null; onClose: () => void; decisionBar?: ReactNode; fullPage?: boolean }) {
  if (fullPage && consultantId) return <Sheet open modal={false}><div className="flex h-[calc(100dvh-9rem)] min-h-96 flex-col"><LoadedProfile key={consultantId} consultantId={consultantId} decisionBar={decisionBar} fullPage /></div></Sheet>;
  return <Sheet open={!!consultantId} onOpenChange={open => !open && onClose()}><SheetContent className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-4xl [&>button]:hidden">{consultantId && <LoadedProfile key={consultantId} consultantId={consultantId} decisionBar={decisionBar} />}</SheetContent></Sheet>;
}