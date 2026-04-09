import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Cpu, Plus, FileText, GitBranch, Server, Database, Globe, Shield,
  Layers, ArrowRight, CheckCircle2, Clock, AlertTriangle, Eye,
  Download, MessageSquare, Users, CalendarDays, Workflow, Boxes,
  Network, HardDrive, Lock, BarChart3, Zap, Target
} from 'lucide-react';

const architectureDocuments = [
  {
    id: 'SA-001',
    title: 'SAP S/4HANA Target Architecture Blueprint',
    description: 'Comprehensive target architecture design for S/4HANA migration including system landscape, integration patterns, and deployment model.',
    status: 'approved',
    version: 'v2.3',
    author: 'Ahmed Al-Rashid',
    lastUpdated: '2025-03-28',
    project: 'SAP S/4HANA Migration',
    category: 'blueprint',
    reviewers: 3,
    comments: 24,
    pages: 45,
  },
  {
    id: 'SA-002',
    title: 'Integration Architecture - Middleware & APIs',
    description: 'Design of integration layer using SAP CPI/BTP for connecting S/4HANA with third-party systems and legacy applications.',
    status: 'in_review',
    version: 'v1.5',
    author: 'Sara Mohammed',
    lastUpdated: '2025-04-02',
    project: 'SAP S/4HANA Migration',
    category: 'integration',
    reviewers: 2,
    comments: 15,
    pages: 32,
  },
  {
    id: 'SA-003',
    title: 'Data Migration Strategy & Architecture',
    description: 'End-to-end data migration strategy covering extraction, transformation, loading, and validation approaches for all modules.',
    status: 'approved',
    version: 'v3.0',
    author: 'Omar Khaled',
    lastUpdated: '2025-03-15',
    project: 'SAP S/4HANA Migration',
    category: 'data',
    reviewers: 4,
    comments: 31,
    pages: 58,
  },
  {
    id: 'SA-004',
    title: 'Security Architecture & Compliance Framework',
    description: 'Security design including role-based access, encryption standards, audit logging, and compliance requirements (SOX, GDPR).',
    status: 'draft',
    version: 'v0.8',
    author: 'Fatima Hassan',
    lastUpdated: '2025-04-05',
    project: 'SAP S/4HANA Migration',
    category: 'security',
    reviewers: 1,
    comments: 8,
    pages: 28,
  },
  {
    id: 'SA-005',
    title: 'BW/4HANA Analytics Architecture',
    description: 'Target architecture for analytics platform including data warehouse design, real-time reporting, and embedded analytics.',
    status: 'in_review',
    version: 'v1.2',
    author: 'Sara Mohammed',
    lastUpdated: '2025-04-01',
    project: 'SAP BW/4HANA Reporting',
    category: 'analytics',
    reviewers: 2,
    comments: 12,
    pages: 35,
  },
  {
    id: 'SA-006',
    title: 'Infrastructure & Cloud Deployment Architecture',
    description: 'Cloud infrastructure design covering compute, storage, networking, DR/HA, and auto-scaling configurations.',
    status: 'approved',
    version: 'v2.0',
    author: 'Ahmed Al-Rashid',
    lastUpdated: '2025-02-20',
    project: 'SAP S/4HANA Migration',
    category: 'infrastructure',
    reviewers: 5,
    comments: 19,
    pages: 40,
  },
];

const designDecisions = [
  {
    id: 'DD-001',
    title: 'Greenfield vs. Brownfield Migration Approach',
    decision: 'Selective Data Transition (Hybrid)',
    rationale: 'Balances clean start benefits with historical data preservation. Reduces risk while enabling process optimization.',
    status: 'finalized',
    impactLevel: 'critical',
    date: '2025-01-10',
  },
  {
    id: 'DD-002',
    title: 'Integration Platform Selection',
    decision: 'SAP BTP Integration Suite (CPI)',
    rationale: 'Native SAP integration, pre-built adapters, and long-term roadmap alignment. Lower TCO vs third-party middleware.',
    status: 'finalized',
    impactLevel: 'high',
    date: '2025-01-22',
  },
  {
    id: 'DD-003',
    title: 'HANA Database Deployment Model',
    decision: 'Private Cloud (Hyperscaler - Azure)',
    rationale: 'Compliance requirements met with private cloud. Azure chosen for existing enterprise agreement and regional availability.',
    status: 'finalized',
    impactLevel: 'critical',
    date: '2025-02-05',
  },
  {
    id: 'DD-004',
    title: 'Custom Code Remediation Strategy',
    decision: 'Phased remediation with ATC checks',
    rationale: 'Prioritize critical custom code first, defer non-essential modifications. Use ABAP Test Cockpit for automated checks.',
    status: 'approved',
    impactLevel: 'high',
    date: '2025-02-15',
  },
  {
    id: 'DD-005',
    title: 'Analytics Architecture Pattern',
    decision: 'Embedded Analytics + BW/4HANA',
    rationale: 'Real-time operational reporting via embedded analytics. Complex analytics and historical reporting via BW/4HANA.',
    status: 'pending',
    impactLevel: 'medium',
    date: '2025-03-20',
  },
];

