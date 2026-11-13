import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { safeRpc, isMissingRpc } from '@/lib/safeRpc';
import { OPEN_ADMIN_PROFILE, profileRoles, profilePageUrl, type AdminProfileTarget } from '@/lib/adminProfile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ConsultantFullProfileBody, ProfileDecisionBar } from './ConsultantFullProfileSheet';
import DecisionEmailNotice from './DecisionEmailNotice';
import DirectEmailDialog from './users/DirectEmailDialog';

type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : [];
const text = (v: unknown): string => v == null || v === '' ? '—' : Array.isArray(v) ? v.map(text).join(', ') : typeof v === 'object' ? Object.entries(object(v)).map(([k,x]) => `${k}: ${text(x)}`).join('\n') : String(v);

function Section({ title, value }: { title: string; value: unknown }) {
  const { t } = useTranslation();
  const records = Array.isArray(value) ? rows(value) : [object(value)];
  return <section className="space-y-3 border-b border-border pb-5"><h3 className="font-semibold">{t(`userFullProfile.${title}`, title)}</h3>{records.length && records.some(r => Object.keys(r).length) ? records.map((r,i) => <dl key={i} className="grid gap-3 sm:grid-cols-2">{Object.entries(r).map(([key,v]) => <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{t(`userFullProfile.fields.${key}`, key.replace(/_/g,' '))}</dt><dd className="whitespace-pre-wrap break-words text-sm">{text(v)}</dd></div>)}</dl>) : <p className="text-sm text-muted-foreground">{t('userFullProfile.noRecords', 'No stored records.')}</p>}</section>;
}

function ClientDecision({ userId, onChanged }: {userId: string; onChanged: () => void}) {
  const { t } = useTranslation();
  const [decision,setDecision] = useState<'approve'|'request_changes'|null>(null);
  const [comment,setComment] = useState('');
  const [busy,setBusy] = useState(false);
  const save = async () => {
    if (!decision || busy) return;
    setBusy(true);
    const r = await safeRpc('admin_review_client',{p_user_id:userId,p_decision:decision,p_comment:comment.trim() || null});
    setBusy(false);
    if(r.error){toast.error(r.error.message);return;}
    setDecision(null);setComment('');onChanged();
  };
  return <><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>setDecision('request_changes')}>{t('profileReview.changes','Needs changes')}</Button><Button size="sm" onClick={()=>setDecision('approve')}>{t('profileReview.approve','Approve')}</Button></div>
    <Dialog open={!!decision} onOpenChange={o=>!o&&setDecision(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t('userFullProfile.clientDecision','Client company review')}</DialogTitle><DialogDescription>{t('profileReview.comment','Comment')}</DialogDescription></DialogHeader><Textarea value={comment} maxLength={2000} aria-label={t('profileReview.comment','Comment')} onChange={e=>setComment(e.target.value)} />
      <DecisionEmailNotice userId={userId} subject="client_account" outcomes={[decision==='approve'?'approved':'changes']} comment={comment} link="/client/company" />
      <DialogFooter><Button variant="ghost" onClick={()=>setDecision(null)} busy={busy}>{t('common.cancel','Cancel')}</Button><Button onClick={save} busy={busy} reason={decision==='request_changes'&&comment.trim().length<3&&'type_message_first'}>{t('profileReview.save','Save decision')}</Button></DialogFooter>
    </DialogContent></Dialog></>;
}

