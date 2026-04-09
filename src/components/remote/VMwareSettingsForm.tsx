import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, Server, Cpu, Shield, Save } from 'lucide-react';
import type { VMwareSettings } from '@/hooks/useVMwareSettings';

interface VMwareSettingsFormProps {
  settings: VMwareSettings | null;
  environmentId: string;
  environmentName: string;
  onSave: (data: any) => void;
  readOnly?: boolean;
  saving?: boolean;
}

export default function VMwareSettingsForm({
  settings, environmentId, environmentName, onSave, readOnly = false, saving = false,
}: VMwareSettingsFormProps) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  // vCenter
  const [vcenterUrl, setVcenterUrl] = useState('');
  const [vcenterUsername, setVcenterUsername] = useState('');
  const [vcenterPassword, setVcenterPassword] = useState('');
  const [datacenter, setDatacenter] = useState('');
  const [cluster, setCluster] = useState('');
  const [resourcePool, setResourcePool] = useState('');
  const [datastore, setDatastore] = useState('');

  // VM Defaults
  const [defaultOs, setDefaultOs] = useState('Windows Server 2022');
  const [defaultCpu, setDefaultCpu] = useState('4');
  const [defaultRam, setDefaultRam] = useState('16');
  const [defaultDisk, setDefaultDisk] = useState('100');

  // Network
  const [vlan, setVlan] = useState('');
  const [allowedPorts, setAllowedPorts] = useState('3389,22,443');
  const [vpnGateway, setVpnGateway] = useState('');
  const [vpnType, setVpnType] = useState('ipsec');
  const [firewallRules, setFirewallRules] = useState('');

  // Additional
  const [snapshotEnabled, setSnapshotEnabled] = useState(true);
  const [autoShutdown, setAutoShutdown] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (settings) {
      setVcenterUrl(settings.vcenter_url || '');
      setVcenterUsername(settings.vcenter_username || '');
      setVcenterPassword(settings.vcenter_password_encrypted || '');
      setDatacenter(settings.datacenter || '');
      setCluster(settings.cluster || '');
      setResourcePool(settings.resource_pool || '');
      setDatastore(settings.datastore || '');
      setDefaultOs(settings.default_os_template || 'Windows Server 2022');
      setDefaultCpu(String(settings.default_cpu));
      setDefaultRam(String(settings.default_ram_gb));
      setDefaultDisk(String(settings.default_disk_gb));
      setVlan(settings.network_vlan || '');
      setAllowedPorts((settings.allowed_ports || []).join(','));
      setVpnGateway(settings.vpn_gateway || '');
      setVpnType(settings.vpn_type || 'ipsec');
      setFirewallRules(JSON.stringify(settings.firewall_rules || [], null, 2));
      setSnapshotEnabled(settings.snapshot_enabled ?? true);
      setAutoShutdown(settings.auto_shutdown_hours ? String(settings.auto_shutdown_hours) : '');
      setNotes(settings.notes || '');
    }
  }, [settings]);

  const handleSave = () => {
    let rules: any[] = [];
    try { rules = JSON.parse(firewallRules || '[]'); } catch { rules = []; }

    onSave({
      environment_id: environmentId,
      vcenter_url: vcenterUrl || null,
      vcenter_username: vcenterUsername || null,
      vcenter_password_encrypted: vcenterPassword || null,
      datacenter: datacenter || null,
      cluster: cluster || null,
      resource_pool: resourcePool || null,
      datastore: datastore || null,
      default_os_template: defaultOs,
      default_cpu: parseInt(defaultCpu) || 4,
      default_ram_gb: parseInt(defaultRam) || 16,
      default_disk_gb: parseInt(defaultDisk) || 100,
      network_vlan: vlan || null,
      firewall_rules: rules,
      allowed_ports: allowedPorts.split(',').map(s => s.trim()).filter(Boolean),
      vpn_gateway: vpnGateway || null,
      vpn_type: vpnType,
      snapshot_enabled: snapshotEnabled,
      auto_shutdown_hours: autoShutdown ? parseInt(autoShutdown) : null,
      notes: notes || null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">{environmentName}</h3>
        {!readOnly && (
          <Button className="gradient-primary border-0 gap-1.5" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4" /> {t('common.save', 'Save Settings')}
          </Button>
        )}
      </div>

      <Tabs defaultValue="vcenter" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="vcenter" className="gap-1.5 text-xs">
            <Server className="w-3.5 h-3.5" /> vCenter
          </TabsTrigger>
          <TabsTrigger value="vm" className="gap-1.5 text-xs">
            <Cpu className="w-3.5 h-3.5" /> VM Defaults
          </TabsTrigger>
          <TabsTrigger value="network" className="gap-1.5 text-xs">
            <Shield className="w-3.5 h-3.5" /> Network
          </TabsTrigger>
        </TabsList>

        {/* vCenter Tab */}
        <TabsContent value="vcenter">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('vmware.vcenter_connection', 'vCenter / ESXi Connection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">{t('vmware.vcenter_url', 'vCenter URL')}</Label>
                <Input value={vcenterUrl} onChange={e => setVcenterUrl(e.target.value)} placeholder="https://vcenter.example.com" className="h-8 text-sm" readOnly={readOnly} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('vmware.username', 'Username')}</Label>
                  <Input value={vcenterUsername} onChange={e => setVcenterUsername(e.target.value)} placeholder="administrator@vsphere.local" className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{t('vmware.password', 'Password')}</Label>
                  <div className="relative">
                    <Input value={vcenterPassword} onChange={e => setVcenterPassword(e.target.value)}
                      type={showPassword ? 'text' : 'password'} placeholder="••••••••" className="h-8 text-sm pe-8" readOnly={readOnly} autoComplete="new-password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('vmware.datacenter', 'Datacenter')}</Label>
                  <Input value={datacenter} onChange={e => setDatacenter(e.target.value)} placeholder="DC-01" className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{t('vmware.cluster', 'Cluster')}</Label>
                  <Input value={cluster} onChange={e => setCluster(e.target.value)} placeholder="Cluster-SAP" className="h-8 text-sm" readOnly={readOnly} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('vmware.resource_pool', 'Resource Pool')}</Label>
                  <Input value={resourcePool} onChange={e => setResourcePool(e.target.value)} placeholder="SAP-Pool" className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{t('vmware.datastore', 'Datastore')}</Label>
                  <Input value={datastore} onChange={e => setDatastore(e.target.value)} placeholder="SAN-DS01" className="h-8 text-sm" readOnly={readOnly} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VM Defaults Tab */}
        <TabsContent value="vm">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('vmware.vm_defaults', 'VM Default Configuration')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">{t('vmware.os_template', 'OS Template')}</Label>
                <Select value={defaultOs} onValueChange={setDefaultOs} disabled={readOnly}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Windows Server 2022">Windows Server 2022</SelectItem>
                    <SelectItem value="Windows Server 2019">Windows Server 2019</SelectItem>
                    <SelectItem value="Windows 11">Windows 11</SelectItem>
                    <SelectItem value="Windows 10">Windows 10</SelectItem>
                    <SelectItem value="Ubuntu Server">Ubuntu Server</SelectItem>
                    <SelectItem value="RHEL">RHEL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">{t('vmware.cpu', 'vCPU Cores')}</Label>
                  <Input value={defaultCpu} onChange={e => setDefaultCpu(e.target.value)} type="number" min={1} max={64} className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{t('vmware.ram', 'RAM (GB)')}</Label>
                  <Input value={defaultRam} onChange={e => setDefaultRam(e.target.value)} type="number" min={1} max={512} className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{t('vmware.disk', 'Disk (GB)')}</Label>
                  <Input value={defaultDisk} onChange={e => setDefaultDisk(e.target.value)} type="number" min={20} max={2048} className="h-8 text-sm" readOnly={readOnly} />
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/20">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('vmware.snapshots', 'Enable Snapshots')}</p>
                  <p className="text-xs text-muted-foreground">{t('vmware.snapshots_desc', 'Automatically create snapshots before consultant sessions')}</p>
                </div>
                <Switch checked={snapshotEnabled} onCheckedChange={setSnapshotEnabled} disabled={readOnly} />
              </div>
              <div>
                <Label className="text-xs">{t('vmware.auto_shutdown', 'Auto-shutdown after (hours)')}</Label>
                <Input value={autoShutdown} onChange={e => setAutoShutdown(e.target.value)} type="number" placeholder="Leave empty to disable" className="h-8 text-sm" readOnly={readOnly} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Network Tab */}
        <TabsContent value="network">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('vmware.network_security', 'Network & Security')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('vmware.vlan', 'VLAN / Network')}</Label>
                  <Input value={vlan} onChange={e => setVlan(e.target.value)} placeholder="VLAN-SAP-100" className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{t('vmware.allowed_ports', 'Allowed Ports')}</Label>
                  <Input value={allowedPorts} onChange={e => setAllowedPorts(e.target.value)} placeholder="3389,22,443" className="h-8 text-sm" readOnly={readOnly} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Comma-separated</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('vmware.vpn_gateway', 'VPN Gateway')}</Label>
                  <Input value={vpnGateway} onChange={e => setVpnGateway(e.target.value)} placeholder="vpn.example.com" className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{t('vmware.vpn_type', 'VPN Type')}</Label>
                  <Select value={vpnType} onValueChange={setVpnType} disabled={readOnly}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ipsec">IPSec</SelectItem>
                      <SelectItem value="openvpn">OpenVPN</SelectItem>
                      <SelectItem value="wireguard">WireGuard</SelectItem>
                      <SelectItem value="ssl">SSL VPN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">{t('vmware.firewall_rules', 'Firewall Rules (JSON)')}</Label>
                <Textarea value={firewallRules} onChange={e => setFirewallRules(e.target.value)}
                  placeholder='[{"action":"allow","source":"10.0.0.0/8","port":3389}]'
                  rows={4} className="text-xs font-mono" readOnly={readOnly} />
              </div>
              <div>
                <Label className="text-xs">{t('vmware.notes_label', 'Notes')}</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional configuration notes..." rows={2} className="text-sm" readOnly={readOnly} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
