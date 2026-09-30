// Encrypts a plaintext secret with AES-256-GCM (v2 format, see _shared/credentials-crypto.ts).
// Returns "v2:" + base64(iv || ciphertext) for storage in *_ciphertext columns.
import { z } from 'https://esm.sh/zod@3.23.8';
import { adminClient, authenticateUser, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { encryptSecret } from '../_shared/credentials-crypto.ts';

const BodySchema = z.object({ plaintext: z.string().min(1).max(16_384) });

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try {
    const user = await authenticateUser(req);
    if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

    // Stop this endpoint from being used as a bulk encryption oracle.
    if (!(await withinRateLimit(adminClient(), `cred-encrypt:${user.id}`, 60, 60, true))) {
      return jsonResponse(req, { error: 'Too many requests' }, 429);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return jsonResponse(req, { error: 'Invalid request' }, 400);

    return jsonResponse(req, { ciphertext: await encryptSecret(parsed.data.plaintext) });
  } catch (e) {
    console.error('credentials-encrypt error:', e instanceof Error ? e.message : String(e));
    return jsonResponse(req, { error: 'Encryption failed' }, 500);
  }
});