const systemComponents = [
  { name: 'SAP S/4HANA', type: 'Core ERP', status: 'active', icon: Database, color: 'text-primary' },
  { name: 'SAP BTP', type: 'Platform', status: 'active', icon: Globe, color: 'text-blue-500' },
  { name: 'SAP CPI', type: 'Integration', status: 'active', icon: Network, color: 'text-emerald-500' },
  { name: 'SAP BW/4HANA', type: 'Analytics', status: 'planned', icon: BarChart3, color: 'text-purple-500' },
  { name: 'SAP Fiori', type: 'UX Layer', status: 'active', icon: Layers, color: 'text-orange-500' },
  { name: 'Azure Cloud', type: 'Infrastructure', status: 'active', icon: HardDrive, color: 'text-cyan-500' },
  { name: 'SAP GRC', type: 'Governance', status: 'planned', icon: Lock, color: 'text-red-500' },
  { name: 'SAP Analytics Cloud', type: 'BI', status: 'planned', icon: Zap, color: 'text-amber-500' },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground border-border' },
  in_review: { label: 'In Review', color: 'bg-amber-500/10 text-amber-600 border-amber-200' },
  approved: { label: 'Approved', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200' },
  finalized: { label: 'Finalized', color: 'bg-primary/10 text-primary border-primary/20' },
  pending: { label: 'Pending', color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
};

const impactConfig: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical Impact', color: 'bg-red-500/10 text-red-600' },
  high: { label: 'High Impact', color: 'bg-orange-500/10 text-orange-600' },
  medium: { label: 'Medium Impact', color: 'bg-yellow-500/10 text-yellow-600' },
};

const stats = [
  { label: 'Architecture Documents', value: '6', icon: FileText, color: 'text-primary' },
  { label: 'Design Decisions', value: '5', icon: Target, color: 'text-emerald-500' },
  { label: 'System Components', value: '8', icon: Boxes, color: 'text-purple-500' },
  { label: 'Approval Rate', value: '67%', icon: CheckCircle2, color: 'text-blue-500' },
];

export default function SolutionArchitecturePage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary" />
            Solution Architecture
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Architecture blueprints, design decisions, and system landscape documentation</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5">
          <Plus className="w-4 h-4" /> New Document
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="rounded-2xl border-border/50">
              <CardContent className="pt-4 pb-3 text-center">
                <Icon className={`w-5 h-5 mx-auto mb-1.5 ${s.color}`} />
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="documents" className="space-y-4">
        <TabsList>
          <TabsTrigger value="documents">Architecture Documents</TabsTrigger>
          <TabsTrigger value="decisions">Design Decisions</TabsTrigger>
          <TabsTrigger value="landscape">System Landscape</TabsTrigger>
        </TabsList>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-3">
          {architectureDocuments.map((doc) => {
            const sc = statusConfig[doc.status];
            return (
              <Card key={doc.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all cursor-pointer group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">{doc.id}</span>
                        <Badge variant="outline" className="text-[9px]">{doc.version}</Badge>
                        <Badge variant="outline" className={`text-[9px] ${sc.color}`}>{sc.label}</Badge>
                      </div>
                      <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{doc.title}</h3>
                      <p className="text-sm text-muted-foreground">{doc.description}</p>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {doc.author}</span>
                        <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {doc.lastUpdated}</span>
                        <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {doc.pages} pages</span>
                        <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {doc.reviewers} reviewers</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {doc.comments}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button variant="outline" size="sm" className="text-xs gap-1">
                        <Eye className="w-3 h-3" /> View
                      </Button>
                      <Button variant="ghost" size="sm" className="text-xs gap-1">
                        <Download className="w-3 h-3" /> PDF
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Design Decisions Tab */}
        <TabsContent value="decisions" className="space-y-3">
          {designDecisions.map((dd) => {
            const sc = statusConfig[dd.status];
            const ic = impactConfig[dd.impactLevel];
            return (
              <Card key={dd.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{dd.id}</span>
                        <Badge variant="outline" className={`text-[9px] ${sc.color}`}>{sc.label}</Badge>
                        <Badge variant="secondary" className={`text-[9px] ${ic.color}`}>{ic.label}</Badge>
                      </div>
                      <h3 className="font-semibold text-foreground">{dd.title}</h3>
                    </div>
                    <span className="text-xs text-muted-foreground">{dd.date}</span>
                  </div>
                  <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
                    <p className="text-xs font-semibold text-primary mb-1">Decision</p>
                    <p className="text-sm font-medium text-foreground">{dd.decision}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Rationale</p>
                    <p className="text-sm text-muted-foreground">{dd.rationale}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* System Landscape Tab */}
        <TabsContent value="landscape" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {systemComponents.map((comp) => {
              const Icon = comp.icon;
              return (
                <Card key={comp.name} className="rounded-2xl border-border/50 hover:shadow-premium transition-all cursor-pointer">
                  <CardContent className="pt-5 pb-4 text-center space-y-2">
                    <div className={`w-10 h-10 mx-auto rounded-xl bg-muted flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${comp.color}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{comp.name}</p>
                      <p className="text-[10px] text-muted-foreground">{comp.type}</p>
                    </div>
                    <Badge variant="outline" className={`text-[9px] ${comp.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' : 'bg-blue-500/10 text-blue-600 border-blue-200'}`}>
                      {comp.status === 'active' ? 'Active' : 'Planned'}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="rounded-2xl border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Workflow className="w-4 h-4 text-primary" />
                Integration Flow Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center justify-center gap-2 py-6">
                {['SAP S/4HANA', 'SAP CPI', 'SAP BTP', 'External Systems'].map((item, i) => (
                  <div key={item} className="flex items-center gap-2">
                    <div className="px-4 py-2 rounded-xl bg-primary/10 text-primary text-sm font-medium border border-primary/20">
                      {item}
                    </div>
                    {i < 3 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Real-time event-driven integration with asynchronous message processing and guaranteed delivery
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
