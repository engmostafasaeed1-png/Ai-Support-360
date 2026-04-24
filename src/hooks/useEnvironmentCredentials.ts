import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { encryptCredential } from '@/lib/credentialsCrypto';

export interface EnvironmentCredential {
  id: string;
  environment_id: string;
  credential_label: string;
  hostname: string | null;
  port: number;
  domain: string | null;
  username: string;
  /** Base64 AES-GCM ciphertext (iv || cipher). Decrypt via decryptCredential(). */
  password_ciphertext: string | null;
  entered_by: string;
  created_at: string;
  updated_at: string;
}

// Safe columns to select from the client. The legacy `password_encrypted`
// column has been REVOKEd from authenticated/anon, so we never request it
// here. Decryption happens on-demand via the credentials-decrypt function.
const SELECT_COLS =
  'id, environment_id, credential_label, hostname, port, domain, username, password_ciphertext, entered_by, created_at, updated_at';

export function useEnvironmentCredentials(environmentId?: string) {
  return useQuery({
    queryKey: ['environment-credentials', environmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('environment_credentials')
        .select(SELECT_COLS)
        .eq('environment_id', environmentId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as EnvironmentCredential[];
    },
    enabled: !!environmentId,
  });
}

interface CreateCredentialInput {
  environment_id: string;
  credential_label: string;
  hostname: string | null;
  port: number;
  domain: string | null;
  username: string;
  /** Plaintext password — will be encrypted client-side before insert. */
  password: string;
  entered_by: string;
}

export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCredentialInput) => {
      const password_ciphertext = await encryptCredential(input.password);
      const { password: _omit, ...rest } = input;
      const { data, error } = await supabase
        .from('environment_credentials')
        .insert({
          ...rest,
          password_ciphertext,
          // Legacy NOT NULL column — keep populated with a placeholder until the
          // schema can drop it. Direct read is REVOKEd from clients.
          password_encrypted: 'ENCRYPTED',
        } as any)
        .select(SELECT_COLS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['environment-credentials', vars.environment_id] });
      toast.success('Credentials saved securely');
    },
    onError: (err: any) => toast.error('Failed to save credentials', { description: err.message }),
  });
}

interface UpdateCredentialInput {
  id: string;
  environment_id: string;
  credential_label?: string;
  hostname?: string | null;
  port?: number;
  domain?: string | null;
  username?: string;
  /** Optional new plaintext password. Omit to leave existing ciphertext. */
  password?: string;
}

export function useUpdateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, environment_id, password, ...updates }: UpdateCredentialInput) => {
      const patch: Record<string, unknown> = { ...updates };
      if (password) {
        patch.password_ciphertext = await encryptCredential(password);
      }
      const { error } = await supabase
        .from('environment_credentials')
        .update(patch as any)
        .eq('id', id);
      if (error) throw error;
      return environment_id;
    },
    onSuccess: (envId) => {
      qc.invalidateQueries({ queryKey: ['environment-credentials', envId] });
      toast.success('Credentials updated');
    },
    onError: (err: any) => toast.error('Failed to update', { description: err.message }),
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, environmentId }: { id: string; environmentId: string }) => {
      const { error } = await supabase
        .from('environment_credentials')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return environmentId;
    },
    onSuccess: (envId) => {
      qc.invalidateQueries({ queryKey: ['environment-credentials', envId] });
      toast.success('Credentials removed');
    },
    onError: (err: any) => toast.error('Failed to delete', { description: err.message }),
  });
}
