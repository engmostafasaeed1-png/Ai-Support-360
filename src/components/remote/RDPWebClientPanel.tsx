import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Monitor, Plus, Trash2, Pencil, Globe, ExternalLink, Copy, Share2 } from 'lucide-react';

interface RDPConnection {
  id: string;
  name: string;
  hostname: string;
  port: string;
  protocol: 'rdp' | 'vnc';
  gatewayUrl?: string;
}

export default function RDPWebClientPanel({ onShare }: { onShare?: () => void }) {
  const [connections, setConnections] = useState<RDPConnection[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editConn, setEditConn] = useState<RDPConnection | null>(null);
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('3389');
  const [protocol, setProtocol] = useState<'rdp' | 'vnc'>('rdp');
  const [gatewayUrl, setGatewayUrl] = useState('');

  const resetForm = () => { setName(''); setHostname(''); setPort('3389'); setProtocol('rdp'); setGatewayUrl(''); setEditConn(null); };

  const handleSave = () => {
    if (!name || !hostname) return;
    if (editConn) {
      setConnections(prev => prev.map(c => c.id === editConn.id ? { ...c, name, hostname, port, protocol, gatewayUrl: gatewayUrl || undefined } : c));
      toast.success('Connection updated');
    } else {
      setConnections(prev => [...prev, { id: crypto.randomUUID(), name, hostname, port, protocol, gatewayUrl: gatewayUrl || undefined }]);
      toast.success('Connection added');
    }
    setAddOpen(false);
    resetForm();
  };

  const handleConnect = (conn: RDPConnection) => {
    if (conn.gatewayUrl) {
      window.open(conn.gatewayUrl, '_blank');
    } else if (conn.protocol === 'rdp') {
      // Generate RDP file download
      const rdpContent = `full address:s:${conn.hostname}:${conn.port}\nprompt for credentials:i:1\nadministrative session:i:1`;
      const blob = new Blob([rdpContent], { type: 'application/x-rdp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conn.name}.rdp`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('RDP file downloaded — open it to connect');
    } else {
      toast.info('Open your VNC client and connect to ' + conn.hostname + ':' + conn.port);
    }
  };

  const handleCopy = (conn: RDPConnection) => {
    navigator.clipboard.writeText(`${conn.hostname}:${conn.port}`);
    toast.success('Address copied');
  };

  const handleDelete = (id: string) => {
    setConnections(prev => prev.filter(c => c.id !== id));
    toast.success('Connection removed');
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Globe className="w-4 h-4 text-violet-500" />
            </div>
            RDP / VNC Web Client
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] gap-1">
              <Monitor className="w-3 h-3" /> Direct
            </Badge>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { resetForm(); setAddOpen(true); }}>
              <Plus className="w-3 h-3" /> Add Connection
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
          Direct RDP/VNC connections — downloads an .rdp file or opens your web gateway URL.
        </p>

        {connections.length === 0 ? (
          <div className="text-center py-8">
            <Globe className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No RDP/VNC connections added</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add server addresses or web gateway URLs</p>
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map(conn => (
              <Card key={conn.id} className="rounded-xl border-border/30">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${conn.protocol === 'rdp' ? 'bg-violet-500/10' : 'bg-orange-500/10'}`}>
                    <Monitor className={`w-4 h-4 ${conn.protocol === 'rdp' ? 'text-violet-500' : 'text-orange-500'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground truncate">{conn.name}</span>
                      <Badge variant="outline" className="text-[9px]">{conn.protocol.toUpperCase()}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{conn.hostname}:{conn.port}</p>
                    {conn.gatewayUrl && <p className="text-[10px] text-muted-foreground truncate">Gateway: {conn.gatewayUrl}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy" onClick={() => handleCopy(conn)}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" className="h-7 text-xs gap-1 gradient-primary border-0" onClick={() => handleConnect(conn)}>
                      <ExternalLink className="w-3 h-3" /> Connect
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditConn(conn); setName(conn.name); setHostname(conn.hostname); setPort(conn.port); setProtocol(conn.protocol); setGatewayUrl(conn.gatewayUrl || ''); setAddOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(conn.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={addOpen} onOpenChange={(v) => { if (!v) { setAddOpen(false); resetForm(); } else setAddOpen(true); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{editConn ? 'Edit Connection' : 'Add RDP/VNC Connection'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Connection name" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={hostname} onChange={e => setHostname(e.target.value)} placeholder="Hostname / IP" />
                <Input value={port} onChange={e => setPort(e.target.value)} placeholder="Port" />
              </div>
              <Select value={protocol} onValueChange={(v: 'rdp' | 'vnc') => setProtocol(v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rdp">RDP (Remote Desktop)</SelectItem>
                  <SelectItem value="vnc">VNC</SelectItem>
                </SelectContent>
              </Select>
              <Input value={gatewayUrl} onChange={e => setGatewayUrl(e.target.value)} placeholder="Web gateway URL (optional)" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={!name || !hostname} className="gradient-primary border-0">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
