import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle, Bold, CalendarClock, Eye, FlaskConical, ImageIcon, Link2, List, Loader2, Mail, MessageCircle, MousePointerClick,
  Save, Search, Send, ShieldAlert, Smartphone, Users,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import MessageBody from '@/components/messages/MessageBody';
import SendViaSelector from '@/components/admin/SendViaSelector';
import { isSendChannel, type ChannelMap, type SendChannel } from '@/lib/sendChannels';
import {
  BRAND_IMAGES, EMPTY_FILTER, LIMITS, SELECTED_KEY, VARIABLES, buildAudience, confirmationOk, footerText, needsTypedConfirmation,
  parseEmails, renderVariables, riskWarnings, secretFindings, splitList, toPlainText, zonedToUtc,
  type AudienceFilter, type AudienceKind, type Category, type Channel,
} from '@/lib/bulkMessaging';
import {
  useBulkActions, useClientGroups, useSavedAudiences, useTemplates, type AudiencePreview, type BulkSettings, type PreviewRecipient,
} from '@/hooks/useBulkMessaging';

const ROLES = ['client', 'consultant', 'admin', 'super_admin'] as const;
const BADGES = ['gold', 'silver', 'bronze', 'verified'] as const;
const VERIFICATION = ['pending', 'under_review', 'verified', 'on_hold', 'rejected'] as const;
const SAMPLE = { first_name: 'Sara', company: 'Acme Trading', profile_completion: 80 };

function timeZones(): string[] {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : ['UTC', 'Asia/Riyadh', 'Asia/Dubai', 'Africa/Cairo', 'Europe/London', 'Europe/Berlin', 'America/New_York'];
  return [here, ...all.filter((z) => z !== here)];
}

