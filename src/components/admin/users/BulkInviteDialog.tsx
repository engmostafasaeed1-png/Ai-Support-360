import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BULK_LIMIT, parseInviteList } from '@/lib/userAdmin';
import { callEdge, useInvalidateUsers } from '@/hooks/useUserAdmin';

interface DryRun { valid: string[]; invalid: string[]; duplicates: string[]; existing: string[] }
interface Sent { sent: string[]; suppressed: string[]; failed: string[]; rate_limited: string[] }

/** Invite many people by pasted list or CSV file: preview, validation, de-duplication, existing accounts skipped. */
export default function BulkInviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateUsers();
  const [text, setText] = useState('');
  const [role, setRole] = useState<'client' | 'consultant'>('client');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [check, setCheck] = useState<DryRun | null>(null);
  const [result, setResult] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseInviteList(text, { role, language }), [text, role, language]);

  const reset = () => { setText(''); setCheck(null); setResult(null); };
  const ready = check ? parsed.rows.filter((r) => check.valid.includes(r.email)) : [];

  const preview = async () => {
    setBusy(true);
    try { setCheck(await callEdge<DryRun>('admin-send-invitation', { invites: parsed.rows, dry_run: true })); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try { setResult(await callEdge<Sent>('admin-send-invitation', { invites: ready, dry_run: false })); invalidate(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('um.invite_many', 'Invite people')}</DialogTitle>
          <DialogDescription>{t('um.invite_many_desc', 'Paste e-mails (one per line) or upload a CSV: email, name, role, language. Up to {{n}} per run.', { n: BULK_LIMIT })}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p>{t('um.invites_sent', '{{n}} invitations sent.', { n: result.sent.length })}</p>
            {result.suppressed.length > 0 && <p className="text-muted-foreground">{t('um.invites_suppressed', '{{n}} not sent: e-mails to these addresses are blocked.', { n: result.suppressed.length })}</p>}
            {result.rate_limited.length > 0 && <p className="text-destructive">{t('um.invites_limited', '{{n}} not sent: hourly limit reached. Try again later.', { n: result.rate_limited.length })}</p>}
            {result.failed.length > 0 && <p className="text-destructive">{t('um.invites_failed', '{{n}} failed: {{list}}', { n: result.failed.length, list: result.failed.join(', ') })}</p>}
            <DialogFooter><Button onClick={() => { reset(); onOpenChange(false); }}>{t('um.done', 'Done')}</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t('um.default_role', 'Default role')}</Label>
                <Select value={role} onValueChange={(v) => { setRole(v as typeof role); setCheck(null); }}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="client">{t('um.role_client', 'Client')}</SelectItem><SelectItem value="consultant">{t('um.role_consultant', 'Consultant')}</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>{t('um.email_language', 'E-mail language')}</Label>
                <Select value={language} onValueChange={(v) => { setLanguage(v as typeof language); setCheck(null); }}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="um-invite-list">{t('um.invite_list', 'People')}</Label>
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary">
                  <Upload className="h-3.5 w-3.5" />{t('um.upload_csv', 'Upload CSV')}
                  <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f && f.size < 200_000) { setText(await f.text()); setCheck(null); } e.target.value = ''; }} />
                </label>
              </div>
              <Textarea id="um-invite-list" rows={7} dir="ltr" value={text} onChange={(e) => { setText(e.target.value); setCheck(null); }} placeholder={'sara@example.com, Sara, consultant, ar\nomar@example.com'} />
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t('um.invite_counts', '{{v}} valid · {{i}} invalid · {{d}} duplicates', { v: parsed.rows.length, i: parsed.invalid.length, d: parsed.duplicates.length })}
                {parsed.overLimit > 0 && ` · ${t('um.over_limit', '{{n}} over the limit', { n: parsed.overLimit })}`}
              </p>
              {parsed.invalid.length > 0 && <p className="text-xs text-destructive">{t('um.invalid_list', 'Not valid')}: {parsed.invalid.slice(0, 5).join(', ')}{parsed.invalid.length > 5 ? '…' : ''}</p>}
            </div>
            {check && (
              <div className="rounded-xl bg-muted p-3 text-xs" aria-live="polite">
                <p className="font-medium">{t('um.will_invite', '{{n}} will be invited.', { n: ready.length })}</p>
                {check.existing.length > 0 && <p>{t('um.already_accounts', 'Skipped, already have an account')}: {check.existing.slice(0, 5).join(', ')}{check.existing.length > 5 ? '…' : ''}</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
              {check ? <Button disabled={busy || !ready.length} onClick={send}>{t('um.send_n', 'Send {{n}} invitations', { n: ready.length })}</Button>
                : <Button disabled={busy || !parsed.rows.length} onClick={preview}>{t('um.preview', 'Preview')}</Button>}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
