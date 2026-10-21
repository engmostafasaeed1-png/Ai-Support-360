// Admin-only user management actions that need the sign-in service (service role):
// list (legacy fallback), roles (legacy fallback), suspend/reactivate (optional end date), force sign-out,
// password reset, resend verification, reset two-step sign-in, soft delete / restore / anonymise / permanent delete,
// merge / unmerge duplicates, bulk suspend / reactivate with dry run and undo.
// Every action checks the caller's permission, is rate limited per admin and is recorded with actor, target,
// before, after and reason (um_record_state in docs/sql/user-management.sql; a plain audit row when that file is not applied yet).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';

const ROLES = ['client', 'consultant', 'admin', 'super_admin'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOREVER = '876000h';
const SUPER_ONLY = new Set(['admins.manage', 'users.merge', 'users.mfa_reset', 'users.anonymise', 'users.hard_delete']);
const ACTION_PERMISSION: Record<string, string> = {
  set_roles: 'users.roles', update_name: 'users.edit', suspend: 'users.suspend', reactivate: 'users.suspend',
  force_sign_out: 'users.sessions', password_reset: 'users.edit', resend_verification: 'users.edit',
  mfa_reset: 'users.mfa_reset', soft_delete: 'users.delete', restore: 'users.delete', anonymise: 'users.anonymise',
  delete: 'users.hard_delete', merge: 'users.merge', unmerge: 'users.merge',
};
const REASON_REQUIRED = new Set(['suspend', 'force_sign_out', 'mfa_reset', 'soft_delete', 'anonymise', 'delete', 'merge']);

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// deno-lint-ignore no-explicit-any
type Admin = any;

const missingFn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /Could not find the function|does not exist/i.test(e.message ?? ''));

async function can(admin: Admin, uid: string, roles: string[], perm: string): Promise<boolean> {
  const { data, error } = await admin.rpc('admin_can', { _uid: uid, _perm: perm });
  if (!error) return data === true;
  if (!missingFn(error)) throw error;
  // Database update not applied yet: super-only actions need super admin; everything else the admin role.
  return SUPER_ONLY.has(perm) ? roles.includes('super_admin') : hasAnyRole(roles, ADMIN_ROLES);
}

async function record(admin: Admin, actor: string, target: string, action: string, payload: Record<string, unknown>, reason: string | null) {
  const { error } = await admin.rpc('um_record_state', { _actor: actor, _target: target, _action: action, _payload: payload, _reason: reason });
  if (!error) return;
  if (!missingFn(error)) throw new HttpError(400, error.message);
  await admin.from('audit_logs').insert({
    user_id: actor, action: `admin_user_${action}`, entity_type: 'user', entity_id: target,
    metadata: { ...payload, ...(reason ? { reason } : {}) },
  }).then(() => {}, () => {});
}

async function revokeSessions(admin: Admin, userId: string) {
  const { error } = await admin.rpc('um_revoke_sessions', { _uid: userId });
  if (error && !missingFn(error)) throw error;
}

async function lastSuperAdmin(admin: Admin, userId: string, roles: string[]) {
  if (!roles.includes('super_admin')) return false;
  const { count } = await admin.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'super_admin');
  return (count ?? 0) <= 1;
}

async function stateOf(admin: Admin, userId: string) {
  const { data, error } = await admin.from('user_admin_state').select('deleted_at, anonymised_at, anonymise_after, merged_into').eq('user_id', userId).maybeSingle();
  if (error) return { installed: false, row: null as null | Record<string, string | null> };
  return { installed: true, row: data as null | Record<string, string | null> };
}

function banDuration(until: unknown): { duration: string; until: string | null } {
  if (!until) return { duration: FOREVER, until: null };
  const t = Date.parse(String(until));
  const hours = Math.ceil((t - Date.now()) / 3_600_000);
  if (!Number.isFinite(t) || hours < 1) throw new HttpError(400, 'The end date must be in the future');
  if (hours > 24 * 366 * 5) throw new HttpError(400, 'The end date must be within 5 years');
  return { duration: `${hours}h`, until: new Date(t).toISOString() };
}

