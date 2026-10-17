export const ADMIN_MAIL_LIMIT = 30;
export const ADMIN_MAIL_WINDOW = 3600;
export const ADMIN_MAIL_ATTEMPTS = 5;
export const canAttemptAdminMail = (attempts: number) => attempts < ADMIN_MAIL_ATTEMPTS;
export const adminMailSubject = (title: string) => `[AI Support 360 admin] ${title.replace(/[\r\n]/g, ' ')}`;
export function adminMailLink(link: string | null) {
  const origin = 'https://www.aisupport360.com';
  if (!link || !link.startsWith('/') || link.startsWith('//') || /[\\\r\n]/.test(link)) return `${origin}/admin/notifications`;
  const url = new URL(link, origin);
  return url.origin === origin ? url.href : `${origin}/admin/notifications`;
}