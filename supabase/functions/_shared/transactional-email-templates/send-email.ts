import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { EmailAPIError, sendLovableEmail } from 'npm:@lovable.dev/email-js@0.1.0'
import { TEMPLATES } from './registry.ts'
import { buildPauseLinks, type PauseCategory } from '../notificationPause.ts'

// Server-only: reads LOVABLE_API_KEY. Import from edge functions only — never
// expose sending to the browser.

// Configuration baked in at scaffold time
const SITE_NAME = "AI Support 360"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers. NEVER use the root domain.
const SENDER_DOMAIN = "notify.aisupport360.com"
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// Can be the root domain when display_from_root is enabled — this is cosmetic only.
const FROM_DOMAIN = "aisupport360.com"

export type SendTemplateEmailResult =
  | { sent: true }
  | { sent: false; reason: 'recipient_suppressed' | 'notifications_disabled' | 'notifications_paused' }

/** Sends a person starts on purpose; they go out even when automatic email notifications are off. */
const ALWAYS_SEND = new Set(['platform-invitation', 'interview-invitation', 'interview-invitation-copy'])

/** Reads the admin switch email_notifications (default on). Fails open so a lookup error never blocks mail. */
async function emailNotificationsOn(): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return true
  try {
    const res = await fetch(`${url}/rest/v1/platform_settings?key=eq.email_notifications&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return true
    const rows = await res.json()
    const v = rows?.[0]?.value
    return !(v === false || v === 'false')
  } catch {
    return true
  }
}

const SITE_URL = 'https://www.aisupport360.com'

/**
 * Feature Q: the one server-side pause gate for e-mail (public.notification_email_check -> notifications_paused).
 * Before the prepared SQL is applied, or when the lookup fails, nothing is paused and no footer links are offered.
 */
async function pauseCheck(userId: string, category: PauseCategory): Promise<{ paused: boolean; links: boolean }> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return { paused: false, links: false }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/notification_email_check`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ _user_id: userId, _category: category }),
    })
    if (!res.ok) return { paused: false, links: false }
    const v = await res.json()
    return { paused: v?.paused === true, links: v?.links === true }
  } catch {
    return { paused: false, links: false }
  }
}

export interface SendTemplateEmailOptions {
  templateData?: Record<string, any>
  /** Dedupes retries of the same logical send; defaults to a random UUID (no dedupe). */
  idempotencyKey?: string
  replyTo?: string
  /**
   * Recipient's user id and the notice category. Non-essential categories are skipped while the user has paused
   * e-mails and get the signed "Pause for 3 days | 1 week | 1 month | Unsubscribe" footer. Essential mail always goes out.
   */
  pause?: { userId: string; category: PauseCategory }
}

/**
 * Renders a registered template and sends it through Lovable's managed email
 * API. Suppression, retries, and rate limits are enforced by Lovable
 * server-side. A suppressed recipient is an expected outcome
 * ({ sent: false }); any other failure throws — EmailAPIError exposes
 * .code and .status for branching.
 */
export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {}
): Promise<SendTemplateEmailResult> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) {
    throw new Error('LOVABLE_API_KEY is not configured')
  }

  const template = TEMPLATES[templateName]
  if (!template) {
    throw new Error(
      `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`
    )
  }

  if (!ALWAYS_SEND.has(templateName) && !(await emailNotificationsOn())) {
    return { sent: false, reason: 'notifications_disabled' }
  }

  // Template-level `to` takes precedence — notification templates always
  // send to their fixed address.
  const recipient = template.to || to
  if (!recipient) {
    throw new Error('Recipient is required (the template defines no fixed recipient)')
  }

  const templateData: Record<string, any> = { ...(options.templateData ?? {}) }
  const pause = options.pause
  if (pause && pause.category !== 'essential' && !ALWAYS_SEND.has(templateName)) {
    const check = await pauseCheck(pause.userId, pause.category)
    if (check.paused) return { sent: false, reason: 'notifications_paused' }
    const secret = Deno.env.get('NOTIFICATION_PAUSE_SECRET') ?? ''
    if (check.links && secret.length >= 32) {
      try {
        templateData.pauseLinks = await buildPauseLinks(secret, pause.userId, SITE_URL, Math.floor(Date.now() / 1000),
          templateData.lang === 'ar' ? 'ar' : 'en')
      } catch { /* the e-mail still goes out, only without the footer */ }
    }
  }
  const element = React.createElement(template.component, templateData)
  const html = template.html ? template.html(templateData) : await renderAsync(element)
  const text = template.text ? template.text(templateData) : await renderAsync(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  try {
    await sendLovableEmail(
      {
        to: recipient,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        label: templateName,
        idempotency_key: options.idempotencyKey || crypto.randomUUID(),
        reply_to: options.replyTo,
      },
      { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') }
    )
  } catch (error) {
    if (error instanceof EmailAPIError && error.code === 'recipient_suppressed') {
      return { sent: false, reason: 'recipient_suppressed' }
    }
    throw error
  }

  return { sent: true }
}
