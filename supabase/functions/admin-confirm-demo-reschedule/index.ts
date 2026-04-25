// Admin endpoint: confirms a proposed reschedule slot and sends the
// requester a confirmation email with a tokenized link to their request page.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: 'Server misconfigured' }, 500)

  // Auth: validate the caller's JWT and confirm admin role
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userRes, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userRes?.user) return json({ error: 'Unauthorized' }, 401)

  let body: { request_id?: string; slot_index?: number; note?: string; site_origin?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const { request_id, slot_index = 0, note, site_origin } = body
  if (!request_id) return json({ error: 'request_id is required' }, 400)

  const admin = createClient(supabaseUrl, serviceKey)

  // Call the existing RPC as the user (RPC enforces admin role check)
  const { data: row, error: rpcErr } = await userClient.rpc('admin_confirm_reschedule_slot', {
    _request_id: request_id,
    _slot_index: slot_index,
    _note: note,
  })
  if (rpcErr) return json({ error: rpcErr.message }, 400)

  // Look up the request token + email/name to build the confirmation link
  const { data: req2, error: reqErr } = await admin
    .from('demo_requests')
    .select('email, full_name, request_token, scheduled_date, scheduled_slot, timezone')
    .eq('id', request_id)
    .maybeSingle()
  if (reqErr || !req2) return json({ ok: true, warning: 'request not found for email' })

  const origin = site_origin || 'https://smart-sap-connect.lovable.app'
  const confirmationUrl = `${origin}/demo/confirmation/${req2.request_token}`

  try {
    await admin.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'demo-reschedule-confirmed',
        recipientEmail: req2.email,
        idempotencyKey: `demo-reschedule-confirmed-${request_id}-${req2.scheduled_date}-${req2.scheduled_slot}`,
        templateData: {
          name: req2.full_name,
          confirmationUrl,
          scheduledDate: req2.scheduled_date,
          scheduledSlot: req2.scheduled_slot,
          timezone: req2.timezone,
        },
      },
    })
  } catch (e) {
    console.warn('Failed to enqueue confirmation email', e)
  }

  return json({ ok: true, request: row })
})
