/**
 * Sender identity of the platform's own e-mails (display name, From, Reply-To, footer contact line). Pure TypeScript,
 * shared by the edge functions, the admin settings card and the tests.
 *
 * From may only use the verified sending domain (aisupport360.com, delivered through the verified, Lovable-managed
 * notify.aisupport360.com with SPF/DKIM). Reply-To and the contact line may only be addresses on our own domain.
 * Settings live in platform_settings (docs/sql/email-sender.sql); anything invalid falls back to the defaults, so a bad
 * setting can never break delivery.
 */
export const VERIFIED_FROM_DOMAIN = 'aisupport360.com';
export const OWN_MAIL_DOMAINS = ['aisupport360.com'] as const;

export interface SenderSettings { displayName: string; fromLocal: string; replyTo: string; contactEmail: string }
export const SENDER_DEFAULTS: SenderSettings = {
  displayName: 'AI Support 360', fromLocal: 'noreply', replyTo: 'info@aisupport360.com', contactEmail: 'info@aisupport360.com',
};
export const SENDER_SETTING_KEYS = ['email_sender_display_name', 'email_sender_from', 'email_reply_to', 'email_contact_address'] as const;

export type SenderProblem = 'display_name' | 'from_format' | 'from_domain_not_verified' | 'reply_to' | 'contact';

const EMAIL = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@([a-z0-9-]+\.)+[a-z]{2,}$/i;
const LOCAL = /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/i;
/** Letters (any script), digits, spaces and & . - ' ( ) only: no quotes, angle brackets, commas or line breaks. */
const NAME = /^[\p{L}\p{N} &.'()-]{1,60}$/u;

const domainOf = (addr: string) => addr.split('@')[1]?.toLowerCase() ?? '';
export const isOwnAddress = (addr: unknown) =>
  typeof addr === 'string' && EMAIL.test(addr.trim()) && (OWN_MAIL_DOMAINS as readonly string[]).includes(domainOf(addr.trim()));

/** Checks one settings change. `from` is a full address; its domain must be the verified sending domain. */
export function senderProblems(v: { displayName?: unknown; from?: unknown; replyTo?: unknown; contactEmail?: unknown }): SenderProblem[] {
  const out: SenderProblem[] = [];
  if (v.displayName !== undefined && !(typeof v.displayName === 'string' && NAME.test(v.displayName.trim()))) out.push('display_name');
  if (v.from !== undefined) {
    const f = String(v.from ?? '').trim();
    if (!EMAIL.test(f) || !LOCAL.test(f.split('@')[0])) out.push('from_format');
    else if (domainOf(f) !== VERIFIED_FROM_DOMAIN) out.push('from_domain_not_verified');
  }
  if (v.replyTo !== undefined && !isOwnAddress(v.replyTo)) out.push('reply_to');
  if (v.contactEmail !== undefined && !isOwnAddress(v.contactEmail)) out.push('contact');
  return out;
}

/** Settings from platform_settings rows; every invalid or missing value falls back to the default. */
export function senderFromSettings(rows: Array<{ key: string; value: unknown }> | null | undefined): SenderSettings {
  const get = (k: string) => { const v = (rows ?? []).find((r) => r.key === k)?.value; return typeof v === 'string' ? v.trim() : undefined; };
  const name = get('email_sender_display_name');
  const from = get('email_sender_from');
  const reply = get('email_reply_to');
  const contact = get('email_contact_address');
  return {
    displayName: name && senderProblems({ displayName: name }).length === 0 ? name : SENDER_DEFAULTS.displayName,
    fromLocal: from && senderProblems({ from }).length === 0 ? from.split('@')[0].toLowerCase() : SENDER_DEFAULTS.fromLocal,
    replyTo: reply && isOwnAddress(reply) ? reply.toLowerCase() : SENDER_DEFAULTS.replyTo,
    contactEmail: contact && isOwnAddress(contact) ? contact.toLowerCase() : SENDER_DEFAULTS.contactEmail,
  };
}

/** The From header: quoted display name, local part on the verified domain (anything else falls back to the default). */
export function fromHeader(displayName?: string | null, fromLocal?: string | null): string {
  const name = displayName && NAME.test(displayName.trim()) ? displayName.trim() : SENDER_DEFAULTS.displayName;
  const local = fromLocal && LOCAL.test(fromLocal) ? fromLocal.toLowerCase() : SENDER_DEFAULTS.fromLocal;
  return `"${name}" <${local}@${VERIFIED_FROM_DOMAIN}>`;
}