async function listUsers(admin: Admin, callerId: string) {
  // deno-lint-ignore no-explicit-any
  const users: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  const ids = users.map((u) => u.id);
  const [{ data: profiles }, { data: roles }, { data: clientRows }, { data: consultants }] = await Promise.all([
    admin.from('profiles').select('user_id, display_name, avatar_url, phone').in('user_id', ids),
    admin.from('user_roles').select('user_id, role').in('user_id', ids),
    admin.from('client_profiles').select('user_id, approval_status, company_name, country').in('user_id', ids),
    admin.from('consultants').select('id, user_id, verification_status, ai_interview_badge, country').in('user_id', ids),
  ]);
  // deno-lint-ignore no-explicit-any
  const by = (rows: any[] | null) => new Map((rows ?? []).map((r: any) => [r.user_id, r]));
  const pMap = by(profiles), cMap = by(clientRows), kMap = by(consultants);
  const rMap = new Map<string, string[]>();
  // deno-lint-ignore no-explicit-any
  (roles ?? []).forEach((r: any) => rMap.set(r.user_id, [...(rMap.get(r.user_id) ?? []), r.role]));
  return users.map((u) => {
    const banned = u.banned_until && new Date(u.banned_until) > new Date();
    // deno-lint-ignore no-explicit-any
    const p: any = pMap.get(u.id) ?? {}, c: any = cMap.get(u.id) ?? {}, k: any = kMap.get(u.id) ?? null;
    return {
      id: u.id, email: u.email ?? '', name: p.display_name || u.user_metadata?.full_name || '', phone: p.phone ?? null,
      avatar_url: p.avatar_url ?? null, roles: (rMap.get(u.id) ?? []).sort(),
      created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null, last_active_at: u.last_sign_in_at ?? null,
      status: banned ? 'suspended' : u.email_confirmed_at ? 'active' : u.invited_at ? 'invited' : 'pending',
      // deno-lint-ignore no-explicit-any
      providers: [...new Set([...(u.app_metadata?.providers ?? []), ...(u.identities ?? []).map((i: any) => i.provider)].map(String))],
      email_verified: !!u.email_confirmed_at,
      // deno-lint-ignore no-explicit-any
      mfa_enabled: (u.factors ?? []).some((f: any) => f.status === 'verified'),
      country: k?.country || c.country || null, company: c.company_name ?? null, organisations: [],
      consultant_id: k?.id ?? null, verification_status: k?.verification_status ?? null, badge: k?.ai_interview_badge ?? null,
      founding: null, policy_ok: null, completion: null, open_tickets: null, payout_ready: null,
      client_approval: c.approval_status ?? null, tags: [], is_self: u.id === callerId,
    };
  });
}

/**
 * The sign-in service limits how often e-mails (verification, password reset) can be sent to one address.
 * That is an expected wait, not a server failure, so it becomes a 429 with a plain message.
 */
