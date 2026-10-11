// E-mails the consultants who were alerted about a critical request. The alarm and the in-app notice are made by the database;
// this is the e-mail channel. The client who owns the ticket (or an administrator) calls it right after the request is created or changed.
//   { ticket_id } -> one e-mail per alerted consultant and version of the request: the first alert, and again after an extension.
// Nobody is e-mailed after the reply window, after a reply, after "not for me", or once a consultant is assigned.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECIPIENTS = 300;
const PARALLEL = 6;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const ticketId = String(body?.ticket_id ?? '');
  if (!UUID_RE.test(ticketId)) return jsonResponse(req, { error: 'ticket_id is required' }, 400);

  const admin = adminClient();
  const { data: ticket } = await admin.from('tickets')
    .select('id, client_id, title, sap_modules, status, consultant_id, critical_response, critical_surcharge_percent, critical_due_at, critical_extensions')
    .eq('id', ticketId).maybeSingle();
  // the same answer for a ticket that does not exist, is not a critical request or belongs to somebody else
  if (!ticket || !ticket.critical_response) return jsonResponse(req, { error: 'Not found' }, 404);
  if (ticket.client_id !== user.id && !hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Not found' }, 404);

  const due = new Date(ticket.critical_due_at).getTime();
  if (!Number.isFinite(due) || due <= Date.now() || ticket.consultant_id || ['resolved', 'closed', 'cancelled'].includes(String(ticket.status))) {
    return jsonResponse(req, { sent: 0, skipped: 0, reason: 'closed' });
  }
  if (!(await withinRateLimit(admin, `critical-alert-email:${user.id}`, 20, 3600, true))) return jsonResponse(req, { error: 'Too many requests' }, 429);

  const version = Number(ticket.critical_extensions ?? 0);
  const [alertsRes, repliesRes] = await Promise.all([
    admin.from('critical_alerts').select('id, consultant_id, user_id, emailed_ext').eq('ticket_id', ticketId).is('dismissed_at', null).limit(MAX_RECIPIENTS),
    admin.from('critical_replies').select('consultant_id').eq('ticket_id', ticketId),
  ]);
  const replied = new Set((repliesRes.data ?? []).map((r: any) => r.consultant_id));
  const queue: any[] = (alertsRes.data ?? []).filter((a: any) => !replied.has(a.consultant_id) && (a.emailed_ext === null || a.emailed_ext < version));

  const minutesLeft = Math.max(1, Math.ceil((due - Date.now()) / 60_000));
  const until = `${new Date(due).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
  const areas = ((ticket.sap_modules as string[] | null) ?? []).join(', ').slice(0, 160) || 'SAP';
  const percent = Number(ticket.critical_surcharge_percent ?? 0);
  let sent = 0;
  let skipped = 0;

  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(a.user_id);
        const email = u?.user?.email;
        if (!email) { skipped++; continue; }
        const { data: p } = await admin.from('profiles').select('display_name').eq('user_id', a.user_id).maybeSingle();
        const res = await sendTemplateEmail('critical-request-alert', email, {
          templateData: {
            name: p?.display_name || undefined,
            title: String(ticket.title ?? '').slice(0, 160),
            areas,
            minutes: minutesLeft,
            percent,
            until,
            updated: version > 0,
            url: `${SITE_URL}/consultant/open-tickets?critical=${ticketId}`,
          },
          idempotencyKey: `critical-${ticketId}-${a.consultant_id}-${version}`,
        });
        // a suppressed address is not tried again; a switched-off e-mail service is (the window is still open)
        if (res.sent || res.reason === 'recipient_suppressed') {
          await admin.from('critical_alerts').update({ emailed_at: new Date().toISOString(), emailed_ext: version }).eq('id', a.id);
        }
        if (res.sent) sent++; else skipped++;
      } catch (e) {
        console.error('critical alert e-mail failed', a.consultant_id, e instanceof Error ? e.message : String(e));
        skipped++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, () => worker()));

  return jsonResponse(req, { sent, skipped });
});
