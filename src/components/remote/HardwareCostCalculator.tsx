import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Cpu, MemoryStick, HardDrive, MonitorSpeaker, Network, Shield, Clock,
  Database, Monitor, Zap, DollarSign, TrendingUp, Server,
} from 'lucide-react';

// ── Pricing tables (per-hour rates in USD) ──
const CPU_TYPES = [
  { value: 'shared', label: 'Shared vCPU', rate: 0.008, desc: 'Burstable, best-effort' },
  { value: 'dedicated', label: 'Dedicated vCPU', rate: 0.035, desc: 'Guaranteed compute' },
  { value: 'high-freq', label: 'High-Frequency vCPU', rate: 0.05, desc: '4.0 GHz+, single-thread optimized' },
  { value: 'compute-opt', label: 'Compute-Optimized', rate: 0.065, desc: 'Best for SAP HANA, heavy workloads' },
];

const RAM_TIERS = [
  { value: 'standard', label: 'Standard DDR4', rate: 0.005, desc: 'Up to 3200 MHz' },
  { value: 'high-bandwidth', label: 'High-Bandwidth DDR5', rate: 0.008, desc: '4800 MHz+, ECC' },
  { value: 'persistent', label: 'Persistent Memory (PMem)', rate: 0.012, desc: 'Intel Optane, ultra-low latency' },
];

const DISK_TYPES = [
  { value: 'hdd', label: 'Standard HDD', ratePerGb: 0.00004, iopsBase: 500, desc: '7200 RPM' },
  { value: 'ssd', label: 'SSD (General)', ratePerGb: 0.00012, iopsBase: 3000, desc: 'Balanced performance' },
  { value: 'nvme', label: 'NVMe SSD', ratePerGb: 0.00025, iopsBase: 16000, desc: 'Ultra-fast I/O' },
  { value: 'ultra', label: 'Ultra Disk', ratePerGb: 0.0005, iopsBase: 64000, desc: 'Provisioned IOPS' },
];

const GPU_OPTIONS = [
  { value: 'none', label: 'No GPU', rate: 0, vram: 0 },
  { value: 't4', label: 'NVIDIA T4 (16 GB)', rate: 0.35, vram: 16 },
  { value: 'a10g', label: 'NVIDIA A10G (24 GB)', rate: 0.75, vram: 24 },
  { value: 'a100-40', label: 'NVIDIA A100 40 GB', rate: 2.50, vram: 40 },
  { value: 'a100-80', label: 'NVIDIA A100 80 GB', rate: 4.00, vram: 80 },
  { value: 'l4', label: 'NVIDIA L4 (24 GB)', rate: 0.55, vram: 24 },
];

const NETWORK_TIERS = [
  { value: 'standard', label: 'Standard (up to 1 Gbps)', rate: 0 },
  { value: 'enhanced', label: 'Enhanced (up to 10 Gbps)', rate: 0.02 },
  { value: 'premium', label: 'Premium (up to 25 Gbps)', rate: 0.06 },
  { value: 'ultra', label: 'Ultra (up to 100 Gbps)', rate: 0.15 },
];

const OS_LICENSES = [
  { value: 'linux', label: 'Linux (Free)', rate: 0 },
  { value: 'win-std', label: 'Windows Server Standard', rate: 0.023 },
  { value: 'win-dc', label: 'Windows Server Datacenter', rate: 0.069 },
  { value: 'rhel', label: 'RHEL', rate: 0.013 },
  { value: 'sles', label: 'SUSE SLES', rate: 0.011 },
  { value: 'win-sql-std', label: 'Windows + SQL Server Std', rate: 0.23 },
  { value: 'win-sql-ent', label: 'Windows + SQL Server Ent', rate: 0.95 },
];

const BACKUP_OPTIONS = [
  { value: 'none', label: 'No Backup', rate: 0, desc: '' },
  { value: 'daily', label: 'Daily Backup', ratePerGb: 0.00003, desc: '7-day retention' },
  { value: 'hourly', label: 'Hourly Backup', ratePerGb: 0.00008, desc: '24h retention + daily 30d' },
  { value: 'continuous', label: 'Continuous (CDP)', ratePerGb: 0.00015, desc: 'Point-in-time recovery' },
];

interface HardwareCostCalculatorProps {
  readOnly?: boolean;
  onConfigChange?: (config: HardwareConfig) => void;
  initialConfig?: Partial<HardwareConfig>;
}

export interface HardwareConfig {
  cpuType: string;
  cpuCores: number;
  ramType: string;
  ramGb: number;
  diskType: string;
  diskGb: number;
  diskIops: number;
  gpu: string;
  gpuCount: number;
  networkTier: string;
  osLicense: string;
  backupOption: string;
  haEnabled: boolean;
  drsEnabled: boolean;
  encryptionAtRest: boolean;
  dedicatedHost: boolean;
  supportTier: string;
  reservationTerm: string;
}

