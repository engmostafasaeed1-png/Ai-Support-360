import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, Monitor, Terminal, Laptop } from 'lucide-react';
import {
  useEnvironmentConnections, useCreateConnection, useDeleteConnection,
  type EnvironmentConnection,
} from '@/hooks/useEnvironmentConnections';

const protocolIcons = { rdp: Monitor, ssh: Terminal, vnc: Laptop };
const protocolLabels = { rdp: 'RDP', ssh: 'SSH', vnc: 'VNC' };

interface ConnectionsManagerProps {
  environmentId: string;
}

export default function ConnectionsManager({ environmentId }: ConnectionsManagerProps) {
  const { data: connections, isLoading } = useEnvironmentConnections(environmentId);
  const createConn = useCreateConnection();
  const deleteConn = useDeleteConnection();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProtocol, setNewProtocol] = useState<'rdp' | 'ssh' | 'vnc'>('rdp');
  const [newUrl, setNewUrl] = useState('');
  const [newDefault, setNewDefault] = useState(false);

  const handleAdd = () => {
    if (!newName || !newUrl) return;
    createConn.mutate({
      environment_id: environmentId,
      name: newName,
      protocol: newProtocol,
      guacamole_url: newUrl,
      is_default: newDefault,
    });
    setAdding(false);
    setNewName('');
    setNewUrl('');
    setNewDefault(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connections</p>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setAdding(!adding)}>
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>

      {adding && (
        <div className="p-3 rounded-xl border border-border/50 bg-muted/30 space-y-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Connection name" className="h-8 text-sm" />
          <div className="flex gap-2">
            <Select value={newProtocol} onValueChange={(v: any) => setNewProtocol(v)}>
              <SelectTrigger className="h-8 text-sm w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rdp">RDP</SelectItem>
                <SelectItem value="ssh">SSH</SelectItem>
                <SelectItem value="vnc">VNC</SelectItem>
              </SelectContent>
            </Select>
            <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Guacamole URL" className="h-8 text-sm flex-1" />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={newDefault} onChange={(e) => setNewDefault(e.target.checked)} className="rounded" />
              Default connection
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs gradient-primary border-0" onClick={handleAdd}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (!connections || connections.length === 0) ? (
        <p className="text-xs text-muted-foreground italic">No connections yet. The environment's main URL will be used.</p>
      ) : (
        <div className="space-y-1.5">
          {connections.map((conn) => {
            const Icon = protocolIcons[conn.protocol] || Monitor;
            return (
              <div key={conn.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 border border-border/30">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">{conn.name}</span>
                  <Badge variant="outline" className="text-[9px] shrink-0">{protocolLabels[conn.protocol]}</Badge>
                  {conn.is_default && <Badge variant="secondary" className="text-[9px] shrink-0">Default</Badge>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive shrink-0"
                  onClick={() => deleteConn.mutate({ id: conn.id, environmentId })}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
