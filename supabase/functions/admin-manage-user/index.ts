// Admin-only user management: list users with email/status/roles, change roles,
// suspend/reactivate, delete, edit display name, send password reset.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';

const ROLES = ['client', 'consultant', 'admin', 'super_admin'];
const UUID_RE = /^[0-9a-f-]{36}$/i;

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

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || '');

  try {
    if (action === 'list') {
      const users: any[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < 200) break;
      }
      const ids = users.map((u) => u.id);
      const [{ data: profiles }, { data: roles }, { data: clientRows }] = await Promise.all([
        admin.from('profiles').select('user_id, display_name, avatar_url').in('user_id', ids),
        admin.from('user_roles').select('user_id, role').in('user_id', ids),
        admin.from('client_profiles').select('user_id, approval_status').in('user_id', ids),
      ]);
      const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      const cMap = new Map((clientRows ?? []).map((c: any) => [c.user_id, c.approval_status as string]));
      const rMap = new Map<string, string[]>();
      (roles ?? []).forEach((r: any) => rMap.set(r.user_id, [...(rMap.get(r.user_id) ?? []), r.role]));
      return jsonResponse(req, {
        users: users.map((u) => {
          const banned = u.banned_until && new Date(u.banned_until) > new Date();
          return {
            id: u.id, email: u.email ?? '', name: (pMap.get(u.id) as any)?.display_name || u.user_metadata?.full_name || '',
            avatar_url: (pMap.get(u.id) as any)?.avatar_url ?? null, roles: rMap.get(u.id) ?? [],
            created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null,
            status: banned ? 'suspended' : u.email_confirmed_at ? 'active' : 'pending',
            is_self: u.id === caller.id,
            client_approval: cMap.get(u.id) ?? null,
          };
        }),
      });
    }

    const userId = String(body.user_id || '');
    if (!UUID_RE.test(userId)) return jsonResponse(req, { error: 'Valid user is required' }, 400);
    const targetRoles = await getUserRoles(admin, userId);
    if (targetRoles.includes('super_admin') && !isSuper) return jsonResponse(req, { error: 'Only a super admin can change a super admin' }, 403);
    const self = userId === caller.id;

    switch (action) {
      case 'set_roles': {
        const next: string[] = Array.isArray(body.roles) ? [...new Set(body.roles.map(String))] as string[] : [];
        if (next.some((r) => !ROLES.includes(r))) return jsonResponse(req, { error: 'Unknown role' }, 400);
        if (next.includes('super_admin') !== targetRoles.includes('super_admin') && !isSuper) return jsonResponse(req, { error: 'Only a super admin can grant super admin' }, 403);
        if (self && !hasAnyRole(next, ADMIN_ROLES)) return jsonResponse(req, { error: 'You cannot remove your own admin access' }, 400);
        const toAdd = next.filter((r) => !targetRoles.includes(r));
        const toRemove = targetRoles.filter((r) => !next.includes(r));
        if (toRemove.length) {
          const { error } = await admin.from('user_roles').delete().eq('user_id', userId).in('role', toRemove);
          if (error) throw error;
        }
        if (toAdd.length) {
          const { error } = await admin.from('user_roles').insert(toAdd.map((role) => ({ user_id: userId, role })));
          if (error) throw error;
        }
        break;
      }
      case 'suspend':
      case 'reactivate': {
        if (self) return jsonResponse(req, { error: 'You cannot suspend yourself' }, 400);
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: action === 'suspend' ? '876000h' : 'none' });
        if (error) throw error;
        break;
      }
      case 'delete': {
        if (self) return jsonResponse(req, { error: 'You cannot delete yourself' }, 400);
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
        break;
      }
      case 'update_name': {
        const name = String(body.name || '').trim().slice(0, 80);
        if (!name) return jsonResponse(req, { error: 'Name is required' }, 400);
        const { error } = await admin.from('profiles').update({ display_name: name }).eq('user_id', userId);
        if (error) throw error;
        break;
      }
      case 'password_reset': {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error || !data.user?.email) return jsonResponse(req, { error: 'User has no email' }, 400);
        const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
        const { error: e2 } = await anon.auth.resetPasswordForEmail(data.user.email, { redirectTo: `${SITE_URL}/reset-password` });
        if (e2) throw e2;
        break;
      }
      default:
        return jsonResponse(req, { error: 'Unknown action' }, 400);
    }
    await admin.from('audit_logs').insert({ user_id: caller.id, action: `admin_user_${action}`, entity_type: 'user', entity_id: userId, metadata: action === 'set_roles' ? { roles: body.roles } : {} }).then(() => {}, () => {});
    return jsonResponse(req, { ok: true });
  } catch (e) {
    console.error('admin-manage-user failed', action, e);
    return jsonResponse(req, { error: (e as Error).message || 'Action failed' }, 500);
  }
});
