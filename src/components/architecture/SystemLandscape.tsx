import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Network, Database, Globe, Server, HardDrive, Lock, BarChart3, Zap,
  Layers, ArrowRight, Workflow, MonitorSmartphone, Shield, Cloud,
  Activity, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Info
} from 'lucide-react';

interface SystemComponent {
  name: string;
  type: string;
  status: 'active' | 'planned' | 'deprecated';
  icon: typeof Database;
  color: string;
  version: string;
  environment: string;
  host: string;
  owner: string;
  description: string;
  dependencies: string[];
  linkedTickets: number;
}

const components: SystemComponent[] = [
  { name: 'SAP S/4HANA', type: 'Core ERP', status: 'active', icon: Database, color: 'text-primary',
    version: '2023 FPS02', environment: 'Production', host: 'Azure East US', owner: 'SAP Basis Team',
    description: 'Central ERP system handling finance, logistics, and manufacturing processes.',
    dependencies: ['SAP CPI', 'SAP Fiori', 'HANA DB'], linkedTickets: 12 },
  { name: 'SAP BTP', type: 'Platform', status: 'active', icon: Globe, color: 'text-blue-500',
    version: 'Cloud Foundry', environment: 'Production', host: 'SAP DC EU10', owner: 'Platform Team',
    description: 'Business Technology Platform for extensions, integrations, and innovation.',
    dependencies: ['SAP S/4HANA', 'SAP CPI'], linkedTickets: 5 },
  { name: 'SAP CPI', type: 'Integration', status: 'active', icon: Network, color: 'text-emerald-500',
    version: '6.50', environment: 'Production', host: 'SAP DC EU10', owner: 'Integration Team',
    description: 'Cloud Platform Integration for A2A and B2B integration scenarios.',
    dependencies: ['SAP S/4HANA', 'SAP BTP', 'External Systems'], linkedTickets: 8 },
  { name: 'SAP BW/4HANA', type: 'Analytics', status: 'planned', icon: BarChart3, color: 'text-purple-500',
    version: '2.0 SP08', environment: 'Development', host: 'Azure East US', owner: 'BI Team',
    description: 'Next-gen data warehouse for complex analytics and historical reporting.',
    dependencies: ['SAP S/4HANA', 'SAP Analytics Cloud'], linkedTickets: 3 },
  { name: 'SAP Fiori', type: 'UX Layer', status: 'active', icon: MonitorSmartphone, color: 'text-orange-500',
    version: '3.0', environment: 'Production', host: 'Azure CDN', owner: 'UX Team',
    description: 'Modern user experience layer with role-based launchpads and responsive apps.',
    dependencies: ['SAP S/4HANA', 'SAP Gateway'], linkedTickets: 6 },
  { name: 'Azure Infrastructure', type: 'IaaS', status: 'active', icon: Cloud, color: 'text-cyan-500',
    version: 'N/A', environment: 'Production', host: 'East US / West EU', owner: 'Infrastructure Team',
    description: 'Cloud infrastructure providing compute, storage, networking, and DR capabilities.',
    dependencies: [], linkedTickets: 4 },
  { name: 'SAP GRC', type: 'Governance', status: 'planned', icon: Lock, color: 'text-red-500',
    version: '12.0', environment: 'Planned', host: 'Azure East US', owner: 'Compliance Team',
    description: 'Governance, Risk, and Compliance for access control, risk management, and audit.',
    dependencies: ['SAP S/4HANA'], linkedTickets: 2 },
  { name: 'SAP Analytics Cloud', type: 'BI/Planning', status: 'planned', icon: Zap, color: 'text-amber-500',
    version: 'Cloud', environment: 'Planned', host: 'SAP DC', owner: 'Analytics Team',
    description: 'Cloud-based analytics, planning, and predictive capabilities.',
    dependencies: ['SAP BW/4HANA', 'SAP S/4HANA'], linkedTickets: 1 },
  { name: 'HANA Database', type: 'Database', status: 'active', icon: HardDrive, color: 'text-teal-500',
    version: '2.0 SPS07', environment: 'Production', host: 'Azure VM', owner: 'DBA Team',
    description: 'In-memory database powering S/4HANA and BW/4HANA with column-store engine.',
    dependencies: ['Azure Infrastructure'], linkedTickets: 3 },
  { name: 'SAP Solution Manager', type: 'ALM', status: 'active', icon: Shield, color: 'text-indigo-500',
    version: '7.2 SP16', environment: 'Production', host: 'Azure East US', owner: 'SAP Basis Team',
    description: 'Application lifecycle management, monitoring, and change management.',
    dependencies: ['SAP S/4HANA'], linkedTickets: 2 },
  { name: 'SAP Gateway', type: 'API Layer', status: 'active', icon: Server, color: 'text-pink-500',
    version: '7.55', environment: 'Production', host: 'Azure East US', owner: 'Basis Team',
    description: 'OData service layer connecting Fiori apps with SAP backend systems.',
    dependencies: ['SAP S/4HANA', 'SAP Fiori'], linkedTickets: 4 },
  { name: 'External Systems', type: 'Third-Party', status: 'active', icon: Globe, color: 'text-slate-500',
    version: 'Various', environment: 'Production', host: 'Various', owner: 'IT Operations',
    description: 'Third-party systems including banking, logistics providers, and e-commerce platforms.',
    dependencies: ['SAP CPI'], linkedTickets: 5 },
];

