import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { payoutApprovalData, payoutApprovalKey } from '../_shared/payout-approval.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse(req, { error: 'Invalid request' }, 400); }
  const id = body && typeof body === 'object' && 'payout_id' in body ? body.payout_id : null;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return jsonResponse(req, { error: 'A valid payout ID is required' }, 400);
  }
  if (!(await withinRateLimit(admin, `payout-approved:${user.id}`, 60, 3600))) return jsonResponse(req, { error: 'Too many requests' }, 429);
  try {
    const { data: payout, error } = await admin.from('payouts')
      .select('id, consultant_id, amount, currency, status, due_by, paid_at, processed_by').eq('id', id).maybeSingle();
    if (error) throw new Error('Could not load the payout');
    if (!payout || payout.processed_by !== user.id) return jsonResponse(req, { error: 'Not found' }, 404);
    const details = payoutApprovalData(payout);
    if (!details) return jsonResponse(req, { sent: false, reason: 'not_approved' });
    const { data: consultant, error: consultantError } = await admin.from('consultants').select('user_id').eq('id', payout.consultant_id).single();
    if (consultantError || !consultant) throw new Error('Could not find the consultant');
    const { data: recipient, error: recipientError } = await admin.auth.admin.getUserById(consultant.user_id);
    if (recipientError || !recipient?.user?.email) throw new Error('The consultant has no email address');
    const { data: profile } = await admin.from('profiles').select('display_name').eq('user_id', consultant.user_id).maybeSingle();
    const result = await sendTemplateEmail('payout-approved', recipient.user.email, {
      templateData: { ...details, name: profile?.display_name || undefined },
      idempotencyKey: payoutApprovalKey(payout.id),
    });
    return jsonResponse(req, result);
  } catch {
    return jsonResponse(req, { error: 'The payout email could not be sent' }, 502);
  }
});