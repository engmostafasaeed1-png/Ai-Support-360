import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Send, RefreshCw, XCircle, Clock, CheckCircle2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useClientSharedConfigs, useResendRemoteConfig, useRevokeRemoteConfig } from '@/hooks/useSharedRemoteConfigs';
import { useClientNdaConsultantIds } from '@/hooks/useNdaAccess';
import { format } from 'date-fns';

const statusConfig: Record<string, { label: string; icon: React.ElementType; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', icon: Clock, variant: 'outline' },
  accepted: { label: 'Accepted', icon: CheckCircle2, variant: 'default' },
  revoked: { label: 'Revoked', icon: XCircle, variant: 'destructive' },
};

const toolLabels: Record<string, string> = {
  anydesk: 'AnyDesk',
  teamviewer: 'TeamViewer',
  rustdesk: 'RustDesk',
  rdp: 'RDP/VNC',
  guacamole: 'Guacamole',
};

export default function SharedConfigsClientPanel() {
  const { data: configs, isLoading } = useClientSharedConfigs();
  const resend = useResendRemoteConfig();
  const revoke = useRevokeRemoteConfig();
  const { data: ndaConsultants } = useClientNdaConsultantIds();

  if (isLoading) return <Skeleton className="h-32 rounded-2xl" />;
  if (!configs?.length) return null;

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Send className="w-4 h-4 text-primary" />
          </div>
          Shared Remote Configs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {configs.map(cfg => {
          const sc = statusConfig[cfg.status] || statusConfig.pending;
          const StatusIcon = sc.icon;
          const config = (cfg.config || {}) as Record<string, string>;
          return (
            <Card key={cfg.id} className="rounded-xl border-border/30">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {(config.alias as string) || toolLabels[cfg.tool_type] || cfg.tool_type}
                      </span>
                      <Badge variant="outline" className="text-[9px]">{toolLabels[cfg.tool_type] || cfg.tool_type}</Badge>
                      <Badge variant={sc.variant} className="text-[9px] gap-1">
                        <StatusIcon className="w-2.5 h-2.5" /> {sc.label}
                      </Badge>
                    </div>
                    {cfg.status !== 'revoked' && (
                      <p className={`text-[10px] mt-0.5 flex items-center gap-1 ${ndaConsultants?.has(cfg.consultant_id) ? 'text-green-600' : 'text-amber-600'}`}>
                        {ndaConsultants?.has(cfg.consultant_id)
                          ? (<><ShieldCheck className="w-3 h-3" /> NDA signed: the consultant can see this share</>)
                          : (<><ShieldAlert className="w-3 h-3" /> Waiting for the consultant&apos;s NDA: they see nothing until they sign</>)}
                      </p>
                    )}
                    {config.connectionId && (
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {String(config.connectionId)}</p>
                    )}
                    {(config.startDate || config.endDate) && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {config.startDate ? format(new Date(config.startDate), 'MMM d, yyyy') : '—'} → {config.endDate ? format(new Date(config.endDate), 'MMM d, yyyy') : 'Ongoing'}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Shared {format(new Date(cfg.shared_at), 'MMM d, yyyy HH:mm')}
                    </p>
                    {cfg.message && <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">"{cfg.message}"</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {cfg.status !== 'revoked' && (
                      <>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
                          onClick={() => resend.mutate(cfg.id)}
                          disabled={resend.isPending}>
                          <RefreshCw className="w-3 h-3" /> Resend
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive"
                          onClick={() => revoke.mutate(cfg.id)}
                          disabled={revoke.isPending}>
                          <XCircle className="w-3 h-3" /> Revoke
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