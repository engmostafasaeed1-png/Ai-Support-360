export const OPEN_ADMIN_PROFILE = 'admin:open-full-profile';
export type AdminProfileTarget = { userId?: string; consultantId?: string };
export function openAdminProfile(target: AdminProfileTarget) {
  if (!target.userId && !target.consultantId) return;
  window.dispatchEvent(new CustomEvent(OPEN_ADMIN_PROFILE, { detail: target }));
}
export function profileRoles(value: unknown): string[] {
  const known = new Set(['consultant', 'client', 'admin', 'super_admin']);
  return Array.isArray(value) ? [...new Set(value.filter((r): r is string => typeof r === 'string' && known.has(r)))] : [];
}
export function profilePageUrl(target: AdminProfileTarget) {
  const params = new URLSearchParams({ profilePage: '1' });
  if (target.userId) params.set('fullUser', target.userId);
  else if (target.consultantId) params.set('fullConsultant', target.consultantId);
  return `/admin/users?${params}`;
}