import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { adminClient } from '../_shared/security.ts';
import { UUID, rememberNotification, deliverAdminNotification, type AdminMailClaim } from '../_shared/admin-notification-email.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const seen = new Map<string, number>();
const accepted = () => new Response(null, { status: 202, headers: corsHeaders });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return accepted();
  let id: string;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || typeof body.notification_id !== 'string' || !UUID.test(body.notification_id)) return accepted();
    id = body.notification_id.toLowerCase();
  } catch { return accepted(); }
  if (!rememberNotification(seen, id, Date.now())) return accepted();
  const task = async () => {
    const admin = adminClient();
    await deliverAdminNotification({
      claim: async () => {
        const { data, error } = await admin.rpc('claim_admin_notification_email', { _id: id });
        if (error) throw new Error('Email claim failed');
        return data as AdminMailClaim | null;
      },
      send: async (row) => {
        const { data, error } = await admin.auth.admin.getUserById(row.user_id);
        if (error || !data.user?.email) throw new Error('Recipient unavailable');
        return await sendTemplateEmail('admin-notification', data.user.email, {
          templateData: { title: row.title, body: row.body ?? '', link: row.link },
          idempotencyKey: `admin-notification-${row.id}`,
        });
      },
      finish: async (row, handled, errorText) => {
        const { error } = await admin.rpc('finish_admin_notification_email', { _id: row.id, _attempt: row.attempt, _handled: handled, _error: errorText });
        if (error) throw new Error('Email completion failed');
      },
      wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    });
  };
  // Immediate indistinguishable acknowledgement; sending never blocks notification inserts.
  EdgeRuntime.waitUntil(task().catch(() => { /* No recipient or notification details in public responses/logs. */ }));
  return accepted();
});