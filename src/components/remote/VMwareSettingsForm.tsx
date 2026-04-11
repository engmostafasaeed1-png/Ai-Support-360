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
import { Eye, EyeOff, Server, Cpu, Shield, Save, Cloud, Zap, DollarSign } from 'lucide-react';
import type { VMwareSettings } from '@/hooks/useVMwareSettings';
import HardwareCostCalculator from './HardwareCostCalculator';

const VENDORS = [
  { value: 'vmware', label: 'VMware vSphere', hypervisors: ['esxi', 'workstation'], icon: '🟢' },
  { value: 'aws', label: 'Amazon Web Services', hypervisors: ['nitro', 'xen'], icon: '🟠' },
  { value: 'azure', label: 'Microsoft Azure', hypervisors: ['hyper_v'], icon: '🔵' },
  { value: 'gcp', label: 'Google Cloud Platform', hypervisors: ['kvm'], icon: '🔴' },
  { value: 'oracle', label: 'Oracle Cloud (OCI)', hypervisors: ['kvm', 'xen'], icon: '🟤' },
  { value: 'proxmox', label: 'Proxmox VE', hypervisors: ['kvm', 'lxc'], icon: '🟡' },
  { value: 'hyper_v', label: 'Microsoft Hyper-V', hypervisors: ['hyper_v'], icon: '🟣' },
  { value: 'kvm', label: 'KVM / QEMU', hypervisors: ['kvm'], icon: '⚪' },
] as const;

const HYPERVISOR_LABELS: Record<string, string> = {
  esxi: 'ESXi',
  workstation: 'VMware Workstation',
  nitro: 'AWS Nitro',
  xen: 'Xen',
  hyper_v: 'Hyper-V',
  kvm: 'KVM',
  lxc: 'LXC',
};

const VENDOR_TEMPLATES: Record<string, { region: string; instanceType: string; storageType: string; os: string; cpu: string; ram: string; disk: string }> = {
  vmware: { region: '', instanceType: '', storageType: 'ssd', os: 'Windows Server 2022', cpu: '4', ram: '16', disk: '100' },
  aws: { region: 'us-east-1', instanceType: 'm5.xlarge', storageType: 'gp3', os: 'Windows Server 2022', cpu: '4', ram: '16', disk: '100' },
  azure: { region: 'eastus', instanceType: 'Standard_D4s_v3', storageType: 'premium-ssd', os: 'Windows Server 2022', cpu: '4', ram: '16', disk: '128' },
  gcp: { region: 'us-central1', instanceType: 'n2-standard-4', storageType: 'pd-ssd', os: 'Windows Server 2022', cpu: '4', ram: '16', disk: '100' },
  oracle: { region: 'us-ashburn-1', instanceType: 'VM.Standard3.Flex', storageType: 'iscsi', os: 'Windows Server 2022', cpu: '4', ram: '16', disk: '100' },
  proxmox: { region: '', instanceType: '', storageType: 'local-lvm', os: 'Ubuntu Server', cpu: '4', ram: '16', disk: '100' },
  hyper_v: { region: '', instanceType: '', storageType: 'vhdx', os: 'Windows Server 2022', cpu: '4', ram: '16', disk: '100' },
  kvm: { region: '', instanceType: '', storageType: 'qcow2', os: 'Ubuntu Server', cpu: '4', ram: '16', disk: '100' },
};

const STORAGE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  vmware: [{ value: 'ssd', label: 'SSD' }, { value: 'hdd', label: 'HDD' }, { value: 'nvme', label: 'NVMe' }],
  aws: [{ value: 'gp3', label: 'gp3 (SSD)' }, { value: 'gp2', label: 'gp2 (SSD)' }, { value: 'io2', label: 'io2 (Provisioned)' }, { value: 'st1', label: 'st1 (HDD)' }],
  azure: [{ value: 'premium-ssd', label: 'Premium SSD' }, { value: 'standard-ssd', label: 'Standard SSD' }, { value: 'ultra-disk', label: 'Ultra Disk' }, { value: 'standard-hdd', label: 'Standard HDD' }],
  gcp: [{ value: 'pd-ssd', label: 'SSD Persistent' }, { value: 'pd-balanced', label: 'Balanced' }, { value: 'pd-standard', label: 'Standard' }, { value: 'local-ssd', label: 'Local SSD' }],
  oracle: [{ value: 'iscsi', label: 'Block Volume' }, { value: 'nvme', label: 'NVMe' }],
  proxmox: [{ value: 'local-lvm', label: 'Local LVM' }, { value: 'ceph', label: 'Ceph' }, { value: 'zfs', label: 'ZFS' }],
  hyper_v: [{ value: 'vhdx', label: 'VHDX' }, { value: 'vhd', label: 'VHD' }],
  kvm: [{ value: 'qcow2', label: 'QCOW2' }, { value: 'raw', label: 'RAW' }],
};

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
  const [showApiKey, setShowApiKey] = useState(false);

  // Vendor & Hypervisor
  const [cloudVendor, setCloudVendor] = useState('vmware');
  const [hypervisorType, setHypervisorType] = useState('esxi');

  // vCenter / Connection
  const [vcenterUrl, setVcenterUrl] = useState('');
  const [vcenterUsername, setVcenterUsername] = useState('');
  const [vcenterPassword, setVcenterPassword] = useState('');
  const [datacenter, setDatacenter] = useState('');
  const [cluster, setCluster] = useState('');
  const [resourcePool, setResourcePool] = useState('');
  const [datastore, setDatastore] = useState('');

  // Cloud
  const [cloudRegion, setCloudRegion] = useState('');
  const [cloudAccountId, setCloudAccountId] = useState('');
  const [cloudProjectId, setCloudProjectId] = useState('');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudApiEndpoint, setCloudApiEndpoint] = useState('');
  const [instanceType, setInstanceType] = useState('');
  const [availabilityZone, setAvailabilityZone] = useState('');
  const [securityGroup, setSecurityGroup] = useState('');
  const [subnetId, setSubnetId] = useState('');
  const [storageType, setStorageType] = useState('ssd');

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
      setCloudVendor((settings as any).cloud_vendor || 'vmware');
      setHypervisorType((settings as any).hypervisor_type || 'esxi');
      setVcenterUrl(settings.vcenter_url || '');
      setVcenterUsername(settings.vcenter_username || '');
      setVcenterPassword(settings.vcenter_password_encrypted || '');
      setDatacenter(settings.datacenter || '');
      setCluster(settings.cluster || '');
      setResourcePool(settings.resource_pool || '');
      setDatastore(settings.datastore || '');
      setCloudRegion((settings as any).cloud_region || '');
      setCloudAccountId((settings as any).cloud_account_id || '');
      setCloudProjectId((settings as any).cloud_project_id || '');
      setCloudApiKey((settings as any).cloud_api_key_encrypted || '');
      setCloudApiEndpoint((settings as any).cloud_api_endpoint || '');
      setInstanceType((settings as any).instance_type || '');
      setAvailabilityZone((settings as any).availability_zone || '');
      setSecurityGroup((settings as any).security_group || '');
      setSubnetId((settings as any).subnet_id || '');
      setStorageType((settings as any).storage_type || 'ssd');
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

  const isCloudVendor = ['aws', 'azure', 'gcp', 'oracle'].includes(cloudVendor);
  const vendorObj = VENDORS.find(v => v.value === cloudVendor);
  const availableHypervisors = vendorObj?.hypervisors || ['esxi'];
  const storageOptions = STORAGE_OPTIONS[cloudVendor] || STORAGE_OPTIONS.vmware;

  const handleVendorChange = (vendor: string) => {
    setCloudVendor(vendor);
    const v = VENDORS.find(v => v.value === vendor);
    if (v) setHypervisorType(v.hypervisors[0]);
    const tpl = VENDOR_TEMPLATES[vendor];
    if (tpl) {
      setCloudRegion(tpl.region);
      setInstanceType(tpl.instanceType);
      setStorageType(tpl.storageType);
      setDefaultOs(tpl.os);
      setDefaultCpu(tpl.cpu);
      setDefaultRam(tpl.ram);
      setDefaultDisk(tpl.disk);
    }
  };

  const handleSave = () => {
    let rules: any[] = [];
    try { rules = JSON.parse(firewallRules || '[]'); } catch { rules = []; }

    onSave({
      environment_id: environmentId,
      cloud_vendor: cloudVendor,
      hypervisor_type: hypervisorType,
      vcenter_url: vcenterUrl || null,
      vcenter_username: vcenterUsername || null,
      vcenter_password_encrypted: vcenterPassword || null,
      datacenter: datacenter || null,
      cluster: cluster || null,
      resource_pool: resourcePool || null,
      datastore: datastore || null,
      cloud_region: cloudRegion || null,
      cloud_account_id: cloudAccountId || null,
      cloud_project_id: cloudProjectId || null,
      cloud_api_key_encrypted: cloudApiKey || null,
      cloud_api_endpoint: cloudApiEndpoint || null,
      instance_type: instanceType || null,
      availability_zone: availabilityZone || null,
      security_group: securityGroup || null,
      subnet_id: subnetId || null,
      storage_type: storageType || null,
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

  const connectionLabel = isCloudVendor
    ? `${vendorObj?.label} Connection`
    : cloudVendor === 'vmware' ? 'vCenter / ESXi Connection' : `${vendorObj?.label} Connection`;

  const accountLabel: Record<string, string> = {
    aws: 'AWS Account ID',
    azure: 'Subscription ID',
    gcp: 'Project ID',
    oracle: 'Tenancy OCID',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-lg font-semibold text-foreground truncate">{environmentName}</h3>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {vendorObj?.icon} {vendorObj?.label}
          </Badge>
        </div>
        {!readOnly && (
          <Button className="gradient-primary border-0 gap-1.5" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4" /> {t('common.save', 'Save Settings')}
          </Button>
        )}
      </div>

      {/* Vendor & Hypervisor Selector */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs flex items-center gap-1"><Cloud className="w-3 h-3" /> Cloud / Platform Vendor</Label>
              <Select value={cloudVendor} onValueChange={handleVendorChange} disabled={readOnly}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENDORS.map(v => (
                    <SelectItem key={v.value} value={v.value}>
                      <span className="flex items-center gap-2">{v.icon} {v.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Zap className="w-3 h-3" /> Hypervisor Type</Label>
              <Select value={hypervisorType} onValueChange={setHypervisorType} disabled={readOnly}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availableHypervisors.map(h => (
                    <SelectItem key={h} value={h}>{HYPERVISOR_LABELS[h] || h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="connection" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="connection" className="gap-1 text-[10px] sm:text-xs">
            <Server className="w-3.5 h-3.5" /> Connection
          </TabsTrigger>
          {isCloudVendor && (
            <TabsTrigger value="cloud" className="gap-1 text-[10px] sm:text-xs">
              <Cloud className="w-3.5 h-3.5" /> Cloud
            </TabsTrigger>
          )}
          <TabsTrigger value="vm" className="gap-1 text-[10px] sm:text-xs">
            <Cpu className="w-3.5 h-3.5" /> VM
          </TabsTrigger>
          <TabsTrigger value="hardware" className="gap-1 text-[10px] sm:text-xs">
            <DollarSign className="w-3.5 h-3.5" /> Cost
          </TabsTrigger>
          <TabsTrigger value="network" className="gap-1 text-[10px] sm:text-xs">
            <Shield className="w-3.5 h-3.5" /> Network
          </TabsTrigger>
        </TabsList>

        {/* Connection Tab */}
        <TabsContent value="connection">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{connectionLabel}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">{isCloudVendor ? 'API Endpoint / Console URL' : 'vCenter URL'}</Label>
                <Input value={vcenterUrl} onChange={e => setVcenterUrl(e.target.value)}
                  placeholder={isCloudVendor ? `https://console.${cloudVendor}.com` : 'https://vcenter.example.com'}
                  className="h-8 text-sm" readOnly={readOnly} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{isCloudVendor ? 'Access Key / Username' : 'Username'}</Label>
                  <Input value={vcenterUsername} onChange={e => setVcenterUsername(e.target.value)}
                    placeholder={isCloudVendor ? 'AKIA...' : 'administrator@vsphere.local'}
                    className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">{isCloudVendor ? 'Secret Key / Password' : 'Password'}</Label>
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
              {!isCloudVendor && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Datacenter</Label>
                      <Input value={datacenter} onChange={e => setDatacenter(e.target.value)} placeholder="DC-01" className="h-8 text-sm" readOnly={readOnly} />
                    </div>
                    <div>
                      <Label className="text-xs">Cluster</Label>
                      <Input value={cluster} onChange={e => setCluster(e.target.value)} placeholder="Cluster-SAP" className="h-8 text-sm" readOnly={readOnly} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Resource Pool</Label>
                      <Input value={resourcePool} onChange={e => setResourcePool(e.target.value)} placeholder="SAP-Pool" className="h-8 text-sm" readOnly={readOnly} />
                    </div>
                    <div>
                      <Label className="text-xs">Datastore</Label>
                      <Input value={datastore} onChange={e => setDatastore(e.target.value)} placeholder="SAN-DS01" className="h-8 text-sm" readOnly={readOnly} />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cloud Tab (only for cloud vendors) */}
        {isCloudVendor && (
          <TabsContent value="cloud">
            <Card className="rounded-2xl border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{vendorObj?.label} Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Region</Label>
                    <Input value={cloudRegion} onChange={e => setCloudRegion(e.target.value)}
                      placeholder={VENDOR_TEMPLATES[cloudVendor]?.region || 'us-east-1'}
                      className="h-8 text-sm" readOnly={readOnly} />
                  </div>
                  <div>
                    <Label className="text-xs">Availability Zone</Label>
                    <Input value={availabilityZone} onChange={e => setAvailabilityZone(e.target.value)}
                      placeholder={`${cloudRegion || 'us-east-1'}a`}
                      className="h-8 text-sm" readOnly={readOnly} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">{accountLabel[cloudVendor] || 'Account ID'}</Label>
                    <Input value={cloudAccountId} onChange={e => setCloudAccountId(e.target.value)}
                      placeholder="123456789012" className="h-8 text-sm" readOnly={readOnly} />
                  </div>
                  <div>
                    <Label className="text-xs">Project / Resource Group</Label>
                    <Input value={cloudProjectId} onChange={e => setCloudProjectId(e.target.value)}
                      placeholder="my-project" className="h-8 text-sm" readOnly={readOnly} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">API Key / Service Account Key</Label>
                  <div className="relative">
                    <Input value={cloudApiKey} onChange={e => setCloudApiKey(e.target.value)}
                      type={showApiKey ? 'text' : 'password'} placeholder="••••••••" className="h-8 text-sm pe-8" readOnly={readOnly} />
                    <button type="button" onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Custom API Endpoint</Label>
                  <Input value={cloudApiEndpoint} onChange={e => setCloudApiEndpoint(e.target.value)}
                    placeholder={`https://api.${cloudVendor}.com`} className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Instance Type</Label>
                    <Input value={instanceType} onChange={e => setInstanceType(e.target.value)}
                      placeholder={VENDOR_TEMPLATES[cloudVendor]?.instanceType || 'm5.xlarge'}
                      className="h-8 text-sm" readOnly={readOnly} />
                  </div>
                  <div>
                    <Label className="text-xs">Security Group / NSG</Label>
                    <Input value={securityGroup} onChange={e => setSecurityGroup(e.target.value)}
                      placeholder="sg-0123456789" className="h-8 text-sm" readOnly={readOnly} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Subnet ID</Label>
                  <Input value={subnetId} onChange={e => setSubnetId(e.target.value)}
                    placeholder="subnet-abc123" className="h-8 text-sm" readOnly={readOnly} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* VM Defaults Tab */}
        <TabsContent value="vm">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">VM Default Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">OS Template</Label>
                  <Select value={defaultOs} onValueChange={setDefaultOs} disabled={readOnly}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Windows Server 2022">Windows Server 2022</SelectItem>
                      <SelectItem value="Windows Server 2019">Windows Server 2019</SelectItem>
                      <SelectItem value="Windows 11">Windows 11</SelectItem>
                      <SelectItem value="Windows 10">Windows 10</SelectItem>
                      <SelectItem value="Ubuntu Server">Ubuntu Server</SelectItem>
                      <SelectItem value="RHEL">RHEL</SelectItem>
                      <SelectItem value="SLES">SUSE Linux Enterprise</SelectItem>
                      <SelectItem value="Amazon Linux">Amazon Linux</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Storage Type</Label>
                  <Select value={storageType} onValueChange={setStorageType} disabled={readOnly}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {storageOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">vCPU Cores</Label>
                  <Input value={defaultCpu} onChange={e => setDefaultCpu(e.target.value)} type="number" min={1} max={128} className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">RAM (GB)</Label>
                  <Input value={defaultRam} onChange={e => setDefaultRam(e.target.value)} type="number" min={1} max={1024} className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">Disk (GB)</Label>
                  <Input value={defaultDisk} onChange={e => setDefaultDisk(e.target.value)} type="number" min={20} max={4096} className="h-8 text-sm" readOnly={readOnly} />
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/20">
                <div>
                  <p className="text-sm font-medium text-foreground">Enable Snapshots</p>
                  <p className="text-xs text-muted-foreground">Auto-create snapshots before sessions</p>
                </div>
                <Switch checked={snapshotEnabled} onCheckedChange={setSnapshotEnabled} disabled={readOnly} />
              </div>
              <div>
                <Label className="text-xs">Auto-shutdown after (hours)</Label>
                <Input value={autoShutdown} onChange={e => setAutoShutdown(e.target.value)} type="number" placeholder="Leave empty to disable" className="h-8 text-sm" readOnly={readOnly} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Hardware Cost Calculator Tab */}
        <TabsContent value="hardware">
          <HardwareCostCalculator
            readOnly={readOnly}
            initialConfig={{
              cpuCores: parseInt(defaultCpu) || 4,
              ramGb: parseInt(defaultRam) || 16,
              diskGb: parseInt(defaultDisk) || 100,
            }}
          />
        </TabsContent>

        {/* Network Tab */}
        <TabsContent value="network">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Network & Security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{isCloudVendor ? 'VPC / Network' : 'VLAN / Network'}</Label>
                  <Input value={vlan} onChange={e => setVlan(e.target.value)} placeholder={isCloudVendor ? 'vpc-abc123' : 'VLAN-SAP-100'} className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">Allowed Ports</Label>
                  <Input value={allowedPorts} onChange={e => setAllowedPorts(e.target.value)} placeholder="3389,22,443" className="h-8 text-sm" readOnly={readOnly} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Comma-separated</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">VPN Gateway</Label>
                  <Input value={vpnGateway} onChange={e => setVpnGateway(e.target.value)} placeholder="vpn.example.com" className="h-8 text-sm" readOnly={readOnly} />
                </div>
                <div>
                  <Label className="text-xs">VPN Type</Label>
                  <Select value={vpnType} onValueChange={setVpnType} disabled={readOnly}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ipsec">IPSec</SelectItem>
                      <SelectItem value="openvpn">OpenVPN</SelectItem>
                      <SelectItem value="wireguard">WireGuard</SelectItem>
                      <SelectItem value="ssl">SSL VPN</SelectItem>
                      {isCloudVendor && <SelectItem value="cloud-vpn">Cloud VPN</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Firewall Rules (JSON)</Label>
                <Textarea value={firewallRules} onChange={e => setFirewallRules(e.target.value)}
                  placeholder='[{"action":"allow","source":"10.0.0.0/8","port":3389}]'
                  rows={4} className="text-xs font-mono" readOnly={readOnly} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional configuration notes..." rows={2} className="text-sm" readOnly={readOnly} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