const integrationFlows = [
  { from: 'SAP S/4HANA', to: 'SAP CPI', protocol: 'IDoc/OData', type: 'Bidirectional' },
  { from: 'SAP CPI', to: 'External Systems', protocol: 'REST/SOAP', type: 'Bidirectional' },
  { from: 'SAP S/4HANA', to: 'SAP BW/4HANA', protocol: 'SLT/ODP', type: 'Outbound' },
  { from: 'SAP S/4HANA', to: 'SAP Fiori', protocol: 'OData', type: 'Bidirectional' },
  { from: 'SAP BW/4HANA', to: 'SAP Analytics Cloud', protocol: 'Live/Import', type: 'Outbound' },
  { from: 'SAP BTP', to: 'SAP S/4HANA', protocol: 'API/Events', type: 'Bidirectional' },
];

const layers = [
  { name: 'Presentation Layer', items: ['SAP Fiori', 'SAP Analytics Cloud', 'Mobile Apps'], color: 'bg-primary/10 border-primary/20' },
  { name: 'Application Layer', items: ['SAP S/4HANA', 'SAP BTP Extensions', 'SAP GRC'], color: 'bg-accent/10 border-accent/20' },
  { name: 'Integration Layer', items: ['SAP CPI', 'SAP Gateway', 'API Management'], color: 'bg-emerald-500/10 border-emerald-200' },
  { name: 'Data Layer', items: ['HANA DB', 'SAP BW/4HANA', 'Data Lake'], color: 'bg-purple-500/10 border-purple-200' },
  { name: 'Infrastructure Layer', items: ['Azure VMs', 'Azure Storage', 'Azure Networking'], color: 'bg-cyan-500/10 border-cyan-200' },
];