function authRateLimitMessage(e: unknown): string | null {
  // deno-lint-ignore no-explicit-any
  const err = e as any;
  const msg = String(err?.message ?? '');
  const code = String(err?.code ?? '');
  const limited = err?.status === 429 || /rate_limit/.test(code) || /for security purposes|rate limit/i.test(msg);
  if (!limited) return null;
  const secs = msg.match(/after (\d+) seconds?/i)?.[1];
  return secs
    ? `An e-mail was sent to this person moments ago. Please wait ${secs} seconds before sending another.`
    : 'Too many e-mails were sent to this person recently. Please wait a minute and try again.';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  const callerRoles = await getUserRoles(admin, caller.id);
  if (!hasAnyRole(callerRoles, ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
  const isSuper = callerRoles.includes('super_admin');

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || '');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

  try {
    if (!(await withinRateLimit(admin, `um-edge:${caller.id}`, 300, 3600))) {
      return jsonResponse(req, { error: 'Too many admin actions in the last hour. Please try again later.' }, 429);
    }

    if (action === 'list') {
      if (!(await can(admin, caller.id, callerRoles, 'users.read'))) throw new HttpError(403, 'Forbidden');
      return jsonResponse(req, { users: await listUsers(admin, caller.id) });
    }

    if (action === 'bulk_suspend' || action === 'bulk_reactivate' || action === 'bulk_undo') {
      return jsonResponse(req, await bulk(admin, caller.id, callerRoles, action, body, reason));
    }

    const perm = ACTION_PERMISSION[action];
    if (!perm) return jsonResponse(req, { error: 'Unknown action' }, 400);
    if (!(await can(admin, caller.id, callerRoles, perm))) throw new HttpError(403, 'You do not have permission for this action');
    if (REASON_REQUIRED.has(action) && reason.length < 5) throw new HttpError(400, 'Please give a reason (at least 5 characters)');

    const userId = String(body.user_id || '');
    if (!UUID_RE.test(userId)) return jsonResponse(req, { error: 'Valid user is required' }, 400);
    const targetRoles = await getUserRoles(admin, userId);
    const self = userId === caller.id;
    if (targetRoles.includes('super_admin') && !isSuper) throw new HttpError(403, 'Only a super admin can change a super admin');
    if (self && !['password_reset', 'resend_verification'].includes(action)) throw new HttpError(400, 'You cannot do this to your own account');

    switch (action) {
      case 'set_roles': {
        // Used only before the database update is applied; afterwards the console calls admin_user_action directly.
        const next: string[] = Array.isArray(body.roles) ? [...new Set(body.roles.map(String))].sort() as string[] : [];
        if (next.some((r) => !ROLES.includes(r))) throw new HttpError(400, 'Unknown role');
        const toAdd = next.filter((r) => !targetRoles.includes(r));
        const toRemove = targetRoles.filter((r) => !next.includes(r));
        const adminLevel = [...toAdd, ...toRemove].some((r) => ADMIN_ROLES.includes(r));
        if (adminLevel && !isSuper) throw new HttpError(403, 'Only a super admin can grant or remove admin and super admin roles');
        if (adminLevel && reason.length < 5) throw new HttpError(400, 'Please give a reason (at least 5 characters)');
        if (toRemove.includes('super_admin') && (await lastSuperAdmin(admin, userId, targetRoles))) throw new HttpError(400, 'The last super admin cannot be removed');
        if (toRemove.length) {
          const { error } = await admin.from('user_roles').delete().eq('user_id', userId).in('role', toRemove);
          if (error) throw error;
        }
        if (toAdd.length) {
          const { error } = await admin.from('user_roles').insert(toAdd.map((role) => ({ user_id: userId, role })));
          if (error) throw error;
        }
        await admin.from('audit_logs').insert({ user_id: caller.id, action: 'admin_user.set_roles', entity_type: 'admin_user', entity_id: userId,
          metadata: { before: { roles: targetRoles }, after: { roles: next }, ...(reason ? { reason } : {}) } }).then(() => {}, () => {});
        break;
      }
      case 'update_name': {
        const name = String(body.name || '').trim().slice(0, 80);
        if (!name) throw new HttpError(400, 'Name is required');
        const { data: before } = await admin.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
        const { error } = await admin.from('profiles').update({ display_name: name }).eq('user_id', userId);
        if (error) throw error;
        await admin.from('audit_logs').insert({ user_id: caller.id, action: 'admin_user.update_profile', entity_type: 'admin_user', entity_id: userId,
          metadata: { before: { display_name: before?.display_name ?? null }, after: { display_name: name } } }).then(() => {}, () => {});
        break;
      }
      case 'suspend': {
        if (await lastSuperAdmin(admin, userId, targetRoles)) throw new HttpError(400, 'The last super admin cannot be suspended');
        const ban = banDuration(body.until);
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: ban.duration });
        if (error) throw error;
        await revokeSessions(admin, userId);
        await record(admin, caller.id, userId, 'suspend', { until: ban.until }, reason);
        break;
      }
      case 'reactivate': {
        const st = await stateOf(admin, userId);
        if (st.row?.deleted_at) throw new HttpError(400, 'This account is deleted. Restore it instead.');
        if (st.row?.merged_into) throw new HttpError(400, 'This account was merged. Unmerge it instead.');
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
        if (error) throw error;
        await record(admin, caller.id, userId, 'reactivate', {}, reason || null);
        break;
      }
      case 'force_sign_out': {
        await revokeSessions(admin, userId);
        await record(admin, caller.id, userId, 'force_sign_out', {}, reason);
        break;
      }
      case 'password_reset': {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error || !data.user?.email) throw new HttpError(400, 'User has no email');
        const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
        const { error: e2 } = await anon.auth.resetPasswordForEmail(data.user.email, { redirectTo: `${SITE_URL}/reset-password` });
        if (e2) throw e2;
        await record(admin, caller.id, userId, 'password_reset', {}, reason || null);
        break;
      }
      case 'resend_verification': {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error || !data.user?.email) throw new HttpError(400, 'User has no email');
        if (data.user.email_confirmed_at) throw new HttpError(400, 'This e-mail address is already verified');
        const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
        const { error: e2 } = await anon.auth.resend({ type: 'signup', email: data.user.email, options: { emailRedirectTo: `${SITE_URL}/login` } });
        if (e2) throw e2;
        await record(admin, caller.id, userId, 'resend_verification', {}, reason || null);
        break;
      }
      case 'mfa_reset': {
        const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
        if (error) throw error;
        const factors = data?.factors ?? [];
        for (const f of factors) {
          const { error: e2 } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
          if (e2) throw e2;
        }
        await revokeSessions(admin, userId);
        await record(admin, caller.id, userId, 'mfa_reset', { removed_factors: factors.length }, reason);
        break;
      }
      case 'soft_delete': {
        const st = await stateOf(admin, userId);
        if (!st.installed) throw new HttpError(409, 'Deleting with a 30-day restore needs the prepared database update');
        if (st.row?.deleted_at) throw new HttpError(400, 'This account is already deleted');
        if (await lastSuperAdmin(admin, userId, targetRoles)) throw new HttpError(400, 'The last super admin cannot be deleted');
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: FOREVER });
        if (error) throw error;
        await revokeSessions(admin, userId);
        await record(admin, caller.id, userId, 'soft_delete', {}, reason);
        break;
      }
      case 'restore': {
        const st = await stateOf(admin, userId);
        if (!st.row?.deleted_at) throw new HttpError(400, 'This account is not deleted');
        if (st.row?.anonymised_at) throw new HttpError(400, 'This account was anonymised and cannot be restored');
        await record(admin, caller.id, userId, 'restore', {}, reason || null);
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
        if (error) throw error;
        break;
      }
      case 'anonymise': {
        const st = await stateOf(admin, userId);
        if (!st.row?.deleted_at) throw new HttpError(400, 'Delete the account first; it can be anonymised after the 30-day restore period');
        if (st.row?.anonymised_at) throw new HttpError(400, 'This account is already anonymised');
        if (st.row?.anonymise_after && Date.parse(st.row.anonymise_after) > Date.now() && body.early !== true) {
          throw new HttpError(400, 'The 30-day restore period has not ended yet');
        }
        // Soft delete in the sign-in service removes the e-mail address and sign-in methods but keeps the account id,
        // so tickets, invoices and history stay intact.
        const { error } = await admin.auth.admin.deleteUser(userId, true);
        if (error) throw error;
        await record(admin, caller.id, userId, 'anonymised', { early: body.early === true }, reason);
        break;
      }
      case 'delete': {
        const st = await stateOf(admin, userId);
        if (st.installed && !st.row?.deleted_at) throw new HttpError(400, 'Delete the account first (30-day restore); permanent deletion comes after');
        if (await lastSuperAdmin(admin, userId, targetRoles)) throw new HttpError(400, 'The last super admin cannot be deleted');
        await record(admin, caller.id, userId, 'hard_delete', {}, reason);
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
        break;
      }
      case 'merge': {
        const into = String(body.into || '');
        if (!UUID_RE.test(into) || into === userId) throw new HttpError(400, 'Choose a different account to keep');
        if (into === caller.id) { /* keeping your own account is fine */ }
        if (targetRoles.some((r) => ADMIN_ROLES.includes(r))) throw new HttpError(400, 'Admin accounts cannot be merged');
        const st = await stateOf(admin, userId);
        if (!st.installed) throw new HttpError(409, 'Merging needs the prepared database update');
        if (st.row?.merged_into) throw new HttpError(400, 'This account is already merged');
        await record(admin, caller.id, userId, 'merge', { into }, reason);
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: FOREVER });
        if (error) throw error;
        await revokeSessions(admin, userId);
        break;
      }
      case 'unmerge': {
        const st = await stateOf(admin, userId);
        if (!st.row?.merged_into) throw new HttpError(400, 'This account is not merged');
        await record(admin, caller.id, userId, 'unmerge', {}, reason || null);
        if (!st.row?.deleted_at) {
          const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
          if (error) throw error;
        }
        break;
      }
    }
    return jsonResponse(req, { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse(req, { error: e.message }, e.status);
    const wait = authRateLimitMessage(e);
    if (wait) return jsonResponse(req, { error: wait }, 429);
    console.error('admin-manage-user failed', action, e instanceof Error ? e.message : String(e));
    return jsonResponse(req, { error: 'The action could not be completed. Please try again.' }, 500);
  }
});

