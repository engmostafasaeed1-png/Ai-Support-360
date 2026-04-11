import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Map, Eye, Download, MessageSquare, Users, CalendarDays, FileText,
  CheckCircle2, Clock, AlertTriangle, GitBranch, Link2, ChevronRight,
  Layers, Tag, ArrowUpDown, Filter
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Blueprint {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'in_review' | 'approved' | 'superseded';
  version: string;
  author: string;
  lastUpdated: string;
  project: string;
  category: string;
  reviewers: number;
  comments: number;
  pages: number;
  completion: number;
  linkedTickets: number;
  modules: string[];
}

const blueprintData: Blueprint[] = [
  {
    id: 'BP-001', title: 'SAP S/4HANA Target Architecture Blueprint',
    description: 'Comprehensive target architecture for S/4HANA migration including system landscape, integration patterns, deployment model, and cutover strategy.',
    status: 'approved', version: 'v2.3', author: 'Ahmed Al-Rashid', lastUpdated: '2025-03-28',
    project: 'SAP S/4HANA Migration', category: 'Enterprise Architecture',
    reviewers: 5, comments: 34, pages: 68, completion: 100, linkedTickets: 8,
    modules: ['FI/CO', 'MM', 'SD', 'PP'],
  },
  {
    id: 'BP-002', title: 'Data Migration & Transformation Blueprint',
    description: 'End-to-end data migration strategy with extraction, transformation, cleansing rules, loading procedures, and validation checklists for all master & transactional data.',
    status: 'in_review', version: 'v1.7', author: 'Omar Khaled', lastUpdated: '2025-04-05',
    project: 'SAP S/4HANA Migration', category: 'Data Architecture',
    reviewers: 3, comments: 22, pages: 52, completion: 85, linkedTickets: 12,
    modules: ['MDG', 'LTMC', 'BODS'],
  },
  {
    id: 'BP-003', title: 'Integration Architecture Blueprint - Middleware & APIs',
    description: 'Design of integration layer using SAP BTP Integration Suite (CPI) for connecting S/4HANA with third-party systems, legacy apps, and cloud services.',
    status: 'approved', version: 'v3.0', author: 'Sara Mohammed', lastUpdated: '2025-03-15',
    project: 'SAP S/4HANA Migration', category: 'Integration Architecture',
    reviewers: 4, comments: 28, pages: 45, completion: 100, linkedTickets: 6,
    modules: ['CPI', 'API Hub', 'BTP'],
  },
  {
    id: 'BP-004', title: 'Security & Compliance Architecture Blueprint',
    description: 'Security design covering role-based access, SSO/SAML, encryption at rest & transit, audit logging, SOX & GDPR compliance, and penetration testing plan.',
    status: 'draft', version: 'v0.9', author: 'Fatima Hassan', lastUpdated: '2025-04-08',
    project: 'SAP S/4HANA Migration', category: 'Security Architecture',
    reviewers: 2, comments: 11, pages: 38, completion: 60, linkedTickets: 4,
    modules: ['GRC', 'IAM', 'Fiori'],
  },
];

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: Clock },
  in_review: { label: 'In Review', color: 'bg-amber-500/10 text-amber-600 border-amber-200', icon: AlertTriangle },
  approved: { label: 'Approved', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', icon: CheckCircle2 },
  superseded: { label: 'Superseded', color: 'bg-red-500/10 text-red-500', icon: GitBranch },
};

