import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, History, IdCard, Loader2, Search, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNdaSigningSettings } from '@/hooks/useNdaSigning';
import { errorKey, fetchAdminAccessLog, fetchAdminSignatures, revealIdNumber, saveSigningSettings, type AdminNdaRow } from '@/lib/nda/api';

const fmt = (iso: string | null | undefined, lang: string) =>
  iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';

type Sig = AdminNdaRow['signatures'][number];

/** Admin "NDA signatures": status per party, masked IDs, settings, and the full ID number only with a logged reason. */
export default function NdaSignaturesPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const qc = useQueryClient();
  const settings = useNdaSigningSettings();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [reveal, setReveal] = useState<Sig | null>(null);
  const [logFor, setLogFor] = useState<Sig | null>(null);
  useEffect(() => { const h = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const list = useQuery({ queryKey: ['admin-nda-signatures', query], queryFn: () => fetchAdminSignatures(query), enabled: !!settings.data });
  if (settings.isLoading) return null;
  if (!settings.data) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="py-5 text-sm text-muted-foreground">{t('ndaSign.admin.notInstalled')}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsCard onSaved={() => qc.invalidateQueries({ queryKey: ['nda-signing-settings'] })} />
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><IdCard className="h-4 w-4 text-primary" aria-hidden /> {t('ndaSign.admin.title')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('ndaSign.admin.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ndaSign.admin.search')} className="ps-9 rounded-xl" aria-label={t('ndaSign.admin.search')} />
          </div>
          {list.isLoading ? <p className="text-sm text-muted-foreground">{t('ndaSign.loading')}</p>
            : list.isError ? <p className="text-sm text-destructive">{t('ndaSign.err.generic')}</p>
            : !list.data?.length ? <p className="text-sm text-muted-foreground">{t('ndaSign.admin.empty')}</p>
            : (
              <ul className="divide-y divide-border/60">
                {list.data.map((n) => (
                  <li key={n.nda_id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-foreground">{n.consultant_name}</span>
                      <span className="text-muted-foreground">↔</span>
                      <span className="font-medium text-foreground">{n.client_name}</span>
                      {n.revoked_at ? <Badge variant="destructive" className="text-[10px]">{t('ndaSign.page.revoked')}</Badge>
                        : n.client_signed_at ? <Badge variant="secondary" className="text-[10px]">{t('ndaSign.card.fully')}</Badge>
                        : <Badge variant="outline" className="text-[10px]">{t('ndaSign.card.waiting', { role: t('ndaSign.role.client') })}</Badge>}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {(['consultant', 'client'] as const).map((party) => {
                        const signedAt = party === 'consultant' ? n.consultant_signed_at : n.client_signed_at;
                        const sig = n.signatures.find((x) => x.party === party);
                        return (
                          <div key={party} className="rounded-xl border border-border/60 p-2.5 text-xs">
                            <p className="font-semibold text-foreground">{t(`ndaSign.role.${party}`)}</p>
                            {!signedAt ? <p className="text-muted-foreground">{t('ndaSign.card.notSigned')}</p>
                              : !sig ? <p className="text-muted-foreground">{t('ndaSign.card.legacy')} · {fmt(signedAt, lang)}</p>
                              : (
                                <div className="space-y-1">
                                  <p className="text-foreground">{sig.signer_name}{sig.job_title ? ` · ${sig.job_title}` : ''}{sig.company_name ? ` · ${sig.company_name}` : ''}</p>
                                  <p className="font-mono text-muted-foreground" dir="ltr">{t(`ndaSign.idType.${sig.id_type}`)} · {sig.id_country} · {sig.id_masked}</p>
                                  <p className="text-muted-foreground">{fmt(sig.signed_at, lang)} · {sig.method === 'typed' ? t('ndaSign.admin.typed') : t('ndaSign.admin.drawn')}{sig.kind === 'supplement' ? ` · ${t('ndaSign.card.detailsAddedLater')}` : ''}</p>
                                  <div className="flex flex-wrap gap-1.5 pt-1">
                                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={sig.anonymised} onClick={() => setReveal(sig)}>
                                      <Eye className="h-3 w-3" aria-hidden /> {sig.anonymised ? t('ndaSign.admin.anonymised') : t('ndaSign.admin.showFull')}
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setLogFor(sig)}>
                                      <History className="h-3 w-3" aria-hidden /> {t('ndaSign.admin.views', { count: sig.full_id_views })}
                                    </Button>
                                  </div>
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </CardContent>
      </Card>
      {reveal && <RevealDialog sig={reveal} onClose={() => { setReveal(null); void list.refetch(); }} />}
      {logFor && <AccessLogDialog sig={logFor} onClose={() => setLogFor(null)} />}
    </div>
  );
}

function SettingsCard({ onSaved }: { onSaved(): void }) {
  const { t } = useTranslation();
  const s = useNdaSigningSettings().data!;
  const [typed, setTyped] = useState(s.allow_typed_signature);
  const [ip, setIp] = useState(s.store_ip);
  const [years, setYears] = useState(String(s.id_retention_years));
  const [hours, setHours] = useState(String(s.reminder_hours));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const y = Number(years), h = Number(hours);
  const valid = Number.isInteger(y) && y >= 1 && y <= 30 && Number.isInteger(h) && h >= 24 && h <= 168 && reason.trim().length >= 3;
  const dirty = typed !== s.allow_typed_signature || ip !== s.store_ip || y !== s.id_retention_years || h !== s.reminder_hours;
  const save = async () => {
    setBusy(true);
    try {
      await saveSigningSettings({ allow_typed_signature: typed, store_ip: ip, id_retention_years: y, reminder_hours: h }, reason.trim());
      toast.success(t('ndaSign.admin.saved'));
      setReason('');
      onSaved();
    } catch { toast.error(t('ndaSign.err.generic')); }
    finally { setBusy(false); }
  };
  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-primary" aria-hidden /> {t('ndaSign.admin.settings')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div><Label htmlFor="nda-set-typed">{t('ndaSign.admin.allowTyped')}</Label><p className="text-xs text-muted-foreground">{t('ndaSign.admin.allowTypedHint')}</p></div>
          <Switch id="nda-set-typed" checked={typed} onCheckedChange={setTyped} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><Label htmlFor="nda-set-ip">{t('ndaSign.admin.storeIp')}</Label><p className="text-xs text-muted-foreground">{t('ndaSign.admin.storeIpHint')}</p></div>
          <Switch id="nda-set-ip" checked={ip} onCheckedChange={setIp} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="nda-set-years">{t('ndaSign.admin.retention')}</Label>
            <Input id="nda-set-years" type="number" min={1} max={30} value={years} onChange={(e) => setYears(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">{t('ndaSign.admin.retentionHint')}</p></div>
          <div className="space-y-1"><Label htmlFor="nda-set-hours">{t('ndaSign.admin.reminderHours')}</Label>
            <Input id="nda-set-hours" type="number" min={24} max={168} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        </div>
        {dirty && (
          <div className="space-y-1"><Label htmlFor="nda-set-reason">{t('ndaSign.admin.reason')}</Label>
            <Input id="nda-set-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
        )}
        <div className="flex justify-end"><Button onClick={save} busy={busy} disabled={!dirty || !valid}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden />}{t('ndaSign.admin.save')}</Button></div>
      </CardContent>
    </Card>
  );
}

function RevealDialog({ sig, onClose }: { sig: Sig; onClose(): void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the number disappears again after 60 seconds
  useEffect(() => { if (!value) return; const h = setTimeout(() => setValue(null), 60_000); return () => clearTimeout(h); }, [value]);
  const go = async () => {
    setBusy(true); setError(null);
    const r = await revealIdNumber(sig.signature_id, reason.trim());
    setBusy(false);
    if (r.ok) setValue(r.data.id_number); else setError(t(errorKey(r.code)));
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setValue(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ndaSign.admin.revealTitle')}</DialogTitle>
          <DialogDescription>{t('ndaSign.admin.revealIntro', { name: sig.signer_name })}</DialogDescription>
        </DialogHeader>
        {value ? (
          <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs text-muted-foreground">{t(`ndaSign.idType.${sig.id_type}`)} · {sig.id_country}</p>
            <p className="select-all font-mono text-lg text-foreground" dir="ltr">{value}</p>
            <p className="text-[11px] text-muted-foreground">{t('ndaSign.admin.revealHides')}</p>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setValue(null)}><EyeOff className="h-3.5 w-3.5" aria-hidden /> {t('ndaSign.admin.hide')}</Button>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="nda-reveal-reason">{t('ndaSign.admin.revealReason')}</Label>
            <Textarea id="nda-reveal-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
            <p className="text-[11px] text-muted-foreground">{t('ndaSign.admin.revealLogged')}</p>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setValue(null); onClose(); }}>{t('common.close', 'Close')}</Button>
          {!value && <Button onClick={go} busy={busy} disabled={reason.trim().length < 10}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden />}{t('ndaSign.admin.showFull')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccessLogDialog({ sig, onClose }: { sig: Sig; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const log = useQuery({ queryKey: ['nda-access-log', sig.signature_id], queryFn: () => fetchAdminAccessLog(sig.signature_id) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('ndaSign.admin.logTitle')}</DialogTitle><DialogDescription>{sig.signer_name}</DialogDescription></DialogHeader>
        {log.isLoading ? <p className="text-sm text-muted-foreground">{t('ndaSign.loading')}</p>
          : !log.data?.length ? <p className="text-sm text-muted-foreground">{t('ndaSign.admin.logEmpty')}</p>
          : <ul className="max-h-72 space-y-2 overflow-y-auto text-xs">{log.data.map((l, i) => (
              <li key={i} className="rounded-lg border border-border/60 p-2"><p className="font-medium text-foreground">{l.by} · {t(`ndaSign.admin.logRole.${l.role}`)} · {fmt(l.at, lang)}</p><p className="text-muted-foreground">{l.reason}</p></li>
            ))}</ul>}
      </DialogContent>
    </Dialog>
  );
}
