import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getEmailUnsubscribe,
  setEmailUnsubscribe,
} from 'npm:@lovable.dev/email-js@0.1.0'
import { corsHeaders as sharedCorsHeaders, clientIp, withinRateLimit } from '../_shared/security.ts'

const SENDER_DOMAIN = 'notify.aisupport360.com'

Deno.serve(async (req) => {
  const corsHeaders = sharedCorsHeaders(req)
  const jsonResponse = (data: Record<string, unknown>, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // Extract token/email from query params (GET) or body (POST)
  const url = new URL(req.url)
  let token: string | null = url.searchParams.get('token')
  let email: string | null = url.searchParams.get('email')

  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formText = await req.text()
      const params = new URLSearchParams(formText)
      if (!params.get('List-Unsubscribe')) {
        token = token ?? params.get('token')
        email = email ?? params.get('email')
      }
    } else {
      try {
        const body = await req.json()
        token = token ?? body.token ?? null
        email = email ?? body.email ?? null
      } catch {
        // token/email stay from query params
      }
    }
  }

  // Resolve the recipient email. Prefer a direct email param; fall back to
  // the legacy token table so links in already-sent emails keep working.
  let recipient = email?.trim().toLowerCase() || null

  if (!recipient && token) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: tokenRecord } = await supabase
      .from('email_unsubscribe_tokens')
      .select('email, used_at')
      .eq('token', token)
      .maybeSingle()

    if (!tokenRecord) {
      return jsonResponse({ error: 'Invalid or expired token' }, 404)
    }
    if (tokenRecord.used_at) {
      return jsonResponse({ valid: false, reason: 'already_unsubscribed' })
    }
    recipient = String(tokenRecord.email).toLowerCase()
  }

  if (!recipient) {
    return jsonResponse({ error: 'Token or email is required' }, 400)
  }

  // Anyone who knows an address can open an unsubscribe link, so the endpoint must not be usable in bulk:
  // the value has to look like one e-mail address, and requests are counted per IP and per address
  // (the counters fail open: a real unsubscribe is never blocked because the counter is down).
  if (recipient.length > 254 || !/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(recipient)) {
    return jsonResponse({ error: 'Invalid e-mail address' }, 400)
  }
  const ip = clientIp(req)
  const limiter = createClient(supabaseUrl, supabaseServiceKey)
  let allowed = await withinRateLimit(limiter, `unsub-ip:${ip}`, 120, 3600, true)
  if (allowed && req.method === 'POST') {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(recipient))
    const recipientKey = Array.from(new Uint8Array(digest).slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('')
    allowed =
      (await withinRateLimit(limiter, `unsub-post-ip:${ip}`, 20, 3600, true)) &&
      (await withinRateLimit(limiter, `unsub-post-rcpt:${recipientKey}`, 5, 3600, true))
  }
  if (!allowed) {
    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429)
  }

  const options = { apiKey }

  // Check current subscription state with the managed email system
  let currentlySubscribed = true
  try {
    const state = await getEmailUnsubscribe(
      { recipient, domain: SENDER_DOMAIN },
      options,
    )
    currentlySubscribed = state.subscribed
  } catch (err) {
    console.error('Failed to read unsubscribe state', { error: String(err) })
    return jsonResponse({ error: 'Could not verify the unsubscribe link.' }, 502)
  }

  if (!currentlySubscribed) {
    return jsonResponse({ valid: false, reason: 'already_unsubscribed' })
  }

  // GET: validate only (the app's unsubscribe page calls this on load)
  if (req.method === 'GET') {
    return jsonResponse({ valid: true })
  }

  // POST: process the unsubscribe through the managed suppression system
  try {
    await setEmailUnsubscribe(
      { recipient, domain: SENDER_DOMAIN, subscribed: false },
      options,
    )
  } catch (err) {
    console.error('Failed to unsubscribe recipient', { error: String(err) })
    return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
  }

  // Mark the legacy token as used (best effort)
  if (token) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    await supabase
      .from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)
      .is('used_at', null)
  }

  // Notification-only record keeping; suppression is enforced at send time
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  await supabase
    .from('suppressed_emails')
    .upsert({ email: recipient, reason: 'unsubscribe' }, { onConflict: 'email' })

  console.log('Email unsubscribed', { via: token ? 'token' : 'email', ip })

  return jsonResponse({ success: true })
})
