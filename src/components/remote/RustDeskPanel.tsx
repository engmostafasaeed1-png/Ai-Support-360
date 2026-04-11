import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Monitor, Copy, ExternalLink, Plus, Trash2, Pencil, Server, Settings, Share2 } from 'lucide-react';

interface RustDeskHost {
  id: string;
  alias: string;
  rustDeskId: string;
  relayServer?: string;
}

export default function RustDeskPanel({ onShare }: { onShare?: () => void }) {
  const [hosts, setHosts] = useState<RustDeskHost[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editHost, setEditHost] = useState<RustDeskHost | null>(null);
  const [alias, setAlias] = useState('');
  const [rdId, setRdId] = useState('');
  const [relay, setRelay] = useState('');

  const handleSave = () => {
    if (!alias || !rdId) return;
    if (editHost) {
      setHosts(prev => prev.map(h => h.id === editHost.id ? { ...h, alias, rustDeskId: rdId, relayServer: relay || undefined } : h));
      toast.success('Host updated');
    } else {
      setHosts(prev => [...prev, { id: crypto.randomUUID(), alias, rustDeskId: rdId, relayServer: relay || undefined }]);
      toast.success('Host added');
    }
    setAddOpen(false);
    setEditHost(null);
    setAlias('');
    setRdId('');
    setRelay('');
  };

  const handleConnect = (id: string) => {
    window.open(`rustdesk://connection/new/${id}`, '_blank');
    toast.success('Opening RustDesk...');
  };

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('RustDesk ID copied');
  };

  const handleDelete = (id: string) => {
    setHosts(prev => prev.filter(h => h.id !== id));
    toast.success('Host removed');
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Server className="w-4 h-4 text-emerald-500" />
            </div>
            RustDesk
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] gap-1">
              <Settings className="w-3 h-3" /> Self-Hosted
            </Badge>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setAlias(''); setRdId(''); setRelay(''); setEditHost(null); setAddOpen(true); }}>
              <Plus className="w-3 h-3" /> Add Host
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
        <p className="text-xs text-muted-foreground mb-3">
          Open-source remote desktop — no API key needed. Install RustDesk on your machines and add their IDs here.
        </p>

        {hosts.length === 0 ? (
          <div className="text-center py-8">
            <Server className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No RustDesk hosts added</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add your RustDesk IDs to connect remotely</p>
          </div>
        ) : (
          <div className="space-y-2">
            {hosts.map(host => (
              <Card key={host.id} className="rounded-xl border-border/30">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Server className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-foreground truncate block">{host.alias}</span>
                    <p className="text-xs text-muted-foreground font-mono">ID: {host.rustDeskId}</p>
                    {host.relayServer && <p className="text-[10px] text-muted-foreground">Relay: {host.relayServer}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy ID" onClick={() => handleCopy(host.rustDeskId)}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" className="h-7 text-xs gap-1 gradient-primary border-0" onClick={() => handleConnect(host.rustDeskId)}>
                      <ExternalLink className="w-3 h-3" /> Connect
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditHost(host); setAlias(host.alias); setRdId(host.rustDeskId); setRelay(host.relayServer || ''); setAddOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(host.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={addOpen} onOpenChange={(v) => { if (!v) { setAddOpen(false); setEditHost(null); } else setAddOpen(true); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{editHost ? 'Edit Host' : 'Add RustDesk Host'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Host name (e.g. SAP Dev Server)" />
              <Input value={rdId} onChange={e => setRdId(e.target.value)} placeholder="RustDesk ID (e.g. 123456789)" />
              <Input value={relay} onChange={e => setRelay(e.target.value)} placeholder="Relay server (optional)" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddOpen(false); setEditHost(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={!alias || !rdId} className="gradient-primary border-0">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
