import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, PenTool, ShieldCheck, Type } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SignaturePad, { typedToPng, type SignaturePadHandle } from './SignaturePad';
import {
  errorKey, ISSUING_COUNTRIES, maskIdNumber, normaliseIdNumber, signFormProblems, strokeMetrics, submitSignature,
  type IdType, type NdaParty, type SignFormProblem, type SignMethod, type Stroke,
} from '@/lib/nda/api';
import { useRefreshNda } from '@/hooks/useNdaSigning';

export interface NdaSignFormProps {
  party: NdaParty;
  action: 'sign' | 'supplement';
  ndaId?: string | null;
  consultantId?: string | null;
  clientId?: string | null;
  ndaContent?: string | null;
  defaultName?: string;
  defaultCompany?: string;
  allowTyped: boolean;
  onDone(r: { ndaId: string; signatureId: string }): void;
  onCancel?(): void;
  /** Extra footer content (e.g. "Back to review"). */
  secondaryAction?: React.ReactNode;
}

type Field = 'signature' | 'name' | 'idType' | 'country' | 'idNumber' | 'title' | 'company' | 'authorised' | 'agreed';
const FIELD_OF: Record<SignFormProblem, Field> = {
  signature_empty: 'signature', signature_too_short: 'signature', signature_too_small: 'signature', signature_too_complex: 'signature',
  typed_not_allowed: 'signature', typed_required: 'signature',
  name_required: 'name', name_too_long: 'name', name_letters_only: 'name', name_two_words: 'name',
  id_type_required: 'idType', id_country_required: 'country', id_country_invalid: 'country',
  id_required: 'idNumber', id_format: 'idNumber', id_length: 'idNumber', id_needs_digit: 'idNumber', id_repeated: 'idNumber',
  title_required: 'title', title_too_long: 'title', title_contact: 'title',
  company_required: 'company', company_too_long: 'company', company_contact: 'company',
  not_authorised: 'authorised', not_agreed: 'agreed',
};

/**
 * The NDA signing step (both parties): free-hand signature, full legal name, ID document, authorisation, and for a
 * client job title + company. The Sign button stays disabled with inline messages until every item is valid; the
 * server checks everything again.
 */
