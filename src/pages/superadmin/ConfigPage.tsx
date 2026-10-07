import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Settings2, Zap, ToggleLeft, FileText, Palette, Mail,
  Globe, Bell, Shield, Users, Database, Workflow, Plus, Save,
  Trash2, GripVertical, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';


const emailTemplates = [
  { id: 'welcome', name: 'Welcome Email', subject: 'Welcome to AI Support 360!', lastEdited: '2 days ago' },
  { id: 'ticket_created', name: 'Ticket Created', subject: 'Your ticket has been created', lastEdited: '5 days ago' },
  { id: 'ticket_resolved', name: 'Ticket Resolved', subject: 'Your ticket has been resolved', lastEdited: '1 week ago' },
  { id: 'consultant_assigned', name: 'Consultant Assigned', subject: 'A consultant has been assigned', lastEdited: '1 week ago' },
  { id: 'payment_confirmation', name: 'Payment Confirmation', subject: 'Payment received', lastEdited: '2 weeks ago' },
  { id: 'nda_signed', name: 'NDA Signed', subject: 'NDA has been signed', lastEdited: '3 weeks ago' },
];

const workflowSteps = [
  { id: 1, name: 'Ticket Created', type: 'trigger', next: 2 },
  { id: 2, name: 'AI Categorization', type: 'action', next: 3 },
  { id: 3, name: 'Priority Check', type: 'condition', next: 4 },
  { id: 4, name: 'Auto-Assign Consultant', type: 'action', next: 5 },
  { id: 5, name: 'Notify Client', type: 'notification', next: null },
];

