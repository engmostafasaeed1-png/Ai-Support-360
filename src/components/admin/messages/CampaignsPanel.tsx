import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban, ClipboardCopy, Download, Loader2, MessageSquare, Phone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import MessageBody from '@/components/messages/MessageBody';
import { footerText, pickText, renderVariables, smsLink, toPlainText, whatsappLink } from '@/lib/bulkMessaging';
import { useBulkActions, useCampaignReport, useCampaigns, useManualContacts, type Campaign, type ManualContact } from '@/hooks/useBulkMessaging';

const STATUS_VARIANT: Record<Campaign['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = { scheduled: 'outline', sending: 'default', sent: 'secondary', cancelled: 'destructive' };

export default function CampaignsPanel({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const q = useCampaigns(true);
  const open = (q.data ?? []).find((c) => c.id === openId) ?? null;
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(i18n.language) : '—');
  if (q.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
  if (!q.data?.length) return <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">{t('bmsg.no_campaigns', 'No messages sent yet.')}</CardContent></Card>;
  return (
    <>
      <ul className="space-y-2">
        {q.data.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onOpen(c.id)} className="w-full rounded-2xl border bg-card p-4 text-start shadow-sm transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{c.subject_en}</span>
                <Badge variant={STATUS_VARIANT[c.status]}>{t(`bmsg.status_${c.status}`, c.status)}</Badge>
                <Badge variant="outline">{c.category === 'marketing' ? t('bmsg.marketing_short', 'marketing') : t('bmsg.service_short', 'service')}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('bmsg.row_meta', '{{n}} people · {{ch}} · {{when}}', {
                n: c.recipient_count, ch: c.channels.filter((x) => x !== 'popup').map((x) => t(`bmsg.chs_${x}`, x)).join(', '),
                when: c.status === 'scheduled' ? t('bmsg.planned_for', 'planned for {{d}}', { d: fmt(c.scheduled_at) }) : fmt(c.started_at ?? c.created_at),
              })}</p>
            </button>
          </li>
        ))}
      </ul>
      <CampaignDialog campaign={open} onClose={() => onOpen(null)} />
    </>
  );
}

function CampaignDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const report = useCampaignReport(campaign?.id ?? null);
  const actions = useBulkActions();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  if (!campaign) return null;
  const hasManual = campaign.channels.some((c) => c === 'whatsapp_manual' || c === 'sms_manual');
  const active = campaign.status === 'scheduled' || campaign.status === 'sending';
  const statusLabel = (s: string) => t(`bmsg.rs_${s}`, s.replace('_', ' '));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campaign.subject_en}</DialogTitle>
          <DialogDescription>{t('bmsg.report_desc', '{{n}} people · {{excluded}} not included · {{status}}', { n: campaign.recipient_count, excluded: campaign.excluded_count, status: t(`bmsg.status_${campaign.status}`, campaign.status) })}</DialogDescription>
        </DialogHeader>
        <section className="space-y-2" aria-label={t('bmsg.delivery', 'Delivery')}>
          <h3 className="text-sm font-semibold">{t('bmsg.delivery', 'Delivery')}</h3>
          {report.isLoading ? <Skeleton className="h-16" /> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(report.data?.by_channel ?? {}).map(([ch, s]) => (
                <div key={ch} className="rounded-xl border p-3 text-sm">
                  <p className="font-medium">{t(`bmsg.chs_${ch}`, ch)}</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{Object.entries(s).map(([k, n]) => <li key={k}>{statusLabel(k)}: <span className="font-medium text-foreground">{n}</span></li>)}</ul>
                  {ch === 'in_app' && <p className="mt-1 text-xs">{t('bmsg.read_n', 'Read: {{n}}', { n: report.data?.read ?? 0 })}</p>}
                </div>
              ))}
            </div>
          )}
          {Object.keys(report.data?.reasons ?? {}).length > 0 && (
            <p className="text-xs text-muted-foreground">{t('bmsg.reasons', 'Reasons')}: {Object.entries(report.data!.reasons).map(([k, n]) => `${t(`bmsg.why_${k}`, k.replace(/_/g, ' '))} ${n}`).join(' · ')}</p>
          )}
          <p className="text-[11px] text-muted-foreground">{t('bmsg.no_tracking', 'No tracking pixels are used: "Read" means the person opened the notification in the app.')}</p>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('bmsg.content', 'Message')}</h3>
          <div className="rounded-xl border p-3"><MessageBody text={campaign.body_en} /></div>
          {campaign.body_ar && <div className="rounded-xl border p-3"><MessageBody text={campaign.body_ar} lang="ar" /></div>}
        </section>
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">{t('bmsg.history', 'History')}</h3>
          <ol className="space-y-1 text-xs">{(report.data?.events ?? []).map((e, i) => (
            <li key={i}><span className="text-muted-foreground">{new Date(e.at).toLocaleString(i18n.language)}</span> · {t(`bmsg.ev_${e.action}`, e.action.replace(/_/g, ' '))}{e.actor ? ` · ${e.actor}` : ''}</li>
          ))}</ol>
        </section>
        <div className="flex flex-wrap gap-2">
          {hasManual && campaign.status !== 'cancelled' && <Button variant="outline" onClick={() => setManualOpen(true)}><Phone className="me-1 h-4 w-4" />{t('bmsg.manual_open', 'WhatsApp / SMS list')}</Button>}
          {active && <Button variant="destructive" onClick={() => setConfirmCancel(true)}><Ban className="me-1 h-4 w-4" />{campaign.status === 'scheduled' ? t('bmsg.cancel_scheduled', 'Cancel scheduled message') : t('bmsg.stop_sending', 'Stop sending')}</Button>}
        </div>
        {manualOpen && <ManualHelper campaign={campaign} onClose={() => setManualOpen(false)} />}
        <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>{t('bmsg.cancel_title', 'Stop this message?')}</AlertDialogTitle>
              <AlertDialogDescription>{t('bmsg.cancel_desc', 'Nobody else will get it. People who already got it keep it.')}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                try { const r = await actions.cancel.mutateAsync(campaign.id); toast.success(t('bmsg.cancelled_n', 'Stopped. {{n}} deliveries cancelled.', { n: r.stopped })); }
                catch (e) { toast.error((e as Error).message); }
              }}>{t('bmsg.stop', 'Stop')}</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** Click-to-send: opens the admin's own WhatsApp or SMS app with the text filled in. Phone numbers stay on this screen. */
