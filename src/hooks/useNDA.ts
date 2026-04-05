import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useNDATemplate() {
  const [template, setTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTemplate = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'nda_template')
      .maybeSingle();

    if (!error && data) {
      const val = data.value;
      setTemplate(typeof val === 'string' ? val : JSON.stringify(val));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplate(); }, [fetchTemplate]);

  const saveTemplate = useCallback(async (content: string) => {
    const { error } = await supabase
      .from('platform_settings')
      .update({ value: content as any, updated_at: new Date().toISOString() })
      .eq('key', 'nda_template');

    if (error) {
      toast({ title: 'Error', description: 'Failed to save NDA template', variant: 'destructive' });
    } else {
      toast({ title: 'Saved', description: 'NDA template updated successfully' });
      setTemplate(content);
    }
  }, [toast]);

  return { template, loading, saveTemplate, refetch: fetchTemplate };
}

export function useNDAAgreement(consultantId?: string, clientId?: string) {
  const [signed, setSigned] = useState(false);
  const [wasRevoked, setWasRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!consultantId || !clientId) { setLoading(false); return; }
    supabase
      .from('nda_agreements')
      .select('id, revoked_at')
      .eq('consultant_id', consultantId)
      .eq('client_id', clientId)
      .order('signed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const revoked = !!data && !!(data as any).revoked_at;
        setSigned(!!data && !revoked);
        setWasRevoked(revoked);
        setLoading(false);
      });
  }, [consultantId, clientId]);

  const signNDA = useCallback(async (signatureData: string, signatureType: 'draw' | 'type', ndaContent: string) => {
    if (!consultantId || !clientId) return false;
    const { error } = await supabase.from('nda_agreements').insert({
      consultant_id: consultantId,
      client_id: clientId,
      signature_data: signatureData,
      signature_type: signatureType,
      nda_content: ndaContent,
    } as any);

    if (error) {
      toast({ title: 'Error', description: 'Failed to sign NDA', variant: 'destructive' });
      return false;
    }
    setSigned(true);
    toast({ title: 'NDA Signed', description: 'You have successfully signed the NDA' });
    return true;
  }, [consultantId, clientId, toast]);

  return { signed, loading, signNDA };
}
