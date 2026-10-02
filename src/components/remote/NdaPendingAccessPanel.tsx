import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, FileSignature, Monitor, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNdaPendingAccess } from '@/hooks/useNdaAccess';
import NDASigningModal from '@/components/consultant/NDASigningModal';

const toolLabels: Record<string, string> = {
  anydesk: 'AnyDesk',
  teamviewer: 'TeamViewer',
  rustdesk: 'RustDesk',
  rdp: 'RDP/VNC',
  guacamole: 'Guacamole',
};

type Group = { clientId: string; clientName: string; tools: string[]; environments: number };

export default function NdaPendingAccessPanel() {
  const qc = useQueryClient();
  const { data: pending } = useNdaPendingAccess();
  const { data: consultantId } = useQuery({
    queryKey: ['my-consultant-id'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      return data?.id ?? null;
    },
  });
  const [modal, setModal] = useState<{ open: boolean; clientId: string; clientName: string }>({
    open: false, clientId: '', clientName: '',
  });

  if (!pending?.length || !consultantId) return null;

  const groups = new Map<string, Group>();
  for (const item of pending) {
    const g = groups.get(item.client_id) ?? { clientId: item.client_id, clientName: item.client_name, tools: [], environments: 0 };
    if (item.kind === 'share') g.tools.push(toolLabels[item.detail] || item.detail);
    else g.environments += 1;
    groups.set(item.client_id, g);
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['nda-pending-access'] });
    qc.invalidateQueries({ queryKey: ['shared-remote-configs-consultant'] });
    qc.invalidateQueries({ queryKey: ['remote-environments'] });
    qc.invalidateQueries({ queryKey: ['nda-status'] });
    qc.invalidateQueries({ queryKey: ['environment-connections'] });
  };

  return (
    <Card className="rounded-2xl border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </div>
          Waiting for your NDA
          <Badge variant="outline" className="text-[9px] ms-auto">{groups.size}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          You can see the connection details only after you have signed the client&apos;s Non-Disclosure Agreement.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {[...groups.values()].map((g) => (
          <div key={g.clientId} className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-background p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{g.clientName}</p>
              <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                {g.tools.length > 0 && (
                  <span className="flex items-center gap-1"><Send className="w-3 h-3" /> {[...new Set(g.tools)].join(', ')}</span>
                )}
                {g.environments > 0 && (
                  <span className="flex items-center gap-1"><Monitor className="w-3 h-3" /> {g.environments} environment{g.environments > 1 ? 's' : ''}</span>
                )}
              </p>
            </div>
            <Button size="sm" className="h-8 gap-1.5 shrink-0"
              onClick={() => setModal({ open: true, clientId: g.clientId, clientName: g.clientName })}>
              <FileSignature className="w-3.5 h-3.5" /> Sign NDA
            </Button>
          </div>
        ))}
      </CardContent>
      <NDASigningModal
        open={modal.open}
        onOpenChange={(open) => setModal((prev) => ({ ...prev, open }))}
        consultantId={consultantId}
        clientId={modal.clientId}
        clientName={modal.clientName}
        onSigned={refresh}
      />
    </Card>
  );
}
