import { supabase } from '@/integrations/supabase/client';

/**
 * Encrypt a plaintext credential via the credentials-encrypt edge function.
 * Returns the base64 ciphertext string for storage in *_ciphertext columns.
 */
export async function encryptCredential(plaintext: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('credentials-encrypt', {
    body: { plaintext },
  });
  if (error) throw new Error(error.message || 'Encryption failed');
  if (data?.error) throw new Error(data.error);
  return data.ciphertext as string;
}

/**
 * Decrypt a stored ciphertext by calling the credentials-decrypt edge function.
 * The edge function enforces RLS ownership before returning the plaintext.
 */
export async function decryptCredential(
  resource: 'environment_credentials' | 'vmware_settings' | 'integrations',
  field: string,
  recordId: string,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('credentials-decrypt', {
    body: { resource, field, record_id: recordId },
  });
  if (error) throw new Error(error.message || 'Decryption failed');
  if (data?.error) throw new Error(data.error);
  return (data.plaintext as string) || '';
}
