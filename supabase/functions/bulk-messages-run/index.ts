// Feature R: admin bulk message worker, called every minute by the schedule (and safe to be called by anyone).
// Credential-free like the other sweeps (verify_jwt=false, POST only). Safety lives in the service-only bm_claim RPC
// (kill switch, per-minute budgets per channel, FOR UPDATE SKIP LOCKED, max 300 per run) and bm_finish; this function only
// renders and delivers what was claimed, then answers counts. No names, numbers or message text in responses or logs.
// Channels sent here: in-app notifications and Telegram. E-mail is never used for bulk messages.
import { adminClient, jsonResponse, preflight } from '../_shared/security.ts';
import { sendTelegram } from '../_shared/telegram.ts';
import { runBulkBatch } from '../_shared/bulkMessagesRun.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  try {
    const counts = await runBulkBatch({
      claim: async (max) => {
        const { data, error } = await admin.rpc('bm_claim', { _max: max });
        if (error) throw new Error('claim failed');
        return data ?? [];
      },
      insertNotifications: async (rows) => {
        const { data, error } = await admin.from('notifications').insert(rows).select('id, user_id');
        if (error) throw new Error('insert failed');
        return data ?? [];
      },
      sendTelegram: async (chatId, text, link) => {
        if (!token) return { ok: false, blocked: false, error: 'bot_not_configured' };
        return await sendTelegram(token, chatId, {
          text,
          reply_markup: link ? { inline_keyboard: [[{ text: 'Open', url: link }]] } : undefined,
        });
      },
      pauseTelegramLink: async (userId, error) => {
        await admin.from('telegram_links').update({ active: false, last_error: error.slice(0, 60), last_error_at: new Date().toISOString() }).eq('user_id', userId);
      },
      finish: async (rows) => {
        const { error } = await admin.rpc('bm_finish', { _results: rows });
        if (error) throw new Error('finish failed');
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
    });
    return jsonResponse(req, { ok: true, ...counts }, 202);
  } catch {
    console.error('bulk messages run failed');
    return jsonResponse(req, { ok: false, claimed: 0, sent: 0, failed: 0 }, 500);
  }
});