const DEFAULT_CONFIG: HardwareConfig = {
  cpuType: 'dedicated',
  cpuCores: 4,
  ramType: 'standard',
  ramGb: 16,
  diskType: 'ssd',
  diskGb: 100,
  diskIops: 3000,
  gpu: 'none',
  gpuCount: 1,
  networkTier: 'standard',
  osLicense: 'linux',
  backupOption: 'daily',
  haEnabled: false,
  drsEnabled: false,
  encryptionAtRest: false,
  dedicatedHost: false,
  supportTier: 'basic',
  reservationTerm: 'on-demand',
};

const SUPPORT_RATES: Record<string, number> = { basic: 0, standard: 29, premium: 99, enterprise: 299 };
const RESERVATION_DISCOUNTS: Record<string, number> = { 'on-demand': 1, '1-year': 0.72, '3-year': 0.55 };

export default function HardwareCostCalculator({
  readOnly = false,
  onConfigChange,
  initialConfig,
}: HardwareCostCalculatorProps) {
  const [config, setConfig] = useState<HardwareConfig>({ ...DEFAULT_CONFIG, ...initialConfig });

  const update = <K extends keyof HardwareConfig>(key: K, value: HardwareConfig[K]) => {
    const next = { ...config, [key]: value };
    // Auto-adjust IOPS base when disk type changes
    if (key === 'diskType') {
      const dt = DISK_TYPES.find(d => d.value === value);
      if (dt) next.diskIops = dt.iopsBase;
    }
    setConfig(next);
    onConfigChange?.(next);
  };

  const cost = useMemo(() => {
    const cpuRate = (CPU_TYPES.find(c => c.value === config.cpuType)?.rate || 0.035) * config.cpuCores;
    const ramRate = (RAM_TIERS.find(r => r.value === config.ramType)?.rate || 0.005) * config.ramGb;
    const diskInfo = DISK_TYPES.find(d => d.value === config.diskType);
    const diskRate = (diskInfo?.ratePerGb || 0.00012) * config.diskGb;
    const iopsExtra = Math.max(0, config.diskIops - (diskInfo?.iopsBase || 3000)) * 0.000005;
    const gpuInfo = GPU_OPTIONS.find(g => g.value === config.gpu);
    const gpuRate = (gpuInfo?.rate || 0) * (config.gpu !== 'none' ? config.gpuCount : 0);
    const netRate = NETWORK_TIERS.find(n => n.value === config.networkTier)?.rate || 0;
    const osRate = OS_LICENSES.find(o => o.value === config.osLicense)?.rate || 0;
    const backupOpt = BACKUP_OPTIONS.find(b => b.value === config.backupOption);
    const backupRate = backupOpt && 'ratePerGb' in backupOpt ? (backupOpt.ratePerGb || 0) * config.diskGb : 0;
    const haMultiplier = config.haEnabled ? 1.3 : 1;
    const drsAdd = config.drsEnabled ? 0.01 * config.cpuCores : 0;
    const encryptionAdd = config.encryptionAtRest ? 0.005 : 0;
    const dedicatedAdd = config.dedicatedHost ? 0.5 : 0;
    const supportMonthly = SUPPORT_RATES[config.supportTier] || 0;
    const reservationMult = RESERVATION_DISCOUNTS[config.reservationTerm] || 1;

    const hourlyBase = (cpuRate + ramRate + diskRate + iopsExtra + gpuRate + netRate + osRate + backupRate + drsAdd + encryptionAdd + dedicatedAdd) * haMultiplier;
    const hourly = hourlyBase * reservationMult;
    const monthly = hourly * 730 + supportMonthly;
    const yearly = monthly * 12;

    return {
      hourly: Math.round(hourly * 10000) / 10000,
      monthly: Math.round(monthly * 100) / 100,
      yearly: Math.round(yearly * 100) / 100,
      breakdown: {
        compute: Math.round(cpuRate * 730 * reservationMult * 100) / 100,
        memory: Math.round(ramRate * 730 * reservationMult * 100) / 100,
        storage: Math.round((diskRate + iopsExtra) * 730 * reservationMult * 100) / 100,
        gpu: Math.round(gpuRate * 730 * reservationMult * 100) / 100,
        network: Math.round(netRate * 730 * reservationMult * 100) / 100,
        licensing: Math.round(osRate * 730 * reservationMult * 100) / 100,
        backup: Math.round(backupRate * 730 * reservationMult * 100) / 100,
        addons: Math.round((drsAdd + encryptionAdd + dedicatedAdd + (config.haEnabled ? hourlyBase * 0.3 / haMultiplier : 0)) * 730 * reservationMult * 100) / 100,
        support: supportMonthly,
      },
    };
  }, [config]);

  const savingsPercent = config.reservationTerm !== 'on-demand'
    ? Math.round((1 - (RESERVATION_DISCOUNTS[config.reservationTerm] || 1)) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Cost Summary - always visible */}
      <Card className="rounded-2xl border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              <span className="font-semibold text-foreground">Estimated Cost</span>
            </div>
            {savingsPercent > 0 && (
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">
                <TrendingUp className="w-3 h-3 mr-1" /> Save {savingsPercent}%
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] text-muted-foreground">Hourly</p>
              <p className="text-lg font-bold text-foreground">${cost.hourly}</p>
            </div>
            <div className="border-x border-border/40">
              <p className="text-[10px] text-muted-foreground">Monthly</p>
              <p className="text-lg font-bold text-primary">${cost.monthly.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Yearly</p>
              <p className="text-lg font-bold text-foreground">${cost.yearly.toLocaleString()}</p>
            </div>
          </div>

          {/* Cost breakdown */}
          <Separator className="my-3" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            {[
              { label: 'Compute', val: cost.breakdown.compute, icon: Cpu },
              { label: 'Memory', val: cost.breakdown.memory, icon: MemoryStick },
              { label: 'Storage', val: cost.breakdown.storage, icon: HardDrive },
              { label: 'GPU', val: cost.breakdown.gpu, icon: MonitorSpeaker },
              { label: 'Network', val: cost.breakdown.network, icon: Network },
              { label: 'Licensing', val: cost.breakdown.licensing, icon: Monitor },
              { label: 'Backup', val: cost.breakdown.backup, icon: Database },
              { label: 'Add-ons', val: cost.breakdown.addons, icon: Shield },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1.5 p-1.5 rounded-lg bg-background/50">
                <item.icon className="w-3 h-3 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-muted-foreground truncate">{item.label}</p>
                  <p className="font-medium text-foreground">${item.val}/mo</p>
                </div>
              </div>
            ))}
          </div>
          {cost.breakdown.support > 0 && (
            <p className="text-[10px] text-muted-foreground mt-2">+ ${cost.breakdown.support}/mo support</p>
          )}
        </CardContent>
      </Card>

      {/* Compute */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" /> Compute</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">CPU Type</Label>
            <Select value={config.cpuType} onValueChange={v => update('cpuType', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CPU_TYPES.map(c => (
                  <SelectItem key={c.value} value={c.value}>
                    <div className="flex justify-between w-full gap-4">
                      <span>{c.label}</span>
                      <span className="text-muted-foreground text-[10px]">${c.rate}/core/hr</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-0.5">{CPU_TYPES.find(c => c.value === config.cpuType)?.desc}</p>
          </div>
          <div>
            <div className="flex justify-between">
              <Label className="text-xs">vCPU Cores</Label>
              <span className="text-xs font-medium text-primary">{config.cpuCores} cores</span>
            </div>
            <Slider value={[config.cpuCores]} onValueChange={([v]) => update('cpuCores', v)} min={1} max={128} step={1} disabled={readOnly} className="mt-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>1</span><span>32</span><span>64</span><span>128</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Memory */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><MemoryStick className="w-4 h-4 text-primary" /> Memory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Memory Type</Label>
            <Select value={config.ramType} onValueChange={v => update('ramType', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RAM_TIERS.map(r => (
                  <SelectItem key={r.value} value={r.value}>
                    <div className="flex justify-between w-full gap-4">
                      <span>{r.label}</span>
                      <span className="text-muted-foreground text-[10px]">${r.rate}/GB/hr</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-0.5">{RAM_TIERS.find(r => r.value === config.ramType)?.desc}</p>
          </div>
          <div>
            <div className="flex justify-between">
              <Label className="text-xs">RAM</Label>
              <span className="text-xs font-medium text-primary">{config.ramGb} GB</span>
            </div>
            <Slider value={[config.ramGb]} onValueChange={([v]) => update('ramGb', v)} min={1} max={1024} step={1} disabled={readOnly} className="mt-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>1 GB</span><span>256</span><span>512</span><span>1 TB</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Storage */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><HardDrive className="w-4 h-4 text-primary" /> Storage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Disk Type</Label>
            <Select value={config.diskType} onValueChange={v => update('diskType', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISK_TYPES.map(d => (
                  <SelectItem key={d.value} value={d.value}>
                    <div className="flex justify-between w-full gap-4">
                      <span>{d.label}</span>
                      <span className="text-muted-foreground text-[10px]">${d.ratePerGb}/GB/hr</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-0.5">{DISK_TYPES.find(d => d.value === config.diskType)?.desc}</p>
          </div>
          <div>
            <div className="flex justify-between">
              <Label className="text-xs">Disk Size</Label>
              <span className="text-xs font-medium text-primary">{config.diskGb} GB</span>
            </div>
            <Slider value={[config.diskGb]} onValueChange={([v]) => update('diskGb', v)} min={20} max={4096} step={10} disabled={readOnly} className="mt-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>20 GB</span><span>1 TB</span><span>2 TB</span><span>4 TB</span></div>
          </div>
          <div>
            <div className="flex justify-between">
              <Label className="text-xs">Provisioned IOPS</Label>
              <span className="text-xs font-medium text-primary">{config.diskIops.toLocaleString()} IOPS</span>
            </div>
            <Slider value={[config.diskIops]} onValueChange={([v]) => update('diskIops', v)} min={100} max={64000} step={100} disabled={readOnly} className="mt-2" />
          </div>
        </CardContent>
      </Card>

      {/* GPU */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><MonitorSpeaker className="w-4 h-4 text-primary" /> GPU Acceleration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">GPU Model</Label>
            <Select value={config.gpu} onValueChange={v => update('gpu', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GPU_OPTIONS.map(g => (
                  <SelectItem key={g.value} value={g.value}>
                    <div className="flex justify-between w-full gap-4">
                      <span>{g.label}</span>
                      {g.rate > 0 && <span className="text-muted-foreground text-[10px]">${g.rate}/hr</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {config.gpu !== 'none' && (
            <div>
              <div className="flex justify-between">
                <Label className="text-xs">GPU Count</Label>
                <span className="text-xs font-medium text-primary">{config.gpuCount}</span>
              </div>
              <Slider value={[config.gpuCount]} onValueChange={([v]) => update('gpuCount', v)} min={1} max={8} step={1} disabled={readOnly} className="mt-2" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Network & Licensing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Network className="w-4 h-4 text-primary" /> Network</CardTitle>
          </CardHeader>
          <CardContent>
            <Label className="text-xs">Network Tier</Label>
            <Select value={config.networkTier} onValueChange={v => update('networkTier', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {NETWORK_TIERS.map(n => (
                  <SelectItem key={n.value} value={n.value}>{n.label}{n.rate > 0 ? ` (+$${n.rate}/hr)` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Monitor className="w-4 h-4 text-primary" /> OS License</CardTitle>
          </CardHeader>
          <CardContent>
            <Label className="text-xs">Operating System</Label>
            <Select value={config.osLicense} onValueChange={v => update('osLicense', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OS_LICENSES.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}{o.rate > 0 ? ` (+$${o.rate}/hr)` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {/* Backup */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Database className="w-4 h-4 text-primary" /> Backup & Recovery</CardTitle>
        </CardHeader>
        <CardContent>
          <Label className="text-xs">Backup Strategy</Label>
          <Select value={config.backupOption} onValueChange={v => update('backupOption', v)} disabled={readOnly}>
            <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BACKUP_OPTIONS.map(b => (
                <SelectItem key={b.value} value={b.value}>
                  <span>{b.label}</span>
                  {b.desc && <span className="text-muted-foreground text-[10px] ml-2">— {b.desc}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Add-ons */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Add-ons & Availability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: 'haEnabled' as const, label: 'High Availability (HA)', desc: '+30% compute cost for failover', icon: Zap },
            { key: 'drsEnabled' as const, label: 'DRS / Auto-scaling', desc: 'Dynamic resource balancing', icon: TrendingUp },
            { key: 'encryptionAtRest' as const, label: 'Encryption at Rest', desc: 'AES-256 disk encryption', icon: Shield },
            { key: 'dedicatedHost' as const, label: 'Dedicated Host', desc: 'Physical server isolation', icon: Server },
          ].map(addon => (
            <div key={addon.key} className="flex items-center justify-between p-2.5 rounded-xl border border-border/40 bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <addon.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{addon.label}</p>
                  <p className="text-[10px] text-muted-foreground">{addon.desc}</p>
                </div>
              </div>
              <Switch checked={config[addon.key]} onCheckedChange={v => update(addon.key, v)} disabled={readOnly} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Support & Reservation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Support Tier</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={config.supportTier} onValueChange={v => update('supportTier', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">Basic (Free)</SelectItem>
                <SelectItem value="standard">Standard ($29/mo)</SelectItem>
                <SelectItem value="premium">Premium ($99/mo)</SelectItem>
                <SelectItem value="enterprise">Enterprise ($299/mo)</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Reservation</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={config.reservationTerm} onValueChange={v => update('reservationTerm', v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on-demand">On-Demand (no discount)</SelectItem>
                <SelectItem value="1-year">1-Year Reserved (28% off)</SelectItem>
                <SelectItem value="3-year">3-Year Reserved (45% off)</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
