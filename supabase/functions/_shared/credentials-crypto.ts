// AES-256-GCM helpers for the *_ciphertext columns.
//
//  v2 (new writes): key = HKDF-SHA256(CREDENTIALS_ENCRYPTION_KEY, salt, info), random 96-bit IV,
//                   fixed AAD for domain separation, stored as "v2:" + base64(iv || ciphertext).
//  legacy (existing rows, no prefix): key = SHA-256(secret), no AAD, stored as base64(iv || ciphertext).
//
// Decryption accepts both formats so existing data keeps working; every new write uses v2.
const V2_PREFIX = 'v2:';
const enc = new TextEncoder();
const AAD_V2 = enc.encode('qurtuba-credentials-v2');

function secret(): string {
  const raw = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
  if (!raw) throw new Error('CREDENTIALS_ENCRYPTION_KEY not configured');
  return raw;
}

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function legacyKey(): Promise<CryptoKey> {
  const hashed = await crypto.subtle.digest('SHA-256', enc.encode(secret()));
  return crypto.subtle.importKey('raw', hashed, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function v2Key(): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret()), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('qurtuba-talks/credentials/v2'),
      info: enc.encode('aes-256-gcm'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await v2Key();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_V2 }, key, enc.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return V2_PREFIX + b64encode(out);
}

export async function decryptSecret(stored: string): Promise<string> {
  const isV2 = stored.startsWith(V2_PREFIX);
  const buf = b64decode(isV2 ? stored.slice(V2_PREFIX.length) : stored);
  if (buf.length < 12 + 16) throw new Error('Ciphertext is malformed');
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const key = isV2 ? await v2Key() : await legacyKey();
  const params = isV2
    ? { name: 'AES-GCM', iv, additionalData: AAD_V2 }
    : { name: 'AES-GCM', iv };
  const plain = await crypto.subtle.decrypt(params, key, ct);
  return new TextDecoder().decode(plain);
}
