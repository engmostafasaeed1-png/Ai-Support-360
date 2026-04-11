import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Cpu, Plus, FileText, Server, Database, Globe, Shield, Layers, ArrowRight,
  CheckCircle2, Clock, AlertTriangle, Eye, Download, MessageSquare, Users,
  CalendarDays, Workflow, Boxes, Network, HardDrive, Lock, BarChart3, Zap,
  Target, Search, Filter, Link2, ExternalLink, GitBranch, BookOpen,
  PenTool, Map, MonitorSmartphone, Milestone, ChevronRight, ArrowUpDown,
  Tag, Hash, Ticket, FileCheck, FilePlus, Activity, TrendingUp
} from 'lucide-react';
import { useClientTickets } from '@/hooks/useClientTickets';
import BlueprintDocuments from '@/components/architecture/BlueprintDocuments';
import DesignDocuments from '@/components/architecture/DesignDocuments';
import SystemLandscape from '@/components/architecture/SystemLandscape';
import TicketReferences from '@/components/architecture/TicketReferences';
import ArchitectureTimeline from '@/components/architecture/ArchitectureTimeline';

const stats = [
  { label: 'Blueprints', value: '4', icon: Map, color: 'text-primary', delta: '+1 this month' },
  { label: 'Design Documents', value: '8', icon: PenTool, color: 'text-accent', delta: '2 in review' },
  { label: 'Linked Tickets', value: '23', icon: Ticket, color: 'text-emerald-500', delta: '5 open' },
  { label: 'System Components', value: '12', icon: Boxes, color: 'text-purple-500', delta: '3 planned' },
];

export default function SolutionArchitecturePage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('blueprints');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary" />
            Solution Architecture
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Blueprints, design documents, system landscape & ticket traceability
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search architecture..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 w-56"
            />
          </div>
          <Button className="gradient-primary border-0 gap-1.5">
            <Plus className="w-4 h-4" /> New Document
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <Icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-2 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> {s.delta}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="blueprints" className="gap-1.5">
            <Map className="w-3.5 h-3.5" /> Blueprints
          </TabsTrigger>
          <TabsTrigger value="design-docs" className="gap-1.5">
            <PenTool className="w-3.5 h-3.5" /> Design Documents
          </TabsTrigger>
          <TabsTrigger value="landscape" className="gap-1.5">
            <Network className="w-3.5 h-3.5" /> System Landscape
          </TabsTrigger>
          <TabsTrigger value="tickets" className="gap-1.5">
            <Ticket className="w-3.5 h-3.5" /> Ticket References
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5">
            <Activity className="w-3.5 h-3.5" /> Timeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="blueprints">
          <BlueprintDocuments searchQuery={searchQuery} />
        </TabsContent>

        <TabsContent value="design-docs">
          <DesignDocuments searchQuery={searchQuery} />
        </TabsContent>

        <TabsContent value="landscape">
          <SystemLandscape />
        </TabsContent>

        <TabsContent value="tickets">
          <TicketReferences searchQuery={searchQuery} />
        </TabsContent>

        <TabsContent value="timeline">
          <ArchitectureTimeline />
        </TabsContent>
      </Tabs>
    </div>
  );
}
