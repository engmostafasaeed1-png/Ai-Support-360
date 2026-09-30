// Decrypts a stored *_ciphertext value after verifying (through RLS) that the caller can see the
// underlying record. Supports environment_credentials, vmware_settings and integrations.
// Every successful decryption is written to the audit log.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://esm.sh/zod@3.23.8';
import { adminClient, authenticateUser, bearerToken, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { decryptSecret } from '../_shared/credentials-crypto.ts';

const ALLOWED: Record<string, string[]> = {
  environment_credentials: ['password_ciphertext'],
  vmware_settings: ['vcenter_password_ciphertext', 'cloud_api_key_ciphertext'],
  integrations: ['api_key_ciphertext'],
};

const BodySchema = z.object({
  resource: z.enum(['environment_credentials', 'vmware_settings', 'integrations']),
  field: z.string().min(1).max(100),
  record_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try {
    const user = await authenticateUser(req);
    if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

    const admin = adminClient();
    if (!(await withinRateLimit(admin, `cred-decrypt:${user.id}`, 30, 60, true))) {
      return jsonResponse(req, { error: 'Too many requests' }, 429);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return jsonResponse(req, { error: 'Invalid request' }, 400);
    const { resource, field, record_id } = parsed.data;
    if (!ALLOWED[resource]?.includes(field)) return jsonResponse(req, { error: 'Invalid resource/field' }, 400);

    // RLS decides whether this caller may see the row at all.
    const sbUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearerToken(req)}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: visible } = await sbUser.from(resource).select('id').eq('id', record_id).maybeSingle();
    if (!visible) return jsonResponse(req, { error: 'Forbidden' }, 403);

    // The ciphertext columns are not readable by clients; fetch with the service role.
    const { data: row, error: rowErr } = await admin.from(resource).select(field).eq('id', record_id).maybeSingle();
    if (rowErr || !row) return jsonResponse(req, { error: 'Not found' }, 404);
    const stored = (row as Record<string, string | null>)[field];
    if (!stored) return jsonResponse(req, { plaintext: '' });

    const plaintext = await decryptSecret(stored);

    // Audit trail (never includes the secret itself).
    const { error: auditErr } = await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'credential.decrypted',
      entity_type: resource,
      entity_id: record_id,
      metadata: { field },
    });
    if (auditErr) console.error('audit log insert failed:', auditErr.message);

    return jsonResponse(req, { plaintext }, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    console.error('credentials-decrypt error:', e instanceof Error ? e.message : String(e));
    return jsonResponse(req, { error: 'Decryption failed' }, 500);
  }
});
