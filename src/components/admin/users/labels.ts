import type { TFunction } from 'i18next';

export const roleLabel = (t: TFunction, r: string) => ({
  client: t('um.role_client', 'Client'), consultant: t('um.role_consultant', 'Consultant'),
  admin: t('um.role_admin', 'Admin'), super_admin: t('um.role_super_admin', 'Super admin'), none: t('um.role_none', 'No role'),
} as Record<string, string>)[r] ?? r;

export const statusLabel = (t: TFunction, s: string) => ({
  active: t('um.status_active', 'Active'), pending: t('um.status_pending', 'E-mail not verified'), invited: t('um.status_invited', 'Invited'),
  suspended: t('um.status_suspended', 'Suspended'), deleted: t('um.status_deleted', 'Deleted'),
} as Record<string, string>)[s] ?? s;

export const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default', pending: 'secondary', invited: 'outline', suspended: 'destructive', deleted: 'destructive',
};

export const verificationLabel = (t: TFunction, v: string) => ({
  pending: t('um.verif_pending', 'Pending'), under_review: t('um.verif_under_review', 'Under review'), on_hold: t('um.verif_on_hold', 'On hold'),
  verified: t('um.verif_verified', 'Verified'), rejected: t('um.verif_rejected', 'Rejected'), suspended: t('um.verif_suspended', 'Suspended'),
} as Record<string, string>)[v] ?? v;

export const permissionLabel = (t: TFunction, p: string) => ({
  'users.read': t('um.perm_users_read', 'See people and their details'),
  'users.edit': t('um.perm_users_edit', 'Edit profile basics, tags and e-mails'),
  'users.roles': t('um.perm_users_roles', 'Change client/consultant roles, access review'),
  'users.suspend': t('um.perm_users_suspend', 'Suspend and reactivate'),
  'users.delete': t('um.perm_users_delete', 'Delete and restore (30 days)'),
  'users.invite': t('um.perm_users_invite', 'Invite people'),
  'users.export': t('um.perm_users_export', 'Export lists and personal data'),
  'users.notes': t('um.perm_users_notes', 'Internal notes'),
  'users.message': t('um.perm_users_message', 'Send notifications and reminders'),
  'users.sessions': t('um.perm_users_sessions', 'Sign people out everywhere'),
  'consultants.verify': t('um.perm_consultants_verify', 'Verify consultants'),
  'finance.view': t('um.perm_finance_view', 'See payments'),
  'finance.approve_payout': t('um.perm_finance_approve', 'Approve payouts'),
  'content.edit': t('um.perm_content_edit', 'Edit site content'),
  'settings.edit': t('um.perm_settings_edit', 'Change platform settings'),
  'audit.read': t('um.perm_audit_read', 'Read the admin action history'),
  'admins.manage': t('um.perm_admins_manage', 'Manage admins and admin groups'),
  'users.merge': t('um.perm_users_merge', 'Merge duplicate accounts'),
  'users.mfa_reset': t('um.perm_users_mfa', 'Reset two-step sign-in'),
  'users.anonymise': t('um.perm_users_anonymise', 'Anonymise deleted accounts'),
  'users.hard_delete': t('um.perm_users_hard_delete', 'Delete permanently'),
} as Record<string, string>)[p] ?? p;

export const fmtDate = (d: string | null | undefined, withTime = false) =>
  d ? (withTime ? new Date(d).toLocaleString() : new Date(d).toLocaleDateString()) : '—';
