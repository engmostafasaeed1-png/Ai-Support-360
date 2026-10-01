import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, ShieldCheck } from 'lucide-react';

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id') ?? '';
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError('Missing authorization request.');
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = '/login?next=' + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) { window.location.href = immediate; return; }
      setDetails(data);
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (error) { setBusy(false); return setError(error.message); }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); return setError('No redirect was returned. Please try again.'); }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? 'An app';

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md rounded-2xl shadow-lg">
        <CardContent className="p-8 space-y-6 text-center">
          {error ? (
            <>
              <h1 className="text-xl font-bold">Could not load this request</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
            </>
          ) : !details ? (
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
          ) : (
            <>
              <ShieldCheck className="w-10 h-10 mx-auto text-primary" />
              <h1 className="text-xl font-bold">Connect {clientName} to your account</h1>
              <p className="text-sm text-muted-foreground">
                {clientName} will be able to view and create support tickets in AI SAP Support Now as you.
              </p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Deny</Button>
                <Button disabled={busy} onClick={() => decide(true)}>Approve</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
