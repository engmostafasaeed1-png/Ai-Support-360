import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, Mail, Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  REFERRAL_BANNER_URL, REFERRAL_EMAIL_KINDS, renderReferralEmail, sampleReferralEmail, type ReferralEmailKind, type ReferralEmailSettings,
} from '../../../../supabase/functions/_shared/referralEmail';

export const EMAIL_KIND_LABEL: Record<ReferralEmailKind, string> = {
  signup: 'Colleague registered with your code', invited: 'You were invited (referred colleague)', passed_self: 'You passed the AI interview',
  passed_other: 'Partner passed the AI interview', active: 'Programme active', verified: 'Referral verified', reminder: 'Still pending (reminder)',
  ack_request: 'Accept the terms', expired: 'Referral expired', first_reward: 'First reward earned', reward_earned: 'Reward earned',
  reward_held: 'Reward on hold', reward_available: 'Reward available', reward_paid: 'Reward paid', reward_reversed: 'Reward reversed',
  referral_rejected: 'Referral not accepted', payout_details_changed: 'Bank details changed',
};

const SITE = 'https://www.aisupport360.com';

/**
 * Admin preview of every Refer & earn e-mail with sample data (masked sample names, sample amounts), EN/AR, light and a
 * simulated dark mode (colour inversion like mail apps), desktop/phone width and the plain-text part. Rendered by the same
 * shared layout the server sends. "Send test to me" goes ONLY to the signed-in admin's own address (server-side).
 */
export default function ReferralEmailPreview({ settings }: { settings: Partial<ReferralEmailSettings> }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ReferralEmailKind>('signup');
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const [dark, setDark] = useState(false);
  const [phone, setPhone] = useState(false);
  const [busy, setBusy] = useState(false);

  const mail = useMemo(() => renderReferralEmail({ ...sampleReferralEmail(kind, lang), settings, siteUrl: SITE, bannerUrl: REFERRAL_BANNER_URL }), [kind, lang, settings]);
  // Images are files of the published site; the preview loads the same files from this site so it works before publishing.
  const html = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : SITE;
    return mail.html.split(REFERRAL_BANNER_URL).join(`${origin}/email/referral-banner.png`).split(`${SITE}/icon-192.png`).join(`${origin}/icon-192.png`);
  }, [mail.html]);

  const sendTest = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('referral-email-test', { body: { kind, lang } });
      if (error || !data?.ok) {
        let msg = data?.error ?? data?.reason;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = (error as any)?.context;
        if (!msg && ctx?.json) { try { msg = (await ctx.json()).error; } catch { /* ignore */ } }
        toast.error(msg ? String(msg) : t('remail.test_failed', 'The test e-mail could not be sent.'));
      } else {
        toast.success(t('remail.test_sent', 'Test e-mail sent to your own address.'));
      }
    } finally { setBusy(false); }
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">{t('remail.title', 'Refer & earn e-mails - preview')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t('remail.intro', 'One shared design for every referral e-mail, with sample data. Numbers come from the live programme settings; the example is always labelled as an example. The invitation itself is not e-mailed (promotional bulk mail).')}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="space-y-1">
            <Label htmlFor="remail-kind">{t('remail.kind', 'E-mail')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ReferralEmailKind)}>
              <SelectTrigger id="remail-kind"><SelectValue /></SelectTrigger>
              <SelectContent>{REFERRAL_EMAIL_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`remail.k_${k}`, EMAIL_KIND_LABEL[k])}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium" id="remail-lang">{t('remail.lang', 'Language')}</span>
            <div className="flex gap-1" role="group" aria-labelledby="remail-lang">
              <Button size="sm" variant={lang === 'en' ? 'default' : 'outline'} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</Button>
              <Button size="sm" variant={lang === 'ar' ? 'default' : 'outline'} aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>العربية</Button>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium" id="remail-view">{t('remail.view', 'View')}</span>
            <div className="flex gap-1" role="group" aria-labelledby="remail-view">
              <Button size="icon" variant="outline" aria-pressed={dark} aria-label={dark ? t('remail.light', 'Light') : t('remail.dark', 'Dark (simulated)')} onClick={() => setDark((v) => !v)}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
              <Button size="icon" variant="outline" aria-pressed={phone} aria-label={phone ? t('remail.desktop', 'Desktop width') : t('remail.phone', 'Phone width')} onClick={() => setPhone((v) => !v)}>{phone ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}</Button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 p-3">
          <p className="text-xs text-muted-foreground">{t('remail.subject', 'Subject')}</p>
          <p className="font-medium" dir={lang === 'ar' ? 'rtl' : 'ltr'}>{mail.subject}</p>
          <p className="mt-1 text-xs text-muted-foreground" dir={lang === 'ar' ? 'rtl' : 'ltr'}>{mail.preheader}</p>
        </div>

        <Tabs defaultValue="html">
          <TabsList><TabsTrigger value="html">HTML</TabsTrigger><TabsTrigger value="text">{t('remail.text', 'Plain text')}</TabsTrigger></TabsList>
          <TabsContent value="html">
            <div className="flex justify-center overflow-x-auto rounded-xl border border-border/60 bg-muted/30 p-3">
              <iframe title={t('remail.frame', 'E-mail preview: {{name}}', { name: EMAIL_KIND_LABEL[kind] })} sandbox="" srcDoc={html}
                className="h-[760px] rounded-lg border-0 bg-card"
                style={{ width: phone ? 375 : 640, maxWidth: '100%', filter: dark ? 'invert(0.92) hue-rotate(180deg)' : undefined }} />
            </div>
            {dark && <p className="mt-1 text-xs text-muted-foreground">{t('remail.dark_note', 'Simulated dark mode: mail apps that invert colours show roughly this. The design keeps a white background and mid-tone colours so both stay readable.')}</p>}
          </TabsContent>
          <TabsContent value="text"><pre className="max-h-[760px] overflow-auto whitespace-pre-wrap rounded-xl border border-border/60 p-3 text-xs" dir={lang === 'ar' ? 'rtl' : 'ltr'}>{mail.text}</pre></TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void sendTest()} disabled={busy}>{busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Mail className="me-1 h-4 w-4" />}{t('remail.send_test', 'Send test to me')}</Button>
          <span className="text-xs text-muted-foreground">{t('remail.send_test_hint', 'Goes only to your own confirmed address, subject starts with [TEST]. 6 per hour.')}</span>
        </div>
      </CardContent>
    </Card>
  );
}