export default function SystemLandscape() {
  const [selectedComp, setSelectedComp] = useState<SystemComponent | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'layers'>('grid');

  const activeCount = components.filter(c => c.status === 'active').length;
  const plannedCount = components.filter(c => c.status === 'planned').length;

  return (
    <div className="space-y-5">
      {/* View toggle & summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs">
            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-500" />{activeCount} Active
          </Badge>
          <Badge variant="secondary" className="text-xs">
            <Activity className="w-3 h-3 mr-1 text-blue-500" />{plannedCount} Planned
          </Badge>
          <Badge variant="secondary" className="text-xs">{components.length} Total</Badge>
        </div>
        <div className="flex gap-1">
          <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="sm" className="text-xs h-8" onClick={() => setViewMode('grid')}>Component Grid</Button>
          <Button variant={viewMode === 'layers' ? 'default' : 'ghost'} size="sm" className="text-xs h-8" onClick={() => setViewMode('layers')}>Architecture Layers</Button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <>
          {/* Component Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {components.map((comp) => {
              const Icon = comp.icon;
              return (
                <Card key={comp.name} className="rounded-2xl border-border/50 hover:shadow-premium transition-all cursor-pointer group" onClick={() => setSelectedComp(comp)}>
                  <CardContent className="pt-5 pb-4 text-center space-y-2">
                    <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Icon className={`w-6 h-6 ${comp.color}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{comp.name}</p>
                      <p className="text-[10px] text-muted-foreground">{comp.type}</p>
                    </div>
                    <Badge variant="outline" className={`text-[9px] ${comp.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' : comp.status === 'planned' ? 'bg-blue-500/10 text-blue-600 border-blue-200' : 'bg-red-500/10 text-red-500'}`}>
                      {comp.status}
                    </Badge>
                    <p className="text-[10px] text-muted-foreground">{comp.version}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Integration Flows */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Workflow className="w-4 h-4 text-primary" />
                Integration Flows
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {integrationFlows.map((flow, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/20 hover:bg-muted/40 transition-colors text-sm">
                    <Badge variant="outline" className="text-[10px] shrink-0 bg-primary/5">{flow.from}</Badge>
                    <ArrowRight className="w-4 h-4 text-accent shrink-0" />
                    <Badge variant="outline" className="text-[10px] shrink-0 bg-primary/5">{flow.to}</Badge>
                    <Badge variant="secondary" className="text-[9px] ml-auto shrink-0">{flow.protocol}</Badge>
                    <Badge variant="outline" className="text-[9px] shrink-0">{flow.type}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        /* Architecture Layers View */
        <div className="space-y-3">
          {layers.map((layer, i) => (
            <Card key={layer.name} className={`rounded-2xl border ${layer.color}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    {layer.name}
                  </h4>
                  <Badge variant="secondary" className="text-[9px]">Layer {i + 1}</Badge>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {layer.items.map(item => (
                    <div key={item} className="px-3 py-2 rounded-lg bg-background border border-border text-sm font-medium text-foreground">
                      {item}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground text-center">
            ↑ User-facing layers · ↓ Infrastructure foundations — Data flows bidirectionally between layers via integration middleware
          </p>
        </div>
      )}

      {/* Component Detail Dialog */}
      <Dialog open={!!selectedComp} onOpenChange={(o) => !o && setSelectedComp(null)}>
        <DialogContent className="max-w-lg">
          {selectedComp && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <selectedComp.icon className={`w-5 h-5 ${selectedComp.color}`} />
                  </div>
                  <div>
                    <DialogTitle>{selectedComp.name}</DialogTitle>
                    <p className="text-xs text-muted-foreground">{selectedComp.type}</p>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <p className="text-sm text-muted-foreground">{selectedComp.description}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <p className="text-[10px] text-muted-foreground">Version</p>
                    <p className="font-medium">{selectedComp.version}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <p className="text-[10px] text-muted-foreground">Environment</p>
                    <p className="font-medium">{selectedComp.environment}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <p className="text-[10px] text-muted-foreground">Host</p>
                    <p className="font-medium">{selectedComp.host}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <p className="text-[10px] text-muted-foreground">Owner</p>
                    <p className="font-medium">{selectedComp.owner}</p>
                  </div>
                </div>
                <Separator />
                <div>
                  <h4 className="text-sm font-semibold mb-2">Dependencies</h4>
                  <div className="flex gap-2 flex-wrap">
                    {selectedComp.dependencies.length > 0 ? selectedComp.dependencies.map(d => (
                      <Badge key={d} variant="outline" className="text-xs">{d}</Badge>
                    )) : <span className="text-xs text-muted-foreground">No dependencies</span>}
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/10">
                  <span className="text-sm">Linked Tickets</span>
                  <Badge variant="secondary">{selectedComp.linkedTickets}</Badge>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