// Bulk suspend / reactivate (max 200, dry run first, 10-minute undo).
// deno-lint-ignore no-explicit-any
async function bulk(admin: Admin, callerId: string, callerRoles: string[], action: string, body: any, reason: string) {
  if (!(await can(admin, callerId, callerRoles, 'users.suspend'))) throw new HttpError(403, 'You do not have permission for this action');
  const isSuper = callerRoles.includes('super_admin');

  if (action === 'bulk_undo') {
    const runId = String(body.run_id || '');
    if (!UUID_RE.test(runId)) throw new HttpError(400, 'Valid run is required');
    const { data: run } = await admin.from('admin_bulk_runs').select('*').eq('id', runId).maybeSingle();
    if (!run || (run.actor_id !== callerId && !isSuper)) throw new HttpError(404, 'Run not found');
    if (run.undone_at || !run.undo_until || Date.parse(run.undo_until) < Date.now()) throw new HttpError(400, 'The undo window for this run has passed');
    if (!['bulk_suspend', 'bulk_reactivate'].includes(run.action)) throw new HttpError(400, 'Undo this run from the list');
    const back = run.action === 'bulk_suspend' ? 'reactivate' : 'suspend';
    for (const id of run.target_ids as string[]) {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: back === 'suspend' ? FOREVER : 'none' });
      if (error) continue;
      if (back === 'suspend') await revokeSessions(admin, id);
      await record(admin, callerId, id, back, { bulk_run: runId, undo: true }, back === 'suspend' ? 'Undo of a bulk reactivation' : null);
    }
    await admin.from('admin_bulk_runs').update({ undone_at: new Date().toISOString() }).eq('id', runId);
    return { ok: true, count: (run.target_ids as string[]).length };
  }

  const ids = [...new Set(Array.isArray(body.user_ids) ? body.user_ids.map(String) : [])] as string[];
  if (!ids.length) throw new HttpError(400, 'Select at least one person');
  if (ids.length > 200) throw new HttpError(400, 'A bulk action can include at most 200 people');
  if (ids.some((id) => !UUID_RE.test(id))) throw new HttpError(400, 'Valid users are required');
  const suspend = action === 'bulk_suspend';
  if (suspend && reason.length < 5) throw new HttpError(400, 'Please give a reason (at least 5 characters)');
  if (!(await withinRateLimit(admin, `um-bulk:${callerId}`, body.dry_run === false ? 20 : 200, 3600))) {
    throw new HttpError(429, 'Too many bulk actions in the last hour. Please try again later.');
  }

  const { data: roleRows } = await admin.from('user_roles').select('user_id, role').in('user_id', ids);
  const rolesOf = new Map<string, string[]>();
  // deno-lint-ignore no-explicit-any
  (roleRows ?? []).forEach((r: any) => rolesOf.set(r.user_id, [...(rolesOf.get(r.user_id) ?? []), r.role]));
  const { data: states, error: stErr } = await admin.from('user_admin_state').select('user_id, deleted_at, merged_into').in('user_id', ids);
  if (stErr) throw new HttpError(409, 'Bulk actions need the prepared database update');
  // deno-lint-ignore no-explicit-any
  const stMap = new Map((states ?? []).map((s: any) => [s.user_id, s]));

  const eligible: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    const roles = rolesOf.get(id) ?? [];
    // deno-lint-ignore no-explicit-any
    const st: any = stMap.get(id);
    if (id === callerId) skipped.push({ id, reason: 'self' });
    else if (roles.some((r) => ADMIN_ROLES.includes(r)) && !isSuper) skipped.push({ id, reason: 'admin_needs_super' });
    else if (roles.includes('super_admin')) skipped.push({ id, reason: 'super_admin' });
    else if (st?.deleted_at || st?.merged_into) skipped.push({ id, reason: 'deleted_or_merged' });
    else eligible.push(id);
  }
  if (body.dry_run !== false) return { dry_run: true, eligible, skipped };

  const done: string[] = [];
  for (const id of eligible) {
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: suspend ? FOREVER : 'none' });
    if (error) { skipped.push({ id, reason: 'failed' }); continue; }
    if (suspend) await revokeSessions(admin, id);
    await record(admin, callerId, id, suspend ? 'suspend' : 'reactivate', { bulk: true }, suspend ? reason : null);
    done.push(id);
  }
  let runId: string | null = null;
  let undoUntil: string | null = null;
  if (done.length) {
    undoUntil = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data } = await admin.from('admin_bulk_runs').insert({ actor_id: callerId, action, target_ids: done, payload: { reason }, undo_until: undoUntil }).select('id').single();
    runId = data?.id ?? null;
  }
  return { dry_run: false, done: done.length, skipped, run_id: runId, undo_until: undoUntil };
}
