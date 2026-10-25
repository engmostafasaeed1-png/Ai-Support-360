// Encryption of NDA signer ID numbers (nda_signatory_identity.id_cipher). AES-256-GCM with a key derived (HKDF-SHA256)
// from the backend secret NDA_ID_ENCRYPTION_KEY, a random 96-bit IV and the signer's user id as additional data, so a
// value copied to another person's row does not decrypt. Stored as "v1.<key id>.<iv b64>.<ciphertext b64>"; the key id
// (8 hex) tells which key wrote a value, so a later key rotation can re-encrypt instead of losing data.
// The key never reaches the database or the browser.
export const ID_KEY_ENV = 'NDA_ID_ENCRYPTION_KEY';
export const CIPHER_RE = /^v1\.[0-9a-f]{8}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$/;
const enc = new TextEncoder();

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export function keyUsable(secret: string | undefined | null): secret is string {
  return typeof secret === 'string' && secret.length >= 32;
}

export async function keyId(secret: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`nda-id-kid:${secret}`)));
  return [...d.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('aisupport360-nda-id-v1'), info: enc.encode('aes-256-gcm') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptIdNumber(plain: string, secret: string, userId: string): Promise<string> {
  if (!keyUsable(secret)) throw new Error('id_key_missing');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`nda-id:${userId}`) }, await aesKey(secret), enc.encode(plain)));
  return `v1.${await keyId(secret)}.${b64(iv)}.${b64(ct)}`;
}

export async function decryptIdNumber(cipher: string, secret: string, userId: string): Promise<string> {
  if (!keyUsable(secret)) throw new Error('id_key_missing');
  if (!CIPHER_RE.test(cipher)) throw new Error('id_cipher_invalid');
  const [, kid, ivB64, ctB64] = cipher.split('.');
  if (kid !== (await keyId(secret))) throw new Error('id_key_mismatch');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64), additionalData: enc.encode(`nda-id:${userId}`) }, await aesKey(secret), unb64(ctB64));
  return new TextDecoder().decode(pt);
}