export function UserFullProfileBody({ data, onChanged }: { data: Row; onChanged: () => void }) {
  const { t,i18n } = useTranslation();
  const roles = profileRoles(data.roles);
  const [tab,setTab] = useState(roles.includes('consultant')?'consultant':roles.includes('client')?'client':'account');
  const client = object(data.client);
  return <Tabs value={tab} onValueChange={setTab} dir={i18n.dir()} className="min-w-0"><TabsList className="sticky top-0 z-10 h-auto flex-wrap justify-start bg-background">{['account',...roles,'history','emails'].map(r=><TabsTrigger key={r} value={r}>{t(`userFullProfile.${r}`,r)}</TabsTrigger>)}</TabsList>
    <TabsContent value="account" className="space-y-5"><Section title="account" value={data.account} /><Section title="preferences" value={data.preferences} /><Section title="warnings" value={data.warnings} /><Section title="sessions" value={data.sessions} /></TabsContent>
    {roles.includes('consultant')&&<TabsContent value="consultant"><ConsultantFullProfileBody data={object(data.consultant)} onChanged={onChanged}/></TabsContent>}
    {roles.includes('client')&&<TabsContent value="client" className="space-y-5">{typeof client.custom_nda_path==='string'&&<PrivateClientFile path={client.custom_nda_path}/>} {['company','billing','team','landscape','tickets','bids','payments','ndas','terms','ratings_given','ratings_received','agreements','referral','decisions'].map(k=><Section key={k} title={k} value={client[k]}/>)}</TabsContent>}
    {roles.filter(r=>r==='admin'||r==='super_admin').map(role=><TabsContent key={role} value={role}><Section title="account" value={data.account}/><Section title="warnings" value={data.warnings}/></TabsContent>)}
    <TabsContent value="history" className="space-y-5"><Section title="activity" value={data.activity}/><Section title="messages" value={data.messages}/><Section title="decisions" value={data.decisions}/></TabsContent>
    <TabsContent value="emails"><Section title="emails" value={data.emails}/></TabsContent>
  </Tabs>;
}

function PrivateClientFile({path}:{path:string}) {
  const {t}=useTranslation();const [busy,setBusy]=useState(false);
  const open=async()=>{setBusy(true);const r=await supabase.storage.from('nda-documents').createSignedUrl(path,60);setBusy(false);if(r.error){toast.error(r.error.message);return;}if(r.data?.signedUrl)window.open(r.data.signedUrl,'_blank','noopener,noreferrer');};
  return <Button variant="outline" size="sm" busy={busy} onClick={open}>{t('userFullProfile.ndaFile','Open company NDA file')}</Button>;
}

function Loaded({ target, onClose, fullPage }: {target: AdminProfileTarget; onClose:()=>void; fullPage:boolean}) {
  const { t } = useTranslation();
  const [email,setEmail] = useState(false);
  const q=useQuery({queryKey:['admin-user-full-profile',target.userId,target.consultantId],gcTime:0,staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:false,retry:false,queryFn:async()=>{
    const r=await safeRpc('admin_user_full_profile',{_uid:target.userId??null,_cid:target.userId?null:target.consultantId??null});
    if(r.error)throw new Error(isMissingRpc(r.error)?t('userFullProfile.pending','The full user profile will be available after the prepared database update is applied.'):r.error.message);
    return object(r.data);
  }});
  const account=object(q.data?.account);const userId=typeof account.user_id==='string'?account.user_id:target.userId;
  return <><header className="relative shrink-0 space-y-2 border-b border-border p-5 pe-16"><SheetTitle>{text(account.display_name??account.name??account.email) === '—'?t('userFullProfile.title','Full user profile'):text(account.display_name??account.name??account.email)}</SheetTitle><SheetDescription className="break-all">{text(account.email)}</SheetDescription><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href={profilePageUrl(target)} target="_blank" rel="noopener noreferrer"><ExternalLink className="me-2 h-4 w-4"/>{t('profileReview.fullPage','Open in full page')}</a></Button>{userId&&q.data?.can_message===true&&<Button size="sm" variant="outline" onClick={()=>setEmail(true)}>{t('ade.title','Send e-mail')}</Button>}</div><Button variant="ghost" size="icon" className="absolute end-3 top-3" aria-label={t('common.close','Close')} onClick={onClose}><X className="h-4 w-4"/></Button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">{q.isPending?<Skeleton className="h-40"/>:q.error?<Alert variant="destructive"><AlertDescription>{q.error.message}</AlertDescription></Alert>:q.data&&<UserFullProfileBody data={q.data} onChanged={()=>void q.refetch()}/>}</div>
    {userId&&profileRoles(q.data?.roles).includes('client')&&q.data?.can_review_client===true&&<footer className="shrink-0 border-t border-border bg-background p-4 pe-20"><ClientDecision userId={userId} onChanged={()=>void q.refetch()}/></footer>}
    {q.data?.can_verify_consultant===true&&typeof object(q.data?.consultant).consultant==='object'&&typeof object(object(q.data?.consultant).consultant).id==='string'&&<footer className="shrink-0 border-t border-border bg-background p-4 pe-20"><ProfileDecisionBar consultantId={String(object(object(q.data?.consultant).consultant).id)} status={object(object(q.data?.consultant).consultant).verification_status} onChanged={()=>void q.refetch()}/></footer>}
    {userId&&<DirectEmailDialog open={email} onOpenChange={setEmail} ids={[userId]} label={text(account.display_name??account.name??account.email)} sampleName={text(account.display_name)}/>}
  </>;
}

