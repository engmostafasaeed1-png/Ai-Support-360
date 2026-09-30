import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { buildRemoteUri, connectionIdHint, isValidConnectionId, normalizeConnectionId } from '@/lib/remoteAccess';
import { openProtocolLink } from '@/lib/safeUrl';
import { Monitor, Copy, ExternalLink, Plus, Trash2, Pencil, Shield, Share2 } from 'lucide-react';

interface TeamViewerDevice {
  id: string;
  alias: string;
  teamviewerId: string;
  status: 'online' | 'offline';
}

export default function TeamViewerPanel({ onShare }: { onShare?: () => void }) {
  const [devices, setDevices] = useState<TeamViewerDevice[]>([
    { id: '1', alias: 'SAP Production', teamviewerId: '', status: 'offline' },
  ]);
  const [addOpen, setAddOpen] = useState(false);
  const [editDevice, setEditDevice] = useState<TeamViewerDevice | null>(null);
  const [alias, setAlias] = useState('');
  const [tvId, setTvId] = useState('');

  const handleSave = () => {
    if (!alias || !tvId) return;
    if (!isValidConnectionId('teamviewer', tvId)) {
      toast.error(connectionIdHint('teamviewer'));
      return;
    }
    const cleanId = normalizeConnectionId('teamviewer', tvId);
    if (editDevice) {
      setDevices(prev => prev.map(d => d.id === editDevice.id ? { ...d, alias, teamviewerId: cleanId } : d));
      toast.success('Device updated');
    } else {
      setDevices(prev => [...prev, { id: crypto.randomUUID(), alias, teamviewerId: cleanId, status: 'offline' }]);
      toast.success('Device added');
    }
    setAddOpen(false);
    setEditDevice(null);
    setAlias('');
    setTvId('');
  };

  const handleConnect = (id: string) => {
    const uri = buildRemoteUri('teamviewer', id);
    if (!uri || !openProtocolLink(uri, ['teamviewer10'])) {
      toast.error('Invalid TeamViewer ID');
      return;
    }
    toast.success('Opening TeamViewer...');
  };

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('TeamViewer ID copied');
  };

  const handleDelete = (id: string) => {
    setDevices(prev => prev.filter(d => d.id !== id));
    toast.success('Device removed');
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Monitor className="w-4 h-4 text-blue-500" />
            </div>
            TeamViewer
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] gap-1">
              <Shield className="w-3 h-3" /> Manual
            </Badge>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setAlias(''); setTvId(''); setEditDevice(null); setAddOpen(true); }}>
              <Plus className="w-3 h-3" /> Add Device
            </Button>
            {onShare && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onShare}>
                <Share2 className="w-3 h-3" /> Share
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <div className="text-center py-8">
            <Monitor className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No TeamViewer devices added</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add your TeamViewer IDs to connect remotely</p>
          </div>
        ) : (
          <div className="space-y-2">
            {devices.map(device => (
              <Card key={device.id} className="rounded-xl border-border/30">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Monitor className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-foreground truncate block">{device.alias}</span>
                    {device.teamviewerId && (
                      <p className="text-xs text-muted-foreground font-mono">ID: {device.teamviewerId}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {device.teamviewerId && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy ID" onClick={() => handleCopy(device.teamviewerId)}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" className="h-7 text-xs gap-1 gradient-primary border-0" onClick={() => handleConnect(device.teamviewerId)}>
                          <ExternalLink className="w-3 h-3" /> Connect
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditDevice(device); setAlias(device.alias); setTvId(device.teamviewerId); setAddOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(device.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={addOpen} onOpenChange={(v) => { if (!v) { setAddOpen(false); setEditDevice(null); } else setAddOpen(true); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{editDevice ? 'Edit Device' : 'Add TeamViewer Device'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Device name (e.g. SAP Server)" />
              <Input value={tvId} onChange={e => setTvId(e.target.value)} placeholder="TeamViewer ID (e.g. 123 456 789)" />
              {tvId && !isValidConnectionId('teamviewer', tvId) && <p className="text-[10px] text-destructive">{connectionIdHint('teamviewer')}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddOpen(false); setEditDevice(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={!alias || !tvId || !isValidConnectionId('teamviewer', tvId)} className="gradient-primary border-0">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
