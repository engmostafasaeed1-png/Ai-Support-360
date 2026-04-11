import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Inbox, CheckCircle2, ExternalLink, Copy, Clock, CalendarDays } from 'lucide-react';
import { useConsultantSharedConfigs, useAcceptRemoteConfig } from '@/hooks/useSharedRemoteConfigs';
import { format } from 'date-fns';
import { toast } from 'sonner';

const toolLabels: Record<string, string> = {
  anydesk: 'AnyDesk',
  teamviewer: 'TeamViewer',
  rustdesk: 'RustDesk',
  rdp: 'RDP/VNC',
  guacamole: 'Guacamole',
};

const toolProtocols: Record<string, string> = {
  anydesk: 'anydesk:',
  teamviewer: 'teamviewer10://control?device=',
  rustdesk: 'rustdesk://connection/new/',
};

export default function SharedConfigsConsultantPanel() {
  const { data: configs, isLoading } = useConsultantSharedConfigs();
  const accept = useAcceptRemoteConfig();

  if (isLoading) return <Skeleton className="h-32 rounded-2xl" />;
  if (!configs?.length) return null;

  const handleConnect = (toolType: string, connectionId: string) => {
    const protocol = toolProtocols[toolType];
    if (protocol) {
      window.open(`${protocol}${connectionId}`, '_blank');
      toast.success(`Opening ${toolLabels[toolType]}...`);
    } else if (toolType === 'rdp') {
      const rdpContent = `full address:s:${connectionId}\nprompt for credentials:i:1`;
      const blob = new Blob([rdpContent], { type: 'application/x-rdp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `connection.rdp`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('RDP file downloaded');
    }
  };

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('Connection ID copied');
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Inbox className="w-4 h-4 text-accent" />
          </div>
          Shared Remote Access
          {configs.some(c => c.status === 'pending') && (
            <Badge variant="default" className="text-[9px] ms-auto">{configs.filter(c => c.status === 'pending').length} New</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {configs.map(cfg => {
          const config = cfg.config as Record<string, unknown>;
          const connectionId = (config.connectionId as string) || '';
          const alias = (config.alias as string) || '';
          const isPending = cfg.status === 'pending';

          return (
            <Card key={cfg.id} className={`rounded-xl border-border/30 ${isPending ? 'ring-1 ring-accent/30' : ''}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {alias || connectionId || 'Unnamed'}
                      </span>
                      <Badge variant="outline" className="text-[9px]">{toolLabels[cfg.tool_type] || cfg.tool_type}</Badge>
                      {isPending ? (
                        <Badge variant="secondary" className="text-[9px] gap-1">
                          <Clock className="w-2.5 h-2.5" /> New
                        </Badge>
                      ) : (
                        <Badge variant="default" className="text-[9px] gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Accepted
                        </Badge>
                      )}
                    </div>
                    {connectionId && <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {connectionId}</p>}
                    {(config.startDate || config.endDate) && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <CalendarDays className="w-2.5 h-2.5" />
                        {config.startDate ? format(new Date(config.startDate as string), 'MMM d, yyyy') : '—'} → {config.endDate ? format(new Date(config.endDate as string), 'MMM d, yyyy') : 'Ongoing'}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Shared {format(new Date(cfg.shared_at), 'MMM d, yyyy HH:mm')}
                    </p>
                    {cfg.message && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1 italic bg-muted/30 rounded-lg px-2 py-1">
                        "{cfg.message}"
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isPending && (
                      <Button size="sm" className="h-7 text-xs gap-1 gradient-primary border-0"
                        onClick={() => accept.mutate(cfg.id)}
                        disabled={accept.isPending}>
                        <CheckCircle2 className="w-3 h-3" /> Accept
                      </Button>
                    )}
                    {connectionId && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy ID"
                          onClick={() => handleCopy(connectionId)}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" className="h-7 text-xs gap-1" variant="outline"
                          onClick={() => handleConnect(cfg.tool_type, connectionId)}>
                          <ExternalLink className="w-3 h-3" /> Connect
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}