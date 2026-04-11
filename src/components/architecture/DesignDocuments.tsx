import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  PenTool, Eye, Download, Users, CalendarDays, CheckCircle2, Clock,
  AlertTriangle, Target, Filter, ArrowUpDown, Link2, MessageSquare,
  ChevronRight, Lightbulb, ThumbsUp, ThumbsDown
} from 'lucide-react';

interface DesignDoc {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  alternatives: string[];
  status: 'draft' | 'pending' | 'approved' | 'finalized' | 'rejected';
  impactLevel: 'critical' | 'high' | 'medium' | 'low';
  author: string;
  date: string;
  category: string;
  linkedTickets: string[];
  stakeholders: string[];
  tradeoffs: string;
}

const designDocs: DesignDoc[] = [
  {
    id: 'DD-001', title: 'Greenfield vs. Brownfield Migration',
    decision: 'Selective Data Transition (Hybrid Approach)',
    rationale: 'Balances clean start benefits with historical data preservation. Reduces risk while enabling process optimization and leveraging best practices from both approaches.',
    alternatives: ['Full Greenfield', 'Full Brownfield', 'Landscape Transformation'],
    status: 'finalized', impactLevel: 'critical', author: 'Ahmed Al-Rashid', date: '2025-01-10',
    category: 'Migration Strategy',
    linkedTickets: ['TK-0012', 'TK-0034', 'TK-0056'],
    stakeholders: ['CTO', 'SAP Basis Lead', 'Data Migration Lead'],
    tradeoffs: 'Increased complexity in data selection phase but reduced risk of data loss and shorter downtime window.',
  },
  {
    id: 'DD-002', title: 'Integration Platform Selection',
    decision: 'SAP BTP Integration Suite (CPI)',
    rationale: 'Native SAP integration with pre-built adapters, long-term roadmap alignment, and lower TCO vs third-party middleware. Supports both synchronous and asynchronous patterns.',
    alternatives: ['MuleSoft', 'Dell Boomi', 'Azure Integration Services'],
    status: 'finalized', impactLevel: 'high', author: 'Sara Mohammed', date: '2025-01-22',
    category: 'Integration',
    linkedTickets: ['TK-0078', 'TK-0091'],
    stakeholders: ['Integration Architect', 'CTO'],
    tradeoffs: 'Higher license cost but eliminates need for separate middleware team and reduces integration development time by 40%.',
  },
  {
    id: 'DD-003', title: 'Database Deployment Model',
    decision: 'Private Cloud (Azure Hyperscaler)',
    rationale: 'Compliance requirements met with private cloud. Azure chosen for existing enterprise agreement, regional availability, and SAP-certified infrastructure.',
    alternatives: ['On-Premise', 'SAP RISE', 'AWS Hyperscaler'],
    status: 'finalized', impactLevel: 'critical', author: 'Omar Khaled', date: '2025-02-05',
    category: 'Infrastructure',
    linkedTickets: ['TK-0102', 'TK-0115', 'TK-0123'],
    stakeholders: ['Infrastructure Lead', 'Security Officer', 'CFO'],
    tradeoffs: 'Monthly operational cost ~15% higher than on-prem but provides elasticity, disaster recovery, and reduced capital expenditure.',
  },
  {
    id: 'DD-004', title: 'Custom Code Remediation Strategy',
    decision: 'Phased Remediation with ATC Checks',
    rationale: 'Prioritize critical custom code first, defer non-essential modifications. Use ABAP Test Cockpit and Custom Code Analyzer for automated checks.',
    alternatives: ['Big-bang remediation', 'Full rewrite in ABAP Cloud', 'Side-by-side extensions only'],
    status: 'approved', impactLevel: 'high', author: 'Fatima Hassan', date: '2025-02-15',
    category: 'Development',
    linkedTickets: ['TK-0134', 'TK-0145'],
    stakeholders: ['ABAP Lead', 'Quality Manager'],
    tradeoffs: 'Slower initial progress but maintains system stability and allows parallel workstreams without blocking migration.',
  },
  {
    id: 'DD-005', title: 'Analytics Architecture Pattern',
    decision: 'Embedded Analytics + BW/4HANA Hybrid',
    rationale: 'Real-time operational reporting via embedded analytics for daily use. Complex analytics, predictive models, and historical reporting via BW/4HANA.',
    alternatives: ['SAP Analytics Cloud only', 'BW/4HANA only', 'Third-party BI (Power BI)'],
    status: 'pending', impactLevel: 'medium', author: 'Sara Mohammed', date: '2025-03-20',
    category: 'Analytics',
    linkedTickets: ['TK-0156'],
    stakeholders: ['BI Lead', 'Finance Director'],
    tradeoffs: 'Two platforms to maintain but covers all reporting needs from operational to strategic without compromise.',
  },
  {
    id: 'DD-006', title: 'Fiori Launchpad & UX Strategy',
    decision: 'SAP Fiori Launchpad with Custom Tile Groups',
    rationale: 'Standardized UX approach with role-based launchpads. Custom tiles for high-priority workflows. Mobile-first design for field operations.',
    alternatives: ['SAP Work Zone', 'Custom Portal', 'Third-party UX layer'],
    status: 'draft', impactLevel: 'medium', author: 'Ahmed Al-Rashid', date: '2025-04-02',
    category: 'User Experience',
    linkedTickets: ['TK-0167', 'TK-0178'],
    stakeholders: ['UX Lead', 'Change Management Lead'],
    tradeoffs: 'Limited customization compared to custom portal but lower maintenance burden and consistent SAP experience.',
  },
];