export default function NdaSignForm(p: NdaSignFormProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const refresh = useRefreshNda();
  const pad = useRef<SignaturePadHandle>(null);
  const [method, setMethod] = useState<SignMethod>('draw');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [typed, setTyped] = useState('');
  const [name, setName] = useState(p.defaultName ?? '');
  const [idType, setIdType] = useState<IdType | ''>('');
  const [country, setCountry] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState(p.defaultCompany ?? '');
  const [authorised, setAuthorised] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const touch = (f: Field) => setTouched((s) => (s[f] ? s : { ...s, [f]: true }));

  const metrics = useMemo(() => strokeMetrics(strokes), [strokes]);
  const problems = signFormProblems({
    party: p.party, method, metrics, typedSignature: typed, allowTyped: p.allowTyped, name, idType, idCountry: country, idNumber,
    authorised, agreed, jobTitle: title, companyName: company,
  });
  const byField = new Map<Field, SignFormProblem>();
  for (const pr of problems) if (!byField.has(FIELD_OF[pr])) byField.set(FIELD_OF[pr], pr);
  const show = (f: Field) => (touched[f] ? byField.get(f) : undefined);
  const msg = (f: Field) => {
    const pr = show(f);
    return pr ? <p id={`nda-${f}-msg`} className="text-xs text-destructive" role="alert">{t(`ndaSign.problem.${pr}`)}</p> : null;
  };
  const missing = [...new Set(problems.map((x) => FIELD_OF[x]))];

  const countries = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try { dn = new Intl.DisplayNames([lang], { type: 'region' }); } catch { dn = null; }
    return ISSUING_COUNTRIES.map((c) => ({ code: c, name: dn?.of(c) ?? c })).sort((a, b) => a.name.localeCompare(b.name, lang));
  }, [lang]);

  const preview = idNumber && !byField.has('idNumber') ? maskIdNumber(idNumber) : '';

  const submit = async () => {
    setTouched({ signature: true, name: true, idType: true, country: true, idNumber: true, title: true, company: true, authorised: true, agreed: true });
    if (problems.length || busy) return;
    setBusy(true);
    setServerError(null);
    const png = method === 'draw' ? pad.current!.toPng() : typedToPng(typed.trim());
    const r = await submitSignature({
      action: p.action, party: p.party, ndaId: p.ndaId, consultantId: p.consultantId, clientId: p.clientId, ndaContent: p.ndaContent,
      method, strokes: method === 'draw' ? strokes : [], typedSignature: method === 'typed' ? typed.trim() : undefined, png,
      signerName: name, jobTitle: title, companyName: company, idType: idType as IdType, idCountry: country, idNumber: normaliseIdNumber(idNumber),
    });
    setBusy(false);
    if (!r.ok) {
      setServerError(t(errorKey(r.code)));
      return;
    }
    toast.success(p.action === 'supplement' ? t('ndaSign.toast.detailsAdded') : t('ndaSign.toast.signed'));
    void refresh();
    p.onDone({ ndaId: r.data.nda_id, signatureId: r.data.signature_id });
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {/* (a) signature */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-foreground">{t('ndaSign.f.signature')}</legend>
        {p.allowTyped && (
          <Tabs value={method} onValueChange={(v) => { setMethod(v as SignMethod); touch('signature'); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="draw" className="gap-1.5"><PenTool className="h-3.5 w-3.5" aria-hidden /> {t('ndaSign.f.draw')}</TabsTrigger>
              <TabsTrigger value="typed" className="gap-1.5"><Type className="h-3.5 w-3.5" aria-hidden /> {t('ndaSign.f.typeMine')}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {method === 'draw' ? (
          <SignaturePad
            ref={pad}
            onChange={(s) => { setStrokes(s); touch('signature'); }}
            label={t('ndaSign.f.padLabel')}
            hint={t('ndaSign.f.padHint')}
            clearLabel={t('ndaSign.f.clear')}
            undoLabel={t('ndaSign.f.undo')}
            describedBy="nda-signature-msg"
            invalid={!!show('signature')}
            disabled={busy}
          />
        ) : (
          <div className="space-y-1">
            <Label htmlFor="nda-typed">{t('ndaSign.f.typedLabel')}</Label>
            <Input id="nda-typed" value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={() => touch('signature')} maxLength={120}
              className="font-serif text-lg italic" aria-describedby="nda-signature-msg" autoComplete="off" />
          </div>
        )}
        {msg('signature')}
        {!p.allowTyped && <p className="text-[11px] text-muted-foreground">{t('ndaSign.f.cannotDraw')}</p>}
      </fieldset>

      {/* (b) full legal name */}
      <div className="space-y-1">
        <Label htmlFor="nda-name">{t('ndaSign.f.name')}</Label>
        <Input id="nda-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => touch('name')} maxLength={120} autoComplete="name"
          aria-invalid={!!show('name')} aria-describedby="nda-name-hint nda-name-msg" />
        <p id="nda-name-hint" className="text-[11px] text-muted-foreground">{p.defaultName ? t('ndaSign.f.nameFromProfile') : t('ndaSign.f.nameHint')}</p>
        {msg('name')}
      </div>

      {/* (c) ID document */}
      <fieldset className="space-y-3 rounded-xl border border-border/60 p-3">
        <legend className="px-1 text-sm font-semibold text-foreground">{t('ndaSign.f.idDoc')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="nda-id-type">{t('ndaSign.f.idType')}</Label>
            <Select value={idType} onValueChange={(v) => { setIdType(v as IdType); touch('idType'); }}>
              <SelectTrigger id="nda-id-type" aria-invalid={!!show('idType')}><SelectValue placeholder={t('ndaSign.f.choose')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="national_id">{t('ndaSign.idType.national_id')}</SelectItem>
                <SelectItem value="passport">{t('ndaSign.idType.passport')}</SelectItem>
              </SelectContent>
            </Select>
            {msg('idType')}
          </div>
          <div className="space-y-1">
            <Label htmlFor="nda-id-country">{t('ndaSign.f.country')}</Label>
            <Select value={country} onValueChange={(v) => { setCountry(v); touch('country'); }}>
              <SelectTrigger id="nda-id-country" aria-invalid={!!show('country')}><SelectValue placeholder={t('ndaSign.f.choose')} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {countries.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {msg('country')}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="nda-id-number">{t('ndaSign.f.idNumber')}</Label>
          <Input id="nda-id-number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} onBlur={() => touch('idNumber')} maxLength={40}
            autoComplete="off" spellCheck={false} inputMode="text" dir="ltr" className="font-mono"
            aria-invalid={!!show('idNumber')} aria-describedby="nda-id-consent nda-idNumber-msg" />
          {msg('idNumber')}
          {preview && <p className="text-[11px] text-muted-foreground">{t('ndaSign.f.maskedPreview', { masked: preview })}</p>}
          <p id="nda-id-consent" className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span>{t('ndaSign.f.consent')} <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{t('ndaSign.f.privacyLink')}</Link></span>
          </p>
        </div>
      </fieldset>

      {/* (e) client signs for the company */}
      {p.party === 'client' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="nda-title">{t('ndaSign.f.jobTitle')}</Label>
            <Input id="nda-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => touch('title')} maxLength={80} autoComplete="organization-title" aria-invalid={!!show('title')} />
            {msg('title')}
          </div>
          <div className="space-y-1">
            <Label htmlFor="nda-company">{t('ndaSign.f.company')}</Label>
            <Input id="nda-company" value={company} onChange={(e) => setCompany(e.target.value)} onBlur={() => touch('company')} maxLength={160} autoComplete="organization" aria-invalid={!!show('company')} />
            {msg('company')}
          </div>
        </div>
      )}

      {/* (d) authorisation + agreement */}
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Checkbox id="nda-authorised" checked={authorised} onCheckedChange={(v) => { setAuthorised(v === true); touch('authorised'); }} />
          <label htmlFor="nda-authorised" className="cursor-pointer text-sm leading-snug">{t(p.party === 'client' ? 'ndaSign.f.authorisedClient' : 'ndaSign.f.authorised')}</label>
        </div>
        {msg('authorised')}
        <div className="flex items-start gap-2">
          <Checkbox id="nda-agreed" checked={agreed} onCheckedChange={(v) => { setAgreed(v === true); touch('agreed'); }} />
          <label htmlFor="nda-agreed" className="cursor-pointer text-sm leading-snug">{t('ndaSign.f.agreed')}</label>
        </div>
        {msg('agreed')}
      </div>

      {serverError && <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{serverError}</p>}

      <div className="space-y-2">
        {missing.length > 0 && !busy && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t('ndaSign.stillNeeded', { items: missing.map((f) => t(`ndaSign.field.${f}`)).join(lang === 'ar' ? '، ' : ', ') })}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {p.secondaryAction}
          {p.onCancel && <Button type="button" variant="outline" onClick={p.onCancel} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>}
          <Button type="submit" disabled={problems.length > 0 || busy} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? t('ndaSign.signing') : p.action === 'supplement' ? t('ndaSign.addDetailsButton') : t('ndaSign.signButton')}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('ndaSign.notQualified')}</p>
      </div>
    </form>
  );
}