export default function BlueprintDocuments({ searchQuery }: { searchQuery: string }) {
  const [selectedBP, setSelectedBP] = useState<Blueprint | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('updated');

  const filtered = blueprintData
    .filter(b => {
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return b.title.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'updated') return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return b.completion - a.completion;
    });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-9 text-xs">
            <Filter className="w-3.5 h-3.5 mr-1" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-36 h-9 text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 mr-1" />
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Last Updated</SelectItem>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="completion">Completion</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{filtered.length} blueprints</Badge>
      </div>

      {/* Blueprint Cards */}
      {filtered.map((bp) => {
        const sc = statusConfig[bp.status];
        const StatusIcon = sc.icon;
        return (
          <Card key={bp.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all cursor-pointer group" onClick={() => setSelectedBP(bp)}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{bp.id}</span>
                    <Badge variant="outline" className="text-[9px]">{bp.version}</Badge>
                    <Badge variant="outline" className={`text-[9px] ${sc.color}`}>
                      <StatusIcon className="w-3 h-3 mr-1" />{sc.label}
                    </Badge>
                    <Badge variant="secondary" className="text-[9px]">{bp.category}</Badge>
                  </div>
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{bp.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">{bp.description}</p>
                  
                  {/* Progress bar */}
                  <div className="flex items-center gap-3">
                    <Progress value={bp.completion} className="flex-1 h-1.5" />
                    <span className="text-[10px] text-muted-foreground font-medium">{bp.completion}%</span>
                  </div>

                  {/* Modules */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {bp.modules.map(m => (
                      <Badge key={m} variant="outline" className="text-[9px] bg-primary/5">{m}</Badge>
                    ))}
                  </div>

                  {/* Meta info */}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {bp.author}</span>
                    <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {bp.lastUpdated}</span>
                    <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {bp.pages} pages</span>
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {bp.reviewers} reviewers</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {bp.comments}</span>
                    <span className="flex items-center gap-1"><Link2 className="w-3.5 h-3.5" /> {bp.linkedTickets} tickets</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="text-xs gap-1" onClick={(e) => { e.stopPropagation(); setSelectedBP(bp); }}>
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

      {/* Detail Dialog */}
      <Dialog open={!!selectedBP} onOpenChange={(o) => !o && setSelectedBP(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedBP && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">{selectedBP.id}</span>
                  <Badge variant="outline" className="text-[9px]">{selectedBP.version}</Badge>
                  <Badge variant="outline" className={`text-[9px] ${statusConfig[selectedBP.status].color}`}>{statusConfig[selectedBP.status].label}</Badge>
                </div>
                <DialogTitle className="text-lg">{selectedBP.title}</DialogTitle>
              </DialogHeader>

              <div className="space-y-5 mt-2">
                <p className="text-sm text-muted-foreground">{selectedBP.description}</p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-muted/30 text-center">
                    <p className="text-lg font-bold text-foreground">{selectedBP.pages}</p>
                    <p className="text-[10px] text-muted-foreground">Pages</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/30 text-center">
                    <p className="text-lg font-bold text-foreground">{selectedBP.reviewers}</p>
                    <p className="text-[10px] text-muted-foreground">Reviewers</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/30 text-center">
                    <p className="text-lg font-bold text-foreground">{selectedBP.comments}</p>
                    <p className="text-[10px] text-muted-foreground">Comments</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/30 text-center">
                    <p className="text-lg font-bold text-foreground">{selectedBP.linkedTickets}</p>
                    <p className="text-[10px] text-muted-foreground">Linked Tickets</p>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="text-sm font-semibold mb-2">SAP Modules Covered</h4>
                  <div className="flex gap-2 flex-wrap">
                    {selectedBP.modules.map(m => <Badge key={m} variant="outline">{m}</Badge>)}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2">Document Sections</h4>
                  <div className="space-y-1.5">
                    {['Executive Summary', 'Current State Assessment', 'Target Architecture', 'Gap Analysis', 'Migration Roadmap', 'Risk Assessment', 'Appendices'].map((s, i) => (
                      <div key={s} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 text-sm">
                        <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                        <Layers className="w-3.5 h-3.5 text-primary" />
                        <span>{s}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button className="gradient-primary border-0 gap-1.5 flex-1">
                    <Download className="w-4 h-4" /> Export PDF
                  </Button>
                  <Button variant="outline" className="gap-1.5 flex-1">
                    <MessageSquare className="w-4 h-4" /> Add Comment
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
