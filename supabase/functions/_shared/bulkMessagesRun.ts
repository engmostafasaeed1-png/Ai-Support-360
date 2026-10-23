/**
 * Feature R send worker core (no Deno or network code here, so tests can drive it). The edge function supplies the
 * dependencies; the database claim (bm_claim) already applied throttling, the kill switch and FOR UPDATE SKIP LOCKED.
 */
import {
  DEFAULTS, LIMITS, footerText, notificationType, pickText, pushMessage, renderVariables, telegramText, toPlainText, SITE, type Category,
} from './bulkMessaging.ts';

export interface ClaimRow {
  campaign_id: string;
  user_id: string;
  channel: 'in_app' | 'telegram' | 'push';
  lang: string | null;
  category: Category;
  popup: boolean;
  subject_en: string;
  subject_ar: string | null;
  body_en: string;
  body_ar: string | null;
  link_url: string | null;
  first_name: string | null;
  company: string | null;
  profile_completion: number | null;
  chat_id: number | null;
  attempts: number;
}

export interface FinishRow {
  campaign_id: string; user_id: string; channel: string; ok: boolean; error?: string; retry?: boolean;
  notification_id?: string; subject?: string; body?: string;
}

export interface WorkerDeps {
  claim: (max: number) => Promise<ClaimRow[]>;
  insertNotifications: (rows: Array<{ user_id: string; title: string; body: string; type: string; link: string }>) => Promise<Array<{ id: string; user_id: string }>>;
  sendTelegram: (chatId: number, text: string, link: string | null) => Promise<{ ok: boolean; blocked: boolean; error?: string }>;
  pauseTelegramLink: (userId: string, error: string) => Promise<void>;
  finish: (rows: FinishRow[]) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Campaigns created by the Refer & earn invitation (referral_invitation_runs); optional, empty when not installed. */
  referralCampaigns?: (ids: string[]) => Promise<Set<string>>;
  /** Web Push (docs/sql/notice-channels.sql): the recipients' active device subscriptions, sending and deactivating. */
  pushSubscriptions?: (userIds: string[]) => Promise<PushSub[]>;
  sendPush?: (sub: PushSub, payload: string) => Promise<{ ok: boolean; gone: boolean; error?: string }>;
  updatePushSubscription?: (id: string, outcome: { ok: boolean; gone: boolean; error?: string }) => Promise<void>;
}

export interface PushSub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

/** In-app notice of a Refer & earn invitation: type 'referral', straight to the programme tab (no token, no personal data). */
export const REFERRAL_INVITE_LINK = '/consultant/referrals?tab=programme&from=invite';

/** Channels whose click-throughs are counted (docs/sql/referral-invite-tracking.sql). */
export const INVITE_CLICK_CHANNELS = ['in_app', 'push', 'telegram', 'email'] as const;
export type InviteClickChannel = typeof INVITE_CLICK_CHANNELS[number];

/**
 * Invitation link tagged only with the channel it was sent on, so a signed-in click can be counted per channel.
 * Never a token, user id or e-mail address: the person is known from their own sign-in when they open the page.
 */
export function referralInviteLink(channel: InviteClickChannel): string {
  return `${REFERRAL_INVITE_LINK}&ch=${channel}`;
}

/** Text one recipient gets: their language, their variables, the standard footer. */
export function renderFor(row: ClaimRow) {
  const body = pickText(row.lang, row.body_en, row.body_ar);
  const lang = body.lang;
  const subject = lang === 'ar' && row.subject_ar?.trim() ? row.subject_ar : row.subject_en;
  const link = row.link_url ? (row.link_url.startsWith('/') ? `${SITE}${row.link_url}` : row.link_url) : null;
  const vars = { first_name: row.first_name, company: row.company, profile_completion: row.profile_completion, link: link ?? SITE };
  const subj = renderVariables(subject, vars, lang).slice(0, LIMITS.subject);
  const md = renderVariables(body.text, vars, lang);
  const footer = footerText(lang, row.category);
  const plain = toPlainText(md);
  return { lang, subject: subj, markdown: `${md}\n\n${footer}`, plain, footer, link };
}