function ManualHelper({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { t } = useTranslation();
  const contacts = useManualContacts(campaign.id, true);
  const actions = useBulkActions();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const textFor = (c: ManualContact) => {
    const picked = pickText(c.lang, campaign.body_en, campaign.body_ar);
    const subject = picked.lang === 'ar' && campaign.subject_ar ? campaign.subject_ar : campaign.subject_en;
    const vars = { first_name: c.first_name, company: c.company, link: campaign.link_url ? new URL(campaign.link_url, 'https://www.aisupport360.com').href : undefined };
    return `${renderVariables(subject, vars, picked.lang)}\n\n${toPlainText(renderVariables(picked.text, vars, picked.lang))}\n\n${footerText(picked.lang, campaign.category)}`;
  };
  const key = (c: ManualContact) => `${c.user_id}:${c.channel}`;
  const isSent = (c: ManualContact) => done[key(c)] ?? c.status === 'manual_sent';
  const mark = async (c: ManualContact, sent: boolean) => {
    setDone((d) => ({ ...d, [key(c)]: sent }));
    try { await actions.markManual(campaign.id, c.user_id, c.channel, sent); }
    catch (e) { setDone((d) => ({ ...d, [key(c)]: !sent })); toast.error((e as Error).message); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t('bmsg.copied', 'Message copied')); } catch { toast.error(t('bmsg.copy_failed', 'Could not copy')); } };
  const exportCsv = async () => {
    const rows = (contacts.data ?? []).filter((c) => c.phone);
    try { await actions.logExport(campaign.id, rows.length); } catch (e) { toast.error((e as Error).message); return; }
    const cell = (v: string) => `"${String(v).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const csv = ['name,phone,channel,status', ...rows.map((c) => [c.display_name, c.phone ?? '', c.channel === 'sms_manual' ? 'SMS' : 'WhatsApp', isSent(c) ? 'sent' : 'pending'].map(cell).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `message-numbers-${campaign.id.slice(0, 8)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('bmsg.manual_title', 'Send by WhatsApp or SMS yourself')}</DialogTitle>
          <DialogDescription>{t('bmsg.manual_desc', 'Each button opens your own app with the text filled in. Tick a person once you have sent it. Numbers are for admins only; opening this list is recorded.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copy(textFor({ lang: 'en', first_name: '', company: '' } as ManualContact))}><ClipboardCopy className="me-1 h-4 w-4" />{t('bmsg.copy_message', 'Copy message')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!contacts.data?.length}><Download className="me-1 h-4 w-4" />{t('bmsg.export_numbers', 'Numbers as CSV')}</Button>
        </div>
        {contacts.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : contacts.error ? <p className="text-sm text-destructive">{(contacts.error as Error).message}</p> : (
          <ul className="divide-y rounded-xl border">
            {(contacts.data ?? []).map((c) => {
              const text = textFor(c);
              const href = c.phone ? (c.channel === 'sms_manual' ? smsLink(c.phone, text) : whatsappLink(c.phone, text)) : null;
              return (
                <li key={key(c)} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Checkbox checked={isSent(c)} onCheckedChange={(v) => mark(c, !!v)} aria-label={t('bmsg.mark_sent_x', 'Mark sent to {{name}}', { name: c.display_name })} />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.display_name}</p><p className="font-mono text-xs text-muted-foreground" dir="ltr">{c.phone ?? '—'}</p></div>
                  {href ? (
                    <Button asChild size="sm" variant={isSent(c) ? 'outline' : 'default'}>
                      <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => !isSent(c) && mark(c, true)}>
                        {c.channel === 'sms_manual' ? <><MessageSquare className="me-1 h-4 w-4" />{t('bmsg.open_sms', 'Open SMS')}</> : <><Phone className="me-1 h-4 w-4" />{t('bmsg.open_whatsapp', 'Open WhatsApp')}</>}
                      </a>
                    </Button>
                  ) : <Badge variant="outline">{t('bmsg.bad_number', 'Number not usable')}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => copy(text)} aria-label={t('bmsg.copy_for', 'Copy text for {{name}}', { name: c.display_name })}><ClipboardCopy className="h-4 w-4" /></Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
