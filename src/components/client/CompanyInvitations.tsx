import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

interface Invitation {
  tenant_id: string;
  company_name: string;
  org_role: string;
  invited_by: string;
  invited_at: string;
}

export default function CompanyInvitations({ onAccepted }: { onAccepted?: () => unknown }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_company_invitations');
    if (!error) setInvitations((data ?? []) as Invitation[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const answer = async (tenantId: string, accept: boolean) => {
    setBusy(tenantId);
    const { error } = await supabase.rpc('respond_to_company_invitation', { _tenant_id: tenantId, _accept: accept });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(accept ? 'You joined the company.' : 'Invitation declined.');
    await load();
    if (accept && onAccepted) await onAccepted();
  };

  if (invitations.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invitations</p>
      {invitations.map((inv) => (
        <Card key={inv.tenant_id} className="border-border/40 bg-card/95 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{inv.company_name}</p>
              <p className="text-xs text-muted-foreground">
                Invited as {inv.org_role} · {formatDistanceToNow(new Date(inv.invited_at), { addSuffix: true })}
              </p>
            </div>
            <Button size="sm" className="gap-1" disabled={busy === inv.tenant_id} onClick={() => answer(inv.tenant_id, true)}>
              {busy === inv.tenant_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept
            </Button>
            <Button size="sm" variant="outline" className="gap-1" disabled={busy === inv.tenant_id} onClick={() => answer(inv.tenant_id, false)}>
              <X className="w-3.5 h-3.5" /> Decline
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