const statusCfg: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: Clock },
  pending: { label: 'Pending', color: 'bg-blue-500/10 text-blue-600 border-blue-200', icon: Clock },
  approved: { label: 'Approved', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', icon: CheckCircle2 },
  finalized: { label: 'Finalized', color: 'bg-primary/10 text-primary border-primary/20', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-500/10 text-red-500', icon: AlertTriangle },
};

const impactCfg: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-500/10 text-red-600' },
  high: { label: 'High', color: 'bg-orange-500/10 text-orange-600' },
  medium: { label: 'Medium', color: 'bg-yellow-500/10 text-yellow-600' },
  low: { label: 'Low', color: 'bg-muted text-muted-foreground' },
};

export default function DesignDocuments({ searchQuery }: { searchQuery: string }) {
  const [selectedDoc, setSelectedDoc] = useState<DesignDoc | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');

  const filtered = designDocs.filter(d => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return d.title.toLowerCase().includes(q) || d.decision.toLowerCase().includes(q) || d.id.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-9 text-xs">
            <Filter className="w-3.5 h-3.5 mr-1" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="finalized">Finalized</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{filtered.length} documents</Badge>
      </div>

      {filtered.map((dd) => {
        const sc = statusCfg[dd.status];
        const ic = impactCfg[dd.impactLevel];
        const StatusIcon = sc.icon;
        return (
          <Card key={dd.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all cursor-pointer" onClick={() => setSelectedDoc(dd)}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{dd.id}</span>
                    <Badge variant="outline" className={`text-[9px] ${sc.color}`}>
                      <StatusIcon className="w-3 h-3 mr-1" />{sc.label}
                    </Badge>
                    <Badge variant="secondary" className={`text-[9px] ${ic.color}`}>
                      <Target className="w-3 h-3 mr-1" />{ic.label} Impact
                    </Badge>
                    <Badge variant="outline" className="text-[9px]">{dd.category}</Badge>
                  </div>
                  <h3 className="font-semibold text-foreground">{dd.title}</h3>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{dd.date}</span>
              </div>

              <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
                <p className="text-[10px] font-semibold text-primary mb-0.5">DECISION</p>
                <p className="text-sm font-medium text-foreground">{dd.decision}</p>
              </div>

              <p className="text-sm text-muted-foreground">{dd.rationale}</p>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {dd.author}</span>
                <span className="flex items-center gap-1"><Link2 className="w-3.5 h-3.5" /> {dd.linkedTickets.length} tickets</span>
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {dd.stakeholders.length} stakeholders</span>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Detail Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={(o) => !o && setSelectedDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedDoc && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">{selectedDoc.id}</span>
                  <Badge variant="outline" className={`text-[9px] ${statusCfg[selectedDoc.status].color}`}>{statusCfg[selectedDoc.status].label}</Badge>
                </div>
                <DialogTitle>{selectedDoc.title}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 mt-2">
                <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
                  <p className="text-[10px] font-semibold text-primary mb-1">FINAL DECISION</p>
                  <p className="text-base font-semibold text-foreground">{selectedDoc.decision}</p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-1">Rationale</h4>
                  <p className="text-sm text-muted-foreground">{selectedDoc.rationale}</p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-1">Trade-offs</h4>
                  <p className="text-sm text-muted-foreground">{selectedDoc.tradeoffs}</p>
                </div>

                <Separator />

                <div>
                  <h4 className="text-sm font-semibold mb-2">Alternatives Considered</h4>
                  <div className="space-y-1.5">
                    {selectedDoc.alternatives.map(a => (
                      <div key={a} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 text-sm">
                        <ThumbsDown className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{a}</span>
                        <Badge variant="outline" className="text-[9px] ml-auto">Not selected</Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2">Linked Tickets</h4>
                  <div className="flex gap-2 flex-wrap">
                    {selectedDoc.linkedTickets.map(t => (
                      <Badge key={t} variant="outline" className="text-xs cursor-pointer hover:bg-primary/10">
                        <Link2 className="w-3 h-3 mr-1" />{t}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2">Stakeholders</h4>
                  <div className="flex gap-2 flex-wrap">
                    {selectedDoc.stakeholders.map(s => (
                      <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button className="gradient-primary border-0 gap-1.5 flex-1">
                    <ThumbsUp className="w-4 h-4" /> Approve Decision
                  </Button>
                  <Button variant="outline" className="gap-1.5 flex-1">
                    <Download className="w-4 h-4" /> Export
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
