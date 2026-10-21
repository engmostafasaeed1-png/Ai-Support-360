import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callEdge, callRpc, useInvalidateUsers } from '@/hooks/useUserAdmin';
import { isUuid, UnknownAccountError, userActionBody } from '@/lib/userAdmin';

/** Actions handled by the database function (signed-in admin) once the prepared update is applied. */
const DB_ACTIONS = new Set(['set_roles', 'update_profile', 'set_tags', 'add_note', 'delete_note', 'notify']);

export function useUserActions(installed: boolean) {
  const { t } = useTranslation();
  const invalidate = useInvalidateUsers();
  const [busy, setBusy] = useState(false);

  /** `userId` must be the auth user id (see authUserIdOf); nothing is sent without one. */
  async function exec(action: string, userId: string, payload: Record<string, unknown> = {}, reason?: string) {
    if (!isUuid(userId)) throw new UnknownAccountError();
    if (DB_ACTIONS.has(action) && installed) {
      return await callRpc<Record<string, unknown>>('admin_user_action', { _uid: userId, _action: action, _payload: payload, _reason: reason || null });
    }
    if (action === 'update_profile') {
      return await callEdge('admin-manage-user', userActionBody('update_name', userId, { name: payload.display_name }, reason));
    }
    if (DB_ACTIONS.has(action) && action !== 'set_roles') throw new Error(t('um.needs_update', 'This needs the prepared database update.'));
    return await callEdge('admin-manage-user', userActionBody(action, userId, payload, reason));
  }

  /** Runs one action with a toast; `undo` adds an Undo button to the toast. Returns the result or null on failure. */
  async function run(action: string, userId: string, opts: { payload?: Record<string, unknown>; reason?: string; ok: string; undo?: () => Promise<unknown> } ) {
    setBusy(true);
    try {
      const res = await exec(action, userId, opts.payload, opts.reason);
      const pending = (res as { pending_request?: string } | undefined)?.pending_request;
      toast.success(pending ? t('um.request_created', 'Request created. A second super admin must approve it.') : opts.ok,
        opts.undo ? { action: { label: t('um.undo', 'Undo'), onClick: () => { opts.undo!().then(() => { invalidate(); toast.success(t('um.undone', 'Undone')); }, (e) => toast.error((e as Error).message)); } }, duration: 10_000 } : undefined);
      invalidate();
      return res ?? {};
    } catch (e) {
      // The server's own plain message (callEdge extracts it); our own message when the account is not known yet.
      toast.error(e instanceof UnknownAccountError ? t('um.unknown_account', e.message) : (e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, run, exec };
}
