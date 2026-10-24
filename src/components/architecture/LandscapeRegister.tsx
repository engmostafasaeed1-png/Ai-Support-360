import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, Pencil, Plus, ShieldAlert, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTenant } from '@/contexts/TenantContext';
import { useLandscape } from '@/hooks/useArchitecture';
import { archiveLandscape, saveLandscape } from '@/lib/architecture/api';
import { HOSTING, LANDSCAPE_ROLES, LIMITS, landscapeProblems, type LandscapeSystem } from '../../../supabase/functions/_shared/archModel';

const EMPTY: LandscapeSystem = { name: '', sid: '', role: 'DEV', product: '', release: '', hosting: 'on_premise', notes: '' };

/** No-credentials warning shown wherever landscape data is entered. */
export function NoSecretsWarning() {
  const { t } = useTranslation();
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-foreground">
      <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <span>{t('arch.landscape.warning')}</span>
    </p>
  );
}

/** System landscape register: the company's SAP systems (no passwords or connection secrets), used as a picker. */
export default function LandscapeRegister({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const { data: rows, isLoading, error, refetch } = useLandscape(true);
  const [edit, setEdit] = useState<LandscapeSystem | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = edit ? landscapeProblems(edit) : [];
  const roleOrder = (r: string) => LANDSCAPE_ROLES.indexOf(r as never);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    const r = await saveLandscape(tenant?.id ?? null, { ...edit, sid: edit.sid.toUpperCase() });
    setBusy(false);
    if (r.error) { toast.error(/secret|password/i.test(r.error.message) ? t('arch.landscape.secret') : r.error.message); return; }
    toast.success(t('arch.landscape.saved'));
    setEdit(null);
    void qc.invalidateQueries({ queryKey: ['arch-landscape'] });
  };
  const archive = async (id: string) => {
    if (!window.confirm(t('arch.landscape.archiveConfirm'))) return;
    const r = await archiveLandscape(id, 'removed from register');
    if (r.error) { toast.error(r.error.message); return; }
    void qc.invalidateQueries({ queryKey: ['arch-landscape'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('arch.landscape.intro')}</p>
        {canEdit && <Button size="sm" className="gap-1" onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4" /> {t('arch.landscape.add')}</Button>}
      </div>
      <NoSecretsWarning />
      {isLoading ? <Skeleton className="h-40 rounded-2xl" /> : error ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-2">
          <p className="text-sm text-destructive" role="alert">{t('arch.list.error')}</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>{t('arch.common.retry')}</Button>
        </CardContent></Card>
      ) : !rows?.length ? (
        <Card className="rounded-2xl border-dashed"><CardContent className="p-8 text-center space-y-2">
          <Server className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('arch.landscape.empty')}</p>
          {canEdit && <Button size="sm" onClick={() => setEdit({ ...EMPTY })}>{t('arch.landscape.addFirst')}</Button>}
        </CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('arch.tabs.landscape')}</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-start p-2">{t('arch.landscape.name')}</th><th className="text-start p-2">SID</th>
                <th className="text-start p-2">{t('arch.landscape.role')}</th><th className="text-start p-2">{t('arch.landscape.product')}</th>
                <th className="text-start p-2">{t('arch.landscape.release')}</th><th className="text-start p-2">{t('arch.landscape.hosting')}</th>
                <th className="text-start p-2">{t('arch.landscape.notes')}</th>{canEdit && <th className="p-2"><span className="sr-only">{t('arch.common.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {[...rows].sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name)).map((s) => (
                <tr key={s.id} className="border-t border-border align-top">
                  <td className="p-2 font-medium">{s.name}</td><td className="p-2 font-mono">{s.sid || '—'}</td>
                  <td className="p-2"><Badge variant={s.role === 'PRD' ? 'default' : 'outline'} className="text-[10px]">{s.role}</Badge></td>
                  <td className="p-2">{s.product || '—'}</td><td className="p-2">{s.release || '—'}</td>
                  <td className="p-2">{t(`arch.hosting.${s.hosting}`)}</td>
                  <td className="p-2 max-w-64 text-xs text-muted-foreground whitespace-pre-wrap">{s.notes || '—'}</td>
                  {canEdit && (
                    <td className="p-2 whitespace-nowrap">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('arch.landscape.edit', { name: s.name })} onClick={() => setEdit({ ...s })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('arch.landscape.archive', { name: s.name })} onClick={() => void archive(s.id)}><Archive className="h-3.5 w-3.5" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{edit?.id ? t('arch.landscape.editTitle') : t('arch.landscape.add')}</DialogTitle>
            <DialogDescription>{t('arch.landscape.dialogHint')}</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NoSecretsWarning />
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="ls-name">{t('arch.landscape.name')} *</Label>
                <Input id="ls-name" value={edit.name} maxLength={LIMITS.landscapeName} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ls-sid">SID</Label>
                <Input id="ls-sid" value={edit.sid} maxLength={3} onChange={(e) => setEdit({ ...edit, sid: e.target.value.toUpperCase() })} aria-invalid={problems.includes('sid')} placeholder="PRD" />
                {problems.includes('sid') && <p className="text-[11px] text-destructive">{t('arch.landscape.sidRule')}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ls-role">{t('arch.landscape.role')}</Label>
                <Select value={edit.role} onValueChange={(v) => setEdit({ ...edit, role: v as LandscapeSystem['role'] })}>
                  <SelectTrigger id="ls-role"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANDSCAPE_ROLES.map((r) => <SelectItem key={r} value={r}>{t(`arch.roleName.${r}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ls-product">{t('arch.landscape.product')}</Label>
                <Input id="ls-product" value={edit.product} maxLength={120} onChange={(e) => setEdit({ ...edit, product: e.target.value })} placeholder="S/4HANA" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ls-release">{t('arch.landscape.release')}</Label>
                <Input id="ls-release" value={edit.release} maxLength={120} onChange={(e) => setEdit({ ...edit, release: e.target.value })} placeholder="2023 FPS02" />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="ls-hosting">{t('arch.landscape.hosting')}</Label>
                <Select value={edit.hosting} onValueChange={(v) => setEdit({ ...edit, hosting: v as LandscapeSystem['hosting'] })}>
                  <SelectTrigger id="ls-hosting"><SelectValue /></SelectTrigger>
                  <SelectContent>{HOSTING.map((h) => <SelectItem key={h} value={h}>{t(`arch.hosting.${h}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="ls-notes">{t('arch.landscape.notes')}</Label>
                <Textarea id="ls-notes" rows={3} value={edit.notes} maxLength={LIMITS.landscapeNotes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              </div>
              {problems.includes('secret') && <p className="sm:col-span-2 text-xs text-destructive" role="alert">{t('arch.landscape.secret')}</p>}
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel', 'Cancel')}</Button>
                <Button onClick={save} disabled={busy || problems.length > 0}>{t('arch.common.save')}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