function readSelected(): string[] {
  try { const v = JSON.parse(sessionStorage.getItem(SELECTED_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5000) : []; }
  catch { return []; }
}

export default function ComposeMessage({ settings, onSent }: { settings: BulkSettings; onSent: (id: string) => void }) {
  const { t } = useTranslation();
  const actions = useBulkActions();
  const templates = useTemplates(true);
  const saved = useSavedAudiences(true);
  const groups = useClientGroups(true);

  const [selectedIds] = useState<string[]>(readSelected);
  const [kind, setKind] = useState<AudienceKind>(selectedIds.length ? 'users' : 'filter');
  const [filter, setFilter] = useState<AudienceFilter>(EMPTY_FILTER);
  const [countries, setCountries] = useState('');
  const [areas, setAreas] = useState('');
  const [groupId, setGroupId] = useState('');
  const [emails, setEmails] = useState('');
  const [savedId, setSavedId] = useState('');
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [exclude, setExclude] = useState<Set<string>>(new Set());
  const [listSearch, setListSearch] = useState('');

  const [category, setCategory] = useState<Category | ''>('');
  const [subjectEn, setSubjectEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [subjectAr, setSubjectAr] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [editLang, setEditLang] = useState<'en' | 'ar'>('en');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [channels, setChannels] = useState<Set<Channel>>(new Set(['in_app']));
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [local, setLocal] = useState('');
  const zones = useMemo(timeZones, []);
  const [tz, setTz] = useState(zones[0]);
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);

  const fullFilter = useMemo<AudienceFilter>(() => ({ ...filter, countries: splitList(countries), sap_areas: splitList(areas) }), [filter, countries, areas]);
  const audience = useMemo(() => buildAudience(kind, { userIds: selectedIds, filter: fullFilter, groupId, emails, savedId }), [kind, selectedIds, fullFilter, groupId, emails, savedId]);
  const audienceKey = JSON.stringify(audience);
  useEffect(() => { setPreview(null); setExclude(new Set()); setTyped(''); }, [audienceKey, category]);
  useEffect(() => { setAck(false); }, [category]);

  const allText = [subjectEn, bodyEn, subjectAr, bodyAr].join('\n');
  const secrets = secretFindings(allText);
  const risks = riskWarnings(allText);
  const eligibleIds = (preview?.recipients ?? []).filter((r) => !r.excluded).map((r) => r.user_id);
  const count = preview ? Math.max(0, preview.eligible - [...exclude].filter((id) => eligibleIds.includes(id)).length) : 0;
  const scheduledAt = when === 'later' ? zonedToUtc(local, tz) : null;
  const timeOk = when === 'now' || (scheduledAt !== null && scheduledAt.getTime() > Date.now() - 60_000 && scheduledAt.getTime() < Date.now() + 90 * 86_400_000);
  const linkOk = !linkUrl.trim() || /^(\/[^/]|https:\/\/(www\.)?aisupport360\.com(\/|$))/.test(linkUrl.trim());
  const canSend = !!preview && count > 0 && !!category && ack && subjectEn.trim() && bodyEn.trim() && secrets.length === 0
    && channels.size > 0 && timeOk && linkOk && confirmationOk(typed, count) && settings.enabled && !actions.create.isPending;

  const runPreview = async () => {
    if (!category) { toast.error(t('bmsg.choose_category_first', 'Choose service or marketing first: it decides who is excluded.')); return; }
    if (kind === 'emails' && parseEmails(emails).length === 0) { toast.error(t('bmsg.no_emails', 'Paste at least one e-mail address.')); return; }
    setPreviewing(true);
    try { setPreview(await actions.preview(audience, category, [])); }
    catch (e) { toast.error((e as Error).message); }
    finally { setPreviewing(false); }
  };

  const insert = (snippet: string) => {
    const el = bodyRef.current;
    const set = editLang === 'en' ? setBodyEn : setBodyAr;
    const value = editLang === 'en' ? bodyEn : bodyAr;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const text = snippet.replace('$SEL', selected || t('bmsg.text', 'text'));
    set((value.slice(0, start) + text + value.slice(end)).slice(0, LIMITS.body));
    requestAnimationFrame(() => el?.focus());
  };

  const loadTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.data?.find((x) => x.id === id);
    if (!tpl) return;
    setCategory(tpl.category); setSubjectEn(tpl.subject_en); setBodyEn(tpl.body_en);
    setSubjectAr(tpl.subject_ar ?? ''); setBodyAr(tpl.body_ar ?? ''); setLinkUrl(tpl.link_url ?? '');
  };

  const saveTemplate = async () => {
    const name = window.prompt(t('bmsg.template_name', 'Template name'), templates.data?.find((x) => x.id === templateId)?.name ?? subjectEn.slice(0, 60));
    if (!name?.trim() || !category) { if (!category) toast.error(t('bmsg.choose_category_first_short', 'Choose service or marketing first.')); return; }
    try {
      const id = await actions.saveTemplate.mutateAsync({ id: templateId || undefined, name: name.trim().slice(0, 80), category, subject_en: subjectEn, subject_ar: subjectAr, body_en: bodyEn, body_ar: bodyAr, link_url: linkUrl.trim() });
      setTemplateId(id); toast.success(t('bmsg.template_saved', 'Template saved'));
    } catch (e) { toast.error((e as Error).message); }
  };

  const saveAudience = async () => {
    const name = window.prompt(t('bmsg.audience_name', 'Name for this audience'));
    if (!name?.trim()) return;
    try { await actions.saveAudience.mutateAsync({ name: name.trim().slice(0, 80), audience }); toast.success(t('bmsg.audience_saved', 'Audience saved')); }
    catch (e) { toast.error((e as Error).message); }
  };

  const sample = useMemo(() => {
    const first = (preview?.recipients ?? []).find((r) => !r.excluded);
    return first ? { ...SAMPLE, first_name: first.name.split(/\s+/)[0] } : SAMPLE;
  }, [preview]);
  const rendered = (lang: 'en' | 'ar') => {
    const useAr = lang === 'ar' && bodyAr.trim();
    const vars = { ...sample, link: linkUrl.trim() || undefined };
    const l = useAr ? 'ar' : 'en';
    return {
      lang: l as 'en' | 'ar',
      fallback: lang === 'ar' && !useAr,
      subject: renderVariables((useAr && subjectAr.trim()) ? subjectAr : subjectEn, vars, l),
      body: renderVariables(useAr ? bodyAr : bodyEn, vars, l),
      footer: footerText(l, category || 'service'),
    };
  };

  const sendTest = async () => {
    if (!subjectEn.trim() || !bodyEn.trim()) { toast.error(t('bmsg.write_first', 'Write a subject and a message first.')); return; }
    if (secrets.length) { toast.error(t('bmsg.secret_block', 'Remove the password or key first.')); return; }
    const r = rendered('en');
    try { await actions.test(r.subject, `${toPlainText(r.body)}\n\n${r.footer}`.slice(0, 1000), category || 'service'); toast.success(t('bmsg.test_sent', 'Test sent to your notifications')); }
    catch (e) { toast.error((e as Error).message); }
  };

  const submit = async () => {
    if (!canSend || !category) return;
    try {
      const r = await actions.create.mutateAsync({
        category, category_confirmed: ack, channels: [...channels], subject_en: subjectEn.trim(), subject_ar: subjectAr.trim(),
        body_en: bodyEn.trim(), body_ar: bodyAr.trim(), link_url: linkUrl.trim(), audience, exclude: [...exclude],
        scheduled_at: scheduledAt ? scheduledAt.toISOString() : null, time_zone: tz, confirm_count: count, template_id: templateId || null,
      });
      sessionStorage.removeItem(SELECTED_KEY);
      toast.success(when === 'later'
        ? t('bmsg.scheduled_ok', 'Scheduled for {{n}} people', { n: r.recipient_count })
        : t('bmsg.sending_ok', 'Sending to {{n}} people has started', { n: r.recipient_count }));
      onSent(r.id);
    } catch (e) { toast.error((e as Error).message); }
  };

  // "Send via" (shared with the Refer & earn invitation): in-app, e-mail, push, Telegram. Pop-up and manual channels stay extra rows.
  const standard = [...channels].filter(isSendChannel) as SendChannel[];
  const setStandard = (v: SendChannel[]) => setChannels((s) => {
    const n = new Set<Channel>([...s].filter((c) => !isSendChannel(c)));
    for (const c of v) if (c !== 'email') n.add(c as Channel);
    if (!n.has('in_app')) n.delete('popup');
    return n;
  });
  const sendInfo: ChannelMap = {
    in_app: { available: true, eligible: preview ? count : undefined },
    email: { available: false, reason: 'email_bulk' },
    push: !settings.push_channel ? { available: false, reason: 'needs_update' }
      : settings.push_ready === false ? { available: false, reason: 'push_not_ready' }
      : { available: true, eligible: preview?.push_enabled },
    telegram: { available: true, eligible: preview?.telegram_linked },
  };
  const toggleChannel = (c: Channel, on: boolean) => setChannels((s) => { const n = new Set(s); if (on) n.add(c); else n.delete(c); if (c === 'popup' && on) n.add('in_app'); if (c === 'in_app' && !on) n.delete('popup'); return n; });
  const reasonLabel = (r: string) => ({
    suspended: t('bmsg.ex_suspended', 'suspended'), deleted: t('bmsg.ex_deleted', 'deleted'), unsubscribed: t('bmsg.ex_unsubscribed', 'unsubscribed or e-mail blocked'),
    paused: t('bmsg.ex_paused', 'paused notifications'), excluded_by_admin: t('bmsg.ex_admin', 'removed by you'),
  } as Record<string, string>)[r] ?? r;
  const list = (preview?.recipients ?? []).filter((r) => !listSearch.trim() || r.name.toLowerCase().includes(listSearch.trim().toLowerCase()));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4 min-w-0">
        {!settings.enabled && (
          <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>{t('bmsg.off_title', 'Bulk messages are switched off')}</AlertTitle>
            <AlertDescription>{t('bmsg.off_desc', 'A super admin switched off sending in the settings. You can still prepare a message.')}</AlertDescription></Alert>
        )}

        {/* 1. Audience */}
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />{t('bmsg.step_audience', '1. Who receives it')}</CardTitle>
            <CardDescription>{t('bmsg.audience_hint', 'Existing accounts only. Suspended and deleted accounts never receive messages.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('bmsg.category', 'Kind of message')}</Label>
              <RadioGroup value={category} onValueChange={(v) => setCategory(v as Category)} className="grid gap-2 sm:grid-cols-2">
                {(['service', 'marketing'] as const).map((c) => (
                  <Label key={c} htmlFor={`bm-cat-${c}`} className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 font-normal has-[:checked]:border-primary">
                    <RadioGroupItem id={`bm-cat-${c}`} value={c} className="mt-0.5" />
                    <span><span className="block text-sm font-medium">{c === 'service' ? t('bmsg.service', 'Service notice') : t('bmsg.marketing', 'News and offers (marketing)')}</span>
                      <span className="block text-xs text-muted-foreground">{c === 'service'
                        ? t('bmsg.service_hint', 'Only about accounts or the service (changes, outages, required steps). Delivered even to people who paused notifications.')
                        : t('bmsg.marketing_hint', 'Skips people who paused notifications or unsubscribed from e-mails.')}</span></span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <Tabs value={kind} onValueChange={(v) => setKind(v as AudienceKind)}>
              <TabsList className="flex h-auto flex-wrap">
                {selectedIds.length > 0 && <TabsTrigger value="users">{t('bmsg.k_users', 'Selected ({{n}})', { n: selectedIds.length })}</TabsTrigger>}
                <TabsTrigger value="filter">{t('bmsg.k_filter', 'Filter')}</TabsTrigger>
                <TabsTrigger value="saved">{t('bmsg.k_saved', 'Saved')}</TabsTrigger>
                <TabsTrigger value="group">{t('bmsg.k_group', 'Client group')}</TabsTrigger>
                <TabsTrigger value="emails">{t('bmsg.k_emails', 'Paste e-mails')}</TabsTrigger>
              </TabsList>
              <TabsContent value="users" className="text-sm text-muted-foreground">{t('bmsg.users_hint', '{{n}} people selected on the Users page.', { n: selectedIds.length })}</TabsContent>
              <TabsContent value="filter" className="space-y-3">
                <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{t('bmsg.f_roles', 'Roles')}</legend>
                  <div className="flex flex-wrap gap-3">{ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-1.5 text-sm"><Checkbox checked={filter.roles.includes(r)}
                      onCheckedChange={(v) => setFilter((f) => ({ ...f, roles: v ? [...f.roles, r] : f.roles.filter((x) => x !== r) }))} />{t(`bmsg.role_${r}`, r)}</label>))}</div>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label htmlFor="bm-countries">{t('bmsg.f_countries', 'Countries (comma separated)')}</Label><Input id="bm-countries" value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="Saudi Arabia, Egypt" /></div>
                  <div className="space-y-1"><Label htmlFor="bm-areas">{t('bmsg.f_areas', 'SAP areas (comma separated)')}</Label><Input id="bm-areas" value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="FI, CO, Basis" /></div>
                </div>
                <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{t('bmsg.f_badges', 'Interview badge')}</legend>
                  <div className="flex flex-wrap gap-3">{BADGES.map((b) => (
                    <label key={b} className="flex items-center gap-1.5 text-sm capitalize"><Checkbox checked={filter.badges.includes(b)}
                      onCheckedChange={(v) => setFilter((f) => ({ ...f, badges: v ? [...f.badges, b] : f.badges.filter((x) => x !== b) }))} />{t(`bmsg.badge_${b}`, b)}</label>))}</div>
                </fieldset>
                <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{t('bmsg.f_verification', 'Consultant verification')}</legend>
                  <div className="flex flex-wrap gap-3">{VERIFICATION.map((v) => (
                    <label key={v} className="flex items-center gap-1.5 text-sm"><Checkbox checked={filter.verification.includes(v)}
                      onCheckedChange={(on) => setFilter((f) => ({ ...f, verification: on ? [...f.verification, v] : f.verification.filter((x) => x !== v) }))} />{t(`bmsg.verif_${v}`, v.replace('_', ' '))}</label>))}</div>
                </fieldset>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([['incomplete_profile', t('bmsg.f_incomplete', 'Profile not complete')], ['location_missing', t('bmsg.f_location', 'Location missing (consultants)')],
                    ['policy_not_acknowledged', t('bmsg.f_policy', 'Service policy not confirmed')]] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between gap-2 rounded-xl border p-2.5 text-sm">{label}
                      <Switch checked={filter[k]} onCheckedChange={(v) => setFilter((f) => ({ ...f, [k]: v }))} aria-label={label} /></label>))}
                  <div className="flex items-center justify-between gap-2 rounded-xl border p-2.5 text-sm">
                    <Label htmlFor="bm-inactive" className="font-normal">{t('bmsg.f_inactive', 'Inactive for (days)')}</Label>
                    <Input id="bm-inactive" type="number" min={1} max={3650} className="h-8 w-24" value={filter.inactive_days ?? ''} placeholder="90"
                      onChange={(e) => setFilter((f) => ({ ...f, inactive_days: e.target.value ? Number(e.target.value) : null }))} />
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={saveAudience}><Save className="me-1 h-4 w-4" />{t('bmsg.save_audience', 'Save this filter')}</Button>
              </TabsContent>
              <TabsContent value="saved" className="space-y-2">
                {(saved.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('bmsg.no_saved', 'No saved audiences yet. Save a filter or group first.')}</p> : (
                  <div className="flex items-center gap-2">
                    <Select value={savedId} onValueChange={setSavedId}><SelectTrigger className="max-w-sm" aria-label={t('bmsg.k_saved', 'Saved')}><SelectValue placeholder={t('bmsg.pick_saved', 'Choose a saved audience')} /></SelectTrigger>
                      <SelectContent>{saved.data!.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
                    {savedId && <Button variant="ghost" size="sm" onClick={async () => { await actions.deleteAudience.mutateAsync(savedId); setSavedId(''); }}>{t('bmsg.delete', 'Delete')}</Button>}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="group" className="space-y-2">
                <Select value={groupId} onValueChange={setGroupId}><SelectTrigger className="max-w-md" aria-label={t('bmsg.k_group', 'Client group')}><SelectValue placeholder={t('bmsg.pick_group', 'Choose a client group')} /></SelectTrigger>
                  <SelectContent>{(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.company ? `${g.company} · ` : ''}{g.name} ({g.members})</SelectItem>)}</SelectContent></Select>
                <p className="text-xs text-muted-foreground">{t('bmsg.group_hint', 'Sends to the consultants in that client group. The client is not told.')}</p>
                {groupId && <Button type="button" variant="outline" size="sm" onClick={saveAudience}><Save className="me-1 h-4 w-4" />{t('bmsg.save_group', 'Save this group as an audience')}</Button>}
              </TabsContent>
              <TabsContent value="emails" className="space-y-1">
                <Label htmlFor="bm-emails">{t('bmsg.emails_label', 'E-mail addresses of existing accounts')}</Label>
                <Textarea id="bm-emails" rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com, other@company.com" />
                <p className="text-xs text-muted-foreground">{t('bmsg.emails_hint', '{{n}} addresses recognised. Addresses without an account are ignored and only counted.', { n: parseEmails(emails).length })}</p>
              </TabsContent>
            </Tabs>

            <Button onClick={runPreview} disabled={previewing}>{previewing ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Eye className="me-1 h-4 w-4" />}{t('bmsg.preview_recipients', 'Preview recipients')}</Button>

            {preview && (
              <div className="space-y-3" aria-live="polite">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label={t('bmsg.s_will_receive', 'Will receive')} value={count} strong />
                  <Stat label={t('bmsg.s_excluded', 'Excluded')} value={preview.candidates - preview.eligible + (preview.eligible - count)} />
                  <Stat label={t('bmsg.s_telegram', 'Telegram linked')} value={preview.telegram_linked} />
                  <Stat label={t('bmsg.s_phone', 'With phone number')} value={preview.with_phone} />
                </div>
                {Object.keys(preview.excluded).length > 0 && (
                  <ul className="rounded-xl bg-muted p-3 text-xs">{Object.entries(preview.excluded).map(([k, n]) => <li key={k}>{t('bmsg.excluded_n', '{{n}} not included: {{why}}', { n, why: reasonLabel(k) })}</li>)}</ul>
                )}
                {preview.unknown_emails > 0 && <p className="text-xs text-muted-foreground">{t('bmsg.unknown_emails', '{{n}} addresses have no account and were ignored.', { n: preview.unknown_emails })}</p>}
                <p className="text-xs text-muted-foreground">{t('bmsg.today', '{{used}} of {{cap}} recipients used today (daily limit).', { used: preview.sent_today, cap: preview.daily_cap })}</p>
                <div className="relative"><Search className="pointer-events-none absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="ps-8" value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder={t('bmsg.search_list', 'Search this list')} aria-label={t('bmsg.search_list', 'Search this list')} /></div>
                <ul className="max-h-72 divide-y overflow-auto rounded-xl border" aria-label={t('bmsg.recipient_list', 'Recipients')}>
                  {list.map((r) => <RecipientRow key={r.user_id} r={r} excluded={exclude.has(r.user_id)} reason={r.excluded ? reasonLabel(r.excluded) : null}
                    onToggle={(on) => setExclude((s) => { const n = new Set(s); if (on) n.delete(r.user_id); else n.add(r.user_id); return n; })} />)}
                </ul>
                {preview.candidates > preview.recipients.length && <p className="text-xs text-muted-foreground">{t('bmsg.list_cut', 'Showing the first {{n}} people.', { n: preview.recipients.length })}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Message */}
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="h-4 w-4" />{t('bmsg.step_message', '2. Message')}</CardTitle>
            <CardDescription>{t('bmsg.message_hint', 'Everyone gets their own language. Write Arabic text too, or Arabic speakers get the English text. No attachments: use links.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={templateId} onValueChange={loadTemplate}><SelectTrigger className="w-60" aria-label={t('bmsg.templates', 'Templates')}><SelectValue placeholder={t('bmsg.load_template', 'Start from a template')} /></SelectTrigger>
                <SelectContent>{(templates.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
              <Button variant="outline" size="sm" onClick={saveTemplate}><Save className="me-1 h-4 w-4" />{t('bmsg.save_template', 'Save as template')}</Button>
            </div>
            <Tabs value={editLang} onValueChange={(v) => setEditLang(v as 'en' | 'ar')}>
              <TabsList><TabsTrigger value="en">English</TabsTrigger><TabsTrigger value="ar">العربية</TabsTrigger></TabsList>
              {(['en', 'ar'] as const).map((l) => (
                <TabsContent key={l} value={l} className="space-y-2" dir={l === 'ar' ? 'rtl' : 'ltr'}>
                  <div className="space-y-1"><Label htmlFor={`bm-subj-${l}`}>{l === 'en' ? t('bmsg.subject_en', 'Subject (required)') : t('bmsg.subject_ar', 'Subject in Arabic (optional)')}</Label>
                    <Input id={`bm-subj-${l}`} maxLength={LIMITS.subject} value={l === 'en' ? subjectEn : subjectAr} onChange={(e) => (l === 'en' ? setSubjectEn : setSubjectAr)(e.target.value)} /></div>
                  <div className="flex flex-wrap gap-1" role="toolbar" aria-label={t('bmsg.toolbar', 'Formatting')}>
                    <Tool icon={Bold} label={t('bmsg.t_bold', 'Bold')} onClick={() => insert('**$SEL**')} />
                    <Tool icon={List} label={t('bmsg.t_list', 'List item')} onClick={() => insert('\n- $SEL')} />
                    <Tool icon={Link2} label={t('bmsg.t_link', 'Link')} onClick={() => insert('[$SEL](https://www.aisupport360.com/)')} />
                    <Tool icon={MousePointerClick} label={t('bmsg.t_button', 'Button')} onClick={() => insert('\n[[Open|https://www.aisupport360.com/]]\n')} />
                    <Select onValueChange={(v) => insert(`\n![AI Support 360](brand:${v})\n`)}><SelectTrigger className="h-8 w-36" aria-label={t('bmsg.t_image', 'Brand image')}><ImageIcon className="me-1 h-4 w-4" /><SelectValue placeholder={t('bmsg.t_image', 'Brand image')} /></SelectTrigger>
                      <SelectContent>{BRAND_IMAGES.map((b) => <SelectItem key={b} value={b}>{t(`bmsg.img_${b}`, b)}</SelectItem>)}</SelectContent></Select>
                    {VARIABLES.map((v) => <Button key={v} type="button" variant="secondary" size="sm" className="h-8 font-mono text-xs" onClick={() => insert(`{{${v}}}`)}>{`{{${v}}}`}</Button>)}
                  </div>
                  <Textarea ref={l === editLang ? bodyRef : undefined} id={`bm-body-${l}`} rows={9} maxLength={LIMITS.body} aria-label={l === 'en' ? t('bmsg.body_en', 'Message (required)') : t('bmsg.body_ar', 'Message in Arabic (optional)')}
                    value={l === 'en' ? bodyEn : bodyAr} onChange={(e) => (l === 'en' ? setBodyEn : setBodyAr)(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{(l === 'en' ? bodyEn : bodyAr).length} / {LIMITS.body}</p>
                </TabsContent>
              ))}
            </Tabs>
            <div className="space-y-1"><Label htmlFor="bm-link">{t('bmsg.link_label', 'Link for {{link}} (a page of this site)', { link: '{{link}}', interpolation: { escapeValue: false } })}</Label>
              <Input id="bm-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/consultant/profile" aria-invalid={!linkOk} />
              {!linkOk && <p className="text-xs text-destructive">{t('bmsg.link_bad', 'Use a page of www.aisupport360.com, for example /consultant/profile.')}</p>}</div>
            {secrets.length > 0 && (
              <Alert variant="destructive" role="alert"><ShieldAlert className="h-4 w-4" /><AlertTitle>{t('bmsg.secret_title', 'This looks like a password or key')}</AlertTitle>
                <AlertDescription>{t('bmsg.secret_desc', 'Never send passwords, keys or tokens. Remove them to continue.')}</AlertDescription></Alert>
            )}
            {risks.length > 0 && (
              <Alert role="status"><AlertTriangle className="h-4 w-4" /><AlertTitle>{t('bmsg.risk_title', 'Please double-check')}</AlertTitle>
                <AlertDescription><ul className="list-disc ps-5 text-xs">{risks.map((r) => <li key={r}>{({
                  contact_email: t('bmsg.risk_email', 'The text contains an e-mail address.'), contact_phone: t('bmsg.risk_phone', 'The text contains a phone number.'),
                  contact_link: t('bmsg.risk_chat', 'The text links to WhatsApp or Telegram.'), payment: t('bmsg.risk_payment', 'The text mentions payment or bank details. We never ask users to pay outside the platform.'),
                  external_link: t('bmsg.risk_external', 'The text links to another website.'),
                } as Record<string, string>)[r]}</li>)}</ul></AlertDescription></Alert>
            )}
          </CardContent>
        </Card>

        {/* 3. Channels and timing */}
        <Card className="border-border/40">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" />{t('bmsg.step_channels', '3. Channels and time')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              <li className="list-none"><SendViaSelector idPrefix="bm" value={standard} onChange={setStandard} info={sendInfo} showCounts={!!preview} /></li>
              <p className="text-xs text-muted-foreground">{t('bmsg.rates', 'In-app up to {{a}} per minute, Telegram about {{b}} per minute. Telegram: plain text and one link.', { a: settings.inapp_per_minute, b: settings.telegram_per_minute })}</p>
              <ChannelRow id="popup" checked={channels.has('popup')} onChange={toggleChannel} title={t('bmsg.ch_popup', 'Pop-up on next visit')} status={t('bmsg.st_works', 'Works now')} ok
                hint={t('bmsg.ch_popup_hint', 'Also shows the message once in a window until it is read.')} />
              <ChannelRow id="whatsapp_manual" checked={channels.has('whatsapp_manual')} onChange={toggleChannel} title={t('bmsg.ch_whatsapp', 'WhatsApp (you send it yourself)')} status={t('bmsg.st_manual', 'Manual')}
                hint={t('bmsg.ch_whatsapp_hint', 'After saving you get a list with an "Open WhatsApp" button per person that opens your own WhatsApp with the text filled in.')} />
              <ChannelRow id="sms_manual" checked={channels.has('sms_manual')} onChange={toggleChannel} title={t('bmsg.ch_sms', 'SMS (you send it yourself)')} status={t('bmsg.st_manual', 'Manual')}
                hint={t('bmsg.ch_sms_hint', 'Same list with an "Open SMS" button that opens your phone\'s messages app.')} />
              <li className="flex items-start gap-3 rounded-xl border border-dashed p-3 opacity-80">
                <Smartphone className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <div className="text-sm"><span className="font-medium">{t('bmsg.ch_paid', 'Automatic WhatsApp / SMS')}</span> <Badge variant="outline">{t('bmsg.st_off', 'Off')}</Badge>
                  <p className="text-xs text-muted-foreground">{t('bmsg.ch_paid_hint', 'There is no free official automatic channel. A paid provider (charged per message) can be added once the owner chooses one.')}</p></div>
              </li>
            </ul>

            <div className="space-y-2">
              <Label>{t('bmsg.when', 'When')}</Label>
              <RadioGroup value={when} onValueChange={(v) => setWhen(v as 'now' | 'later')} className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="now" />{t('bmsg.now', 'Now')}</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="later" />{t('bmsg.later', 'Later')}</label>
              </RadioGroup>
              {when === 'later' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1"><Label htmlFor="bm-when">{t('bmsg.date_time', 'Date and time')}</Label><Input id="bm-when" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="bm-tz">{t('bmsg.time_zone', 'Time zone')}</Label>
                    <Select value={tz} onValueChange={setTz}><SelectTrigger id="bm-tz"><SelectValue /></SelectTrigger><SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent></Select></div>
                  {local && scheduledAt && <p className="text-xs text-muted-foreground sm:col-span-2"><CalendarClock className="me-1 inline h-3 w-3" />{t('bmsg.utc_is', 'That is {{when}} in your browser time.', { when: scheduledAt.toLocaleString() })}</p>}
                  {local && !timeOk && <p className="text-xs text-destructive sm:col-span-2">{t('bmsg.time_bad', 'Choose a time in the next 90 days.')}</p>}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 4. Review */}
        <Card className="border-primary/30">
          <CardHeader className="pb-3"><CardTitle className="text-base">{t('bmsg.step_review', '4. Check and send')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!preview && <p className="text-sm text-muted-foreground">{t('bmsg.need_preview', 'Preview the recipients first.')}</p>}
            {preview && <p className="text-sm">{t('bmsg.summary', '{{n}} people · {{ch}} · {{cat}}', { n: count, ch: [...channels].map((c) => t(`bmsg.chs_${c}`, c)).join(', '), cat: category === 'marketing' ? t('bmsg.marketing_short', 'marketing') : t('bmsg.service_short', 'service') })}</p>}
            {category && (
              <label className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
                <span>{category === 'service'
                  ? t('bmsg.ack_service', 'I confirm this is a service notice about accounts or the service, not news or offers. Service notices reach people who paused notifications.')
                  : t('bmsg.ack_marketing', 'I confirm this is news or an offer. People who paused notifications or unsubscribed are left out.')}</span></label>
            )}
            {preview && needsTypedConfirmation(count) && (
              <div className="space-y-1"><Label htmlFor="bm-typed">{t('bmsg.type_count', 'Type {{n}} to confirm the number of recipients', { n: count })}</Label>
                <Input id="bm-typed" inputMode="numeric" className="w-32" value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={!!typed && !confirmationOk(typed, count)} /></div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={sendTest}><FlaskConical className="me-1 h-4 w-4" />{t('bmsg.send_test', 'Send me a test')}</Button>
              <Button className="gradient-primary border-0" disabled={!canSend} onClick={submit}>
                {actions.create.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Send className="me-1 h-4 w-4" />}
                {when === 'later' ? t('bmsg.schedule_n', 'Schedule for {{n}}', { n: count }) : t('bmsg.send_n', 'Send to {{n}}', { n: count })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live preview */}
      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start" aria-label={t('bmsg.live_preview', 'Live preview')}>
        <p className="text-sm font-medium">{t('bmsg.live_preview_for', 'Preview for {{name}}', { name: sample.first_name })}</p>
        {(['en', 'ar'] as const).map((l) => {
          const r = rendered(l);
          return (
            <Card key={l} className="border-border/40">
              <CardContent className="space-y-2 p-4" dir={r.lang === 'ar' ? 'rtl' : 'ltr'}>
                <div className="flex items-center justify-between gap-2"><Badge variant="secondary">{l === 'en' ? 'English' : 'العربية'}</Badge>
                  {r.fallback && <span className="text-[11px] text-muted-foreground">{t('bmsg.ar_fallback', 'No Arabic text: English is sent')}</span>}</div>
                <p className="font-semibold">{r.subject || t('bmsg.no_subject', '(no subject)')}</p>
                <MessageBody text={r.body || '…'} lang={r.lang} />
                <p className="whitespace-pre-line border-t pt-2 text-[11px] text-muted-foreground">{r.footer}</p>
              </CardContent>
            </Card>
          );
        })}
      </aside>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <div className="rounded-xl border p-2.5"><p className="text-xs text-muted-foreground">{label}</p><p className={strong ? 'text-xl font-bold text-primary' : 'text-lg font-semibold'}>{value}</p></div>;
}

function Tool({ icon: Icon, label, onClick }: { icon: typeof Bold; label: string; onClick: () => void }) {
  return <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={onClick} aria-label={label} title={label}><Icon className="h-4 w-4" /></Button>;
}

function ChannelRow({ id, checked, onChange, title, status, hint, ok }: { id: Channel; checked: boolean; onChange: (c: Channel, on: boolean) => void; title: string; status: string; hint: string; ok?: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border p-3">
      <Checkbox id={`bm-ch-${id}`} checked={checked} onCheckedChange={(v) => onChange(id, !!v)} className="mt-0.5" />
      <div className="text-sm"><Label htmlFor={`bm-ch-${id}`} className="font-medium">{title}</Label>{' '}
        <Badge variant={ok ? 'secondary' : 'outline'}>{status}</Badge>
        <p className="text-xs text-muted-foreground">{hint}</p></div>
    </li>
  );
}

function RecipientRow({ r, excluded, reason, onToggle }: { r: PreviewRecipient; excluded: boolean; reason: string | null; onToggle: (include: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <Checkbox checked={!reason && !excluded} disabled={!!reason} onCheckedChange={(v) => onToggle(!!v)} aria-label={t('bmsg.include_x', 'Include {{name}}', { name: r.name })} />
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name}</p>
        <p className="truncate text-xs text-muted-foreground">{[r.role && t(`bmsg.role_${r.role}`, r.role), r.country, r.lang === 'ar' ? 'العربية' : 'English'].filter(Boolean).join(' · ')}</p></div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {reason ? <Badge variant="outline" className="text-[10px]">{reason}</Badge> : <>
          {r.telegram && <Badge variant="secondary" className="text-[10px]">Telegram</Badge>}
          {r.has_phone && <Badge variant="secondary" className="text-[10px]">{t('bmsg.phone', 'Phone')}</Badge>}
        </>}
      </div>
    </li>
  );
}
