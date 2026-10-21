import { describe, it, expect } from 'vitest';
import { authUserIdOf, normalizeUserDetail, UnknownAccountError, userActionBody, UUID_RE } from './userAdmin';
import { BAD_USER_MESSAGE, targetUserId } from '../../supabase/functions/admin-manage-user/target';

const AUTH_ID = 'ececf669-f7d0-49f8-a974-487afb5447ac';
const CONSULTANT_ID = '11111111-2222-4333-8444-555555555555';
const ACTIONS = ['resend_verification', 'confirm_email', 'password_reset'] as const;

describe('admin account actions always target the auth user id (bug H4)', () => {
  it.each(ACTIONS)('list row: %s sends a UUID user_id', (action) => {
    const row = { id: AUTH_ID, consultant_id: CONSULTANT_ID };
    const body = userActionBody(action, authUserIdOf(row, 'user'), {}, 'checked by phone');
    expect(body).toMatchObject({ action, user_id: AUTH_ID });
    expect(String(body.user_id)).toMatch(UUID_RE);
  });

  it.each(ACTIONS)('drawer (database detail names it user_id): %s sends a UUID user_id', (action) => {
    const detail = normalizeUserDetail({ user: { user_id: AUTH_ID, consultant_id: CONSULTANT_ID } as Record<string, unknown> });
    const body = userActionBody(action, (detail.user as { id: string }).id);
    expect(body).toMatchObject({ action, user_id: AUTH_ID });
  });

  it.each(ACTIONS)('consultant admin view: %s maps the consultant row to its user_id, never the consultant id', (action) => {
    const consultantRow = { id: CONSULTANT_ID, user_id: AUTH_ID };
    const body = userActionBody(action, authUserIdOf(consultantRow, 'consultant'));
    expect(body.user_id).toBe(AUTH_ID);
    expect(body.user_id).not.toBe(CONSULTANT_ID);
    expect(authUserIdOf({ id: CONSULTANT_ID }, 'consultant')).toBeNull();
  });

  it('refuses to build a request without a valid id, and the payload cannot redirect it', () => {
    for (const bad of [undefined, null, '', 'u-target', CONSULTANT_ID.slice(0, 20)]) {
      expect(() => userActionBody('resend_verification', bad)).toThrow(UnknownAccountError);
    }
    const body = userActionBody('suspend', AUTH_ID, { user_id: CONSULTANT_ID, id: CONSULTANT_ID, userId: CONSULTANT_ID, until: null });
    expect(body.user_id).toBe(AUTH_ID);
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('userId');
  });
});

describe('admin-manage-user target id', () => {
  it('a bad id returns null so the function answers 400 with the plain message', () => {
    expect(targetUserId({ action: 'resend_verification', user_id: 'not-a-uuid' })).toBeNull();
    expect(targetUserId({ action: 'resend_verification' })).toBeNull();
    expect(targetUserId(null)).toBeNull();
    expect(BAD_USER_MESSAGE).toBe('This account could not be identified. Close the account panel, open it again and retry.');
    expect(BAD_USER_MESSAGE).not.toMatch(/uuid|user_id|valid user/i);
  });

  it('accepts userId or id as aliases only when they are UUIDs', () => {
    expect(targetUserId({ user_id: AUTH_ID })).toBe(AUTH_ID);
    expect(targetUserId({ userId: AUTH_ID })).toBe(AUTH_ID);
    expect(targetUserId({ id: AUTH_ID })).toBe(AUTH_ID);
    expect(targetUserId({ userId: 'abc', id: 42 })).toBeNull();
  });

  it('an invalid user_id is refused even when an alias holds a UUID', () => {
    expect(targetUserId({ user_id: 'u-target', id: AUTH_ID })).toBeNull();
  });
});