export function AdminProfileHost() {
  const [params,setParams]=useSearchParams();
  const [target,setTarget]=useState<AdminProfileTarget|null>(null);
  const pageTarget=params.get('fullUser')?{userId:params.get('fullUser')??undefined}:params.get('fullConsultant')?{consultantId:params.get('fullConsultant')??undefined}:null;
  useEffect(()=>{const open=(e:Event)=>setTarget((e as CustomEvent<AdminProfileTarget>).detail);window.addEventListener(OPEN_ADMIN_PROFILE,open);return()=>window.removeEventListener(OPEN_ADMIN_PROFILE,open);},[]);
  const active=target??pageTarget;const fullPage=!target&&!!pageTarget&&params.get('profilePage')==='1';
  const close=()=>{setTarget(null);if(pageTarget){const p=new URLSearchParams(params);p.delete('fullUser');p.delete('fullConsultant');p.delete('profilePage');setParams(p,{replace:true});}};
  if(fullPage&&active)return <Sheet open modal={false}><div className="mx-auto flex h-[calc(100dvh-9rem)] min-h-96 max-w-6xl flex-col bg-background"><Loaded key={active.userId??active.consultantId} target={active} onClose={close} fullPage/></div></Sheet>;
  return <Sheet open={!!active} onOpenChange={o=>!o&&close()}><SheetContent className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-5xl [&>button]:hidden">{active&&<Loaded key={active.userId??active.consultantId} target={active} onClose={close} fullPage={false}/>}</SheetContent></Sheet>;
}

export function AdminProfileSearch() {
  const {t}=useTranslation();const [open,setOpen]=useState(false);const [search,setSearch]=useState('');const [term,setTerm]=useState('');
  useEffect(()=>{const id=setTimeout(()=>setTerm(search.trim()),300);return()=>clearTimeout(id);},[search]);
  const q=useQuery({queryKey:['admin-profile-search',term],enabled:open&&term.length>=2,retry:false,gcTime:0,queryFn:async()=>{const r=await safeRpc('admin_users_search',{_p:{q:term,page:1,page_size:10}});if(r.error)throw new Error(r.error.message);return rows(object(r.data).rows);}});
  return <><Button variant="ghost" size="icon" aria-label={t('userFullProfile.search','Search user profiles')} title={t('userFullProfile.search','Search user profiles')} onClick={()=>setOpen(true)}><Search className="h-4 w-4"/></Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{t('userFullProfile.search','Search user profiles')}</DialogTitle><DialogDescription>{t('userFullProfile.searchHint','Name, e-mail or company')}</DialogDescription></DialogHeader><Input value={search} onChange={e=>setSearch(e.target.value)} aria-label={t('userFullProfile.search','Search user profiles')}/>{q.error&&<p role="alert">{q.error.message}</p>}<div className="max-h-96 space-y-2 overflow-y-auto">{q.data?.map(r=><Button key={text(r.id??r.user_id)} variant="ghost" className="h-auto w-full justify-start whitespace-normal text-start" onClick={()=>{const id=r.id??r.user_id;if(typeof id==='string'){setOpen(false);window.dispatchEvent(new CustomEvent(OPEN_ADMIN_PROFILE,{detail:{userId:id}}));}}}>{text(r.name??r.display_name)} · {text(r.email)}</Button>)}</div></DialogContent></Dialog></>;
}