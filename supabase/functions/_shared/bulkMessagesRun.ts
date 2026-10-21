/**
 * Feature R send worker core (no Deno or network code here, so tests can drive it). The edge function supplies the
 * dependencies; the database claim (bm_claim) already applied throttling, the kill switch and FOR UPDATE SKIP LOCKED.
 */
import {
  DEFAULTS, LIMITS, footerText, notificationType, pickText, renderVariables, telegramText, toPlainText, SITE, type Category,
} from './bulkMessaging.ts';

export interface ClaimRow {
  campaign_id: string;
  user_id: string;
  channel: 'in_app' | 'telegram';
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

  // In-app: one insert for the batch; the notification links back to the full message.
  const inApp = rows.filter((r) => r.channel === 'in_app');
  if (inApp.length) {
    const rendered = new Map(inApp.map((r) => [key(r), renderFor(r)]));
    try {
      const created = await deps.insertNotifications(inApp.map((r) => {
        const m = rendered.get(key(r))!;
        const preview = m.plain.length > LIMITS.notificationBody ? `${m.plain.slice(0, LIMITS.notificationBody - 1)}…` : m.plain;
        return { user_id: r.user_id, title: m.subject, body: preview, type: notificationType(r.category), link: `/notifications?broadcast=${r.campaign_id}` };
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

  if (results.length) await deps.finish(results);
  return { claimed: rows.length, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