export async function runBulkBatch(deps: WorkerDeps, budgetMs = 45_000): Promise<{ claimed: number; sent: number; failed: number }> {
  const started = deps.now();
  const rows = await deps.claim(DEFAULTS.maxClaimsPerRun);
  const results: FinishRow[] = [];
  const key = (r: { campaign_id: string; user_id: string }) => `${r.campaign_id}:${r.user_id}`;

  // Refer & earn invitation campaigns link straight to the programme tab, tagged with the channel (in-app, push, Telegram).
  let referral = new Set<string>();
  if (deps.referralCampaigns && rows.length) {
    try { referral = await deps.referralCampaigns([...new Set(rows.map((r) => r.campaign_id))]); } catch { referral = new Set(); }
  }

  // In-app: one insert for the batch; the notification links back to the full message.
  const inApp = rows.filter((r) => r.channel === 'in_app');
  if (inApp.length) {
    const rendered = new Map(inApp.map((r) => [key(r), renderFor(r)]));
    try {
      const created = await deps.insertNotifications(inApp.map((r) => {
        const m = rendered.get(key(r))!;
        const preview = m.plain.length > LIMITS.notificationBody ? `${m.plain.slice(0, LIMITS.notificationBody - 1)}…` : m.plain;
        return referral.has(r.campaign_id)
          ? { user_id: r.user_id, title: m.subject, body: preview, type: 'referral', link: referralInviteLink('in_app') }
          : { user_id: r.user_id, title: m.subject, body: preview, type: notificationType(r.category), link: `/notifications?broadcast=${r.campaign_id}` };
      }));
      const byUser = new Map<string, string[]>();
      for (const c of created) byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c.id]);
      for (const r of inApp) {
        const m = rendered.get(key(r))!;
        const id = byUser.get(r.user_id)?.shift();
        results.push(id
          ? { campaign_id: r.campaign_id, user_id: r.user_id, channel: 'in_app', ok: true, notification_id: id, subject: m.subject, body: m.markdown }
          : { campaign_id: r.campaign_id, user_id: r.user_id, channel: 'in_app', ok: false, error: 'not_stored', retry: true });
      }
    } catch {
      for (const r of inApp) results.push({ campaign_id: r.campaign_id, user_id: r.user_id, channel: 'in_app', ok: false, error: 'insert_failed', retry: true });
    }
  }

  // Telegram: one at a time, well below the platform limit; out of time = back to the queue.
  for (const r of rows.filter((x) => x.channel === 'telegram')) {
    if (deps.now() - started > budgetMs) {
      results.push({ campaign_id: r.campaign_id, user_id: r.user_id, channel: 'telegram', ok: false, error: 'deferred', retry: true });
      continue;
    }
    if (!r.chat_id) { results.push({ campaign_id: r.campaign_id, user_id: r.user_id, channel: 'telegram', ok: false, error: 'not_linked' }); continue; }
    const m = renderFor(r);
    let res: { ok: boolean; blocked: boolean; error?: string };
    try { res = await deps.sendTelegram(r.chat_id, telegramText(m.subject, m.plain, m.link, m.footer), m.link); }
    catch { res = { ok: false, blocked: false, error: 'network' }; }
    if (res.blocked) await deps.pauseTelegramLink(r.user_id, res.error ?? 'bot_blocked').catch(() => undefined);
    results.push(res.ok
      ? { campaign_id: r.campaign_id, user_id: r.user_id, channel: 'telegram', ok: true, subject: m.subject }
      : { campaign_id: r.campaign_id, user_id: r.user_id, channel: 'telegram', ok: false, error: res.error ?? 'failed', retry: !res.blocked });
    await deps.sleep(DEFAULTS.telegramGapMs);
  }

  // Web Push: every active device of the person; sent when at least one device accepted it. Dead devices are switched off.
  const push = rows.filter((r) => r.channel === 'push');
  if (push.length) {
    let subs: PushSub[] | null = null;
    if (deps.pushSubscriptions && deps.sendPush) {
      try { subs = await deps.pushSubscriptions([...new Set(push.map((r) => r.user_id))]); } catch { subs = null; }
    }
    for (const r of push) {
      const base = { campaign_id: r.campaign_id, user_id: r.user_id, channel: 'push' };
      if (!deps.sendPush || !deps.pushSubscriptions) { results.push({ ...base, ok: false, error: 'push_not_configured' }); continue; }
      if (subs === null) { results.push({ ...base, ok: false, error: 'subscriptions_failed', retry: true }); continue; }
      if (deps.now() - started > budgetMs) { results.push({ ...base, ok: false, error: 'deferred', retry: true }); continue; }
      const mine = subs.filter((s) => s.user_id === r.user_id);
      if (!mine.length) { results.push({ ...base, ok: false, error: 'push_not_enabled' }); continue; }
      const m = renderFor(r);
      const url = referral.has(r.campaign_id) ? referralInviteLink('push') : `/notifications?broadcast=${r.campaign_id}`;
      const payload = pushMessage(m.subject, m.plain, url, `bm-${r.campaign_id.slice(0, 8)}`, deps.now());
      let ok = false; let lastError = 'failed'; let retry = false;
      for (const sub of mine.slice(0, 5)) {
        let out: { ok: boolean; gone: boolean; error?: string };
        try { out = await deps.sendPush(sub, payload); } catch { out = { ok: false, gone: false, error: 'network' }; }
        if (deps.updatePushSubscription) await deps.updatePushSubscription(sub.id, out).catch(() => undefined);
        if (out.ok) ok = true; else { lastError = out.error ?? 'failed'; if (!out.gone) retry = true; }
      }
      results.push(ok ? { ...base, ok: true, subject: m.subject } : { ...base, ok: false, error: lastError, retry });
    }
  }

  if (results.length) await deps.finish(results);
  return { claimed: rows.length, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