export default function ConfigPage() {
  const { t } = useTranslation();
  const { flags, loading, toggleFlag } = useFeatureFlags();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const handleToggle = (key: string) => {
    toggleFlag(key);
    toast.success(t('super_admin.feature_toggled', 'Feature flag updated'));
  };

  const categories = [...new Set(flags.map(f => f.category))];

  const stepTypeColors: Record<string, string> = {
    trigger: 'bg-accent/10 text-accent border-accent/30',
    action: 'bg-primary/10 text-primary border-primary/30',
    condition: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    notification: 'bg-green-500/10 text-green-600 border-green-500/30',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('super_admin.config_title', 'Low-Code Configuration')}</h1>
        <p className="text-sm text-muted-foreground">{t('super_admin.config_subtitle', 'Configure features, workflows, and templates without code changes')}</p>
      </div>

      <Tabs defaultValue="features" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="features"><ToggleLeft className="w-3.5 h-3.5 me-1" />{t('super_admin.feature_flags', 'Feature Flags')}</TabsTrigger>
          <TabsTrigger value="workflows"><Workflow className="w-3.5 h-3.5 me-1" />{t('super_admin.workflows', 'Workflows')}</TabsTrigger>
          <TabsTrigger value="templates"><FileText className="w-3.5 h-3.5 me-1" />{t('super_admin.templates', 'Email Templates')}</TabsTrigger>
          <TabsTrigger value="branding"><Palette className="w-3.5 h-3.5 me-1" />{t('super_admin.branding', 'Branding')}</TabsTrigger>
        </TabsList>

        {/* Feature Flags */}
        <TabsContent value="features">
          <div className="space-y-6">
            {categories.map(cat => (
              <Card key={cat} className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">{cat}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {flags.filter(f => f.category === cat).map(flag => (
                    <div key={flag.key} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Zap className={`w-3.5 h-3.5 ${flag.enabled ? 'text-green-500' : 'text-muted-foreground'}`} />
                          <span className="text-sm font-medium text-foreground">{flag.label}</span>
                          <Badge variant="outline" className={`text-[9px] ${flag.enabled ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground'}`}>
                            {flag.enabled ? 'ON' : 'OFF'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 ms-5">{flag.description}</p>
                      </div>
                      <Switch checked={flag.enabled} onCheckedChange={() => handleToggle(flag.key)} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Workflows */}
        <TabsContent value="workflows">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t('super_admin.ticket_workflow', 'Ticket Processing Workflow')}</CardTitle>
                <Button variant="outline" size="sm">
                  <Plus className="w-3 h-3 me-1" /> {t('super_admin.add_step', 'Add Step')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {workflowSteps.map((step, i) => (
                  <div key={step.id} className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                    <div className={`flex-1 flex items-center justify-between p-3 rounded-lg border ${stepTypeColors[step.type]}`}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px]">{step.type}</Badge>
                        <span className="text-sm font-medium">{step.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <Settings2 className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {step.next && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <Button className="gradient-primary border-0" onClick={() => toast.success('Workflow saved')}>
                  <Save className="w-3.5 h-3.5 me-1" /> {t('common.save', 'Save Workflow')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 mt-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('super_admin.auto_rules', 'Automation Rules')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { rule: 'Auto-escalate critical tickets after 15 min', enabled: true },
                { rule: 'Send reminder for unread messages after 1 hour', enabled: true },
                { rule: 'Auto-close resolved tickets after 7 days', enabled: false },
                { rule: 'Notify admin on 3+ failed login attempts', enabled: true },
                { rule: 'Auto-approve verified SAP consultants', enabled: false },
              ].map((r) => (
                <div key={r.rule} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-muted/10">
                  <span className="text-sm">{r.rule}</span>
                  <Switch defaultChecked={r.enabled} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Templates */}
        <TabsContent value="templates">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('super_admin.email_templates', 'Email Templates')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {emailTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    className={`w-full text-start p-3 rounded-lg border transition-colors ${
                      selectedTemplate === tpl.id ? 'border-primary bg-primary/5' : 'border-border/30 hover:bg-muted/20'
                    }`}
                    onClick={() => setSelectedTemplate(tpl.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{tpl.name}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{tpl.lastEdited}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ms-6">{tpl.subject}</p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('super_admin.template_editor', 'Template Editor')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedTemplate ? (
                  <>
                    <div>
                      <Label className="text-xs">{t('super_admin.subject', 'Subject')}</Label>
                      <Input
                        defaultValue={emailTemplates.find(t => t.id === selectedTemplate)?.subject}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t('super_admin.body', 'Body (HTML)')}</Label>
                      <Textarea
                        rows={10}
                        className="mt-1 font-mono text-xs"
                        defaultValue={`<h1>Hello {{name}}</h1>\n<p>Your {{entity}} has been {{action}}.</p>\n<p>Thank you for using AI Support 360!</p>`}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Variables:</span>
                      {['{{name}}', '{{email}}', '{{entity}}', '{{action}}', '{{link}}'].map(v => (
                        <Badge key={v} variant="outline" className="text-[9px] cursor-pointer">{v}</Badge>
                      ))}
                    </div>
                    <Button className="gradient-primary border-0" onClick={() => toast.success('Template saved')}>
                      <Save className="w-3.5 h-3.5 me-1" /> {t('common.save', 'Save Template')}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t('super_admin.select_template', 'Select a template to edit')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Branding */}
        <TabsContent value="branding">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('super_admin.brand_colors', 'Brand Colors')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: 'Primary Color', value: '#1B2559', var: '--primary' },
                  { label: 'Accent Color', value: '#3B82F6', var: '--accent' },
                  { label: 'Background', value: '#FFFFFF', var: '--background' },
                  { label: 'Destructive', value: '#EF4444', var: '--destructive' },
                ].map((c) => (
                  <div key={c.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg border border-border" style={{ backgroundColor: c.value }} />
                      <div>
                        <p className="text-sm font-medium">{c.label}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{c.value}</p>
                      </div>
                    </div>
                    <Input type="color" defaultValue={c.value} className="w-10 h-8 p-0 border-0" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('super_admin.brand_assets', 'Brand Assets')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: 'Logo', file: 'logo.svg', size: '2.4 KB' },
                  { label: 'Favicon', file: 'favicon.ico', size: '1.1 KB' },
                  { label: 'OG Image', file: 'og-image.png', size: '45 KB' },
                ].map((asset) => (
                  <div key={asset.label} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-muted/10">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{asset.label}</p>
                        <p className="text-[10px] text-muted-foreground">{asset.file} • {asset.size}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm">Upload</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
