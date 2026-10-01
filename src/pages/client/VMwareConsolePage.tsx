import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Monitor, Play, Square, RotateCcw, Pause, Camera, Trash2, RefreshCw,
  Cpu, MemoryStick, HardDrive, Activity, Server, Clock, AlertCircle,
} from 'lucide-react';
import { useRemoteEnvironments } from '@/hooks/useRemoteEnvironments';
import { useVMwareSnapshots, useVMwareActions, useCreateSnapshot, useDeleteSnapshot, useVMAction } from '@/hooks/useVMwareConsole';
import { format } from 'date-fns';

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500',
  inactive: 'bg-muted-foreground',
  maintenance: 'bg-amber-500',
};

export default function VMwareConsolePage() {
  const { t } = useTranslation();
  const { data: environments, isLoading: envsLoading } = useRemoteEnvironments();
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const { data: snapshots, isLoading: snapshotsLoading } = useVMwareSnapshots(selectedEnvId || undefined);
  const { data: actions } = useVMwareActions(selectedEnvId || undefined);
  const createSnapshot = useCreateSnapshot();
  const deleteSnapshot = useDeleteSnapshot();
  const vmAction = useVMAction();
  const [snapshotName, setSnapshotName] = useState('');

  const selectedEnv = (environments || []).find(e => e.id === selectedEnvId);

  if (envsLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 rounded-2xl" /></div>;
  }

  const envs = environments || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Monitor className="w-5 h-5 text-primary" /> VMware Console
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Manage, monitor, and control your virtual machines
        </p>
      </div>

      {/* Environment Selector */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary shrink-0" />
            <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select VM..." />
              </SelectTrigger>
              <SelectContent>
                {envs.map(env => (
                  <SelectItem key={env.id} value={env.id}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${statusColors[env.status] || 'bg-muted-foreground'}`} />
                      {env.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedEnvId && selectedEnv ? (
        <>
          {/* Power Controls */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  Power Controls
                  <Badge variant="outline" className="text-[9px]">
                    <span className={`w-1.5 h-1.5 rounded-full mr-1 ${statusColors[selectedEnv.status] || 'bg-muted-foreground'}`} />
                    {selectedEnv.status}
                  </Badge>
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { action: 'start', icon: Play, label: 'Start', color: 'text-emerald-500' },
                  { action: 'stop', icon: Square, label: 'Stop', color: 'text-destructive' },
                  { action: 'restart', icon: RotateCcw, label: 'Restart', color: 'text-amber-500' },
                  { action: 'suspend', icon: Pause, label: 'Suspend', color: 'text-muted-foreground' },
                ].map(ctrl => (
                  <Button
                    key={ctrl.action}
                    variant="outline"
                    size="sm"
                    className="flex-col h-16 gap-1 text-xs"
                    disabled={vmAction.isPending}
                    onClick={() => vmAction.mutate({ environment_id: selectedEnvId, action: ctrl.action })}
                  >
                    <ctrl.icon className={`w-4 h-4 ${ctrl.color}`} />
                    {ctrl.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Resource Monitoring */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Resource Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {[
                { label: 'CPU', icon: Cpu, specs: `${selectedEnv.cpu_cores || 2} cores` },
                { label: 'RAM', icon: MemoryStick, specs: `${selectedEnv.ram_gb || 4} GB` },
                { label: 'Disk', icon: HardDrive, specs: `${selectedEnv.disk_gb || 50} GB` },
              ].map(r => (
                <div key={r.label} className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-1.5">
                      <r.icon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-medium">{r.label}</span>
                      <span className="text-muted-foreground">({r.specs})</span>
                    </div>
                    <span className="text-muted-foreground">—</span>
                  </div>
                </div>
              ))}

              <p className="text-xs text-muted-foreground text-center py-2">Usage data not available</p>
            </CardContent>
          </Card>

          {/* Snapshot Management */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Camera className="w-4 h-4 text-primary" /> Snapshots
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Snapshot name..."
                  value={snapshotName}
                  onChange={e => setSnapshotName(e.target.value)}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!snapshotName.trim() || createSnapshot.isPending}
                  onClick={() => {
                    createSnapshot.mutate({ environment_id: selectedEnvId, name: snapshotName });
                    setSnapshotName('');
                  }}
                >
                  <Camera className="w-3 h-3 mr-1" /> Create
                </Button>
              </div>

              {snapshotsLoading ? (
                <Skeleton className="h-20 rounded-xl" />
              ) : (snapshots || []).length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No snapshots yet</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {(snapshots || []).map(snap => (
                    <div key={snap.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/30">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{snap.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {format(new Date(snap.created_at), 'MMM d, HH:mm')}
                          {snap.size_gb && ` · ${snap.size_gb} GB`}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => vmAction.mutate({ environment_id: selectedEnvId, action: 'restore_snapshot' })}
                        >
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive"
                          onClick={() => deleteSnapshot.mutate({ id: snap.id, environment_id: selectedEnvId })}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Log */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> Recent Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {(actions || []).length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No actions yet</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {(actions || []).map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted/20">
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {a.action}
                      </Badge>
                      <span className="text-muted-foreground truncate">
                        {format(new Date(a.created_at), 'MMM d, HH:mm')}
                      </span>
                      {a.status === 'failed' && (
                        <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Monitor className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Select a VM above to access the console</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
