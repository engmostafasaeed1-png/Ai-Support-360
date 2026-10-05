import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Layout, Type, Star, HelpCircle, Phone, Eye, EyeOff, Quote } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ClientTestimonialsManager from '@/components/admin/ClientTestimonialsManager';

interface SectionConfig {
  key: string;
  label: string;
  icon: typeof Layout;
  fields: { name: string; label: string; type: 'text' | 'textarea'; placeholder?: string }[];
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'hero',
    label: 'Hero Section',
    icon: Layout,
    fields: [
      { name: 'badge', label: 'Badge Text', type: 'text', placeholder: 'AI-Powered Support Platform' },
      { name: 'title1', label: 'Title Line 1', type: 'text', placeholder: 'AI Support Now' },
      { name: 'title2', label: 'Title Line 2', type: 'text', placeholder: 'For Enterprise Excellence' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea', placeholder: 'Connect with verified SAP experts...' },
      { name: 'cta_primary', label: 'Primary CTA Text', type: 'text', placeholder: 'Request Support' },
      { name: 'cta_secondary', label: 'Secondary CTA Text', type: 'text', placeholder: 'Join as Consultant' },
    ],
  },
  {
    key: 'stats',
    label: 'Statistics',
    icon: Star,
    fields: [
      { name: 'consultants_count', label: 'Consultants Count', type: 'text', placeholder: '500+' },
      { name: 'consultants_label', label: 'Consultants Label', type: 'text', placeholder: 'Expert Consultants' },
      { name: 'tickets_count', label: 'Tickets Count', type: 'text', placeholder: '12,000+' },
      { name: 'tickets_label', label: 'Tickets Label', type: 'text', placeholder: 'Tickets Resolved' },
      { name: 'satisfaction_count', label: 'Satisfaction Count', type: 'text', placeholder: '98%' },
      { name: 'satisfaction_label', label: 'Satisfaction Label', type: 'text', placeholder: 'Client Satisfaction' },
      { name: 'response_count', label: 'Response Time', type: 'text', placeholder: '<15 min' },
      { name: 'response_label', label: 'Response Label', type: 'text', placeholder: 'Avg Response Time' },
    ],
  },
  {
    key: 'why_qurtuba',
    label: 'Why Qurtuba',
    icon: Type,
    fields: [
      { name: 'title', label: 'Section Title', type: 'text', placeholder: 'Why Choose Qurtuba?' },
      { name: 'subtitle', label: 'Section Subtitle', type: 'textarea', placeholder: 'Description text...' },
    ],
  },
  {
    key: 'faq',
    label: 'FAQ Section',
    icon: HelpCircle,
    fields: [
      { name: 'title', label: 'Section Title', type: 'text', placeholder: 'Frequently Asked Questions' },
      { name: 'subtitle', label: 'Section Subtitle', type: 'text', placeholder: 'Find answers...' },
    ],
  },
  {
    key: 'contact',
    label: 'Contact Section',
    icon: Phone,
    fields: [
      { name: 'title', label: 'Section Title', type: 'text', placeholder: 'Get in Touch' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', placeholder: 'We would love to hear from you' },
      { name: 'email', label: 'Contact Email', type: 'text', placeholder: 'support@qurtuba.com' },
      { name: 'phone', label: 'Contact Phone', type: 'text', placeholder: '+966 56 879 7024' },
      { name: 'address', label: 'Address', type: 'textarea', placeholder: 'Riyadh, Saudi Arabia' },
    ],
  },
];

interface ContentRow {
  id: string;
  section_key: string;
  content: Record<string, string>;
  is_active: boolean;
}

export default function LandingEditorPage() {
  const { t } = useTranslation();
  const [sections, setSections] = useState<Record<string, ContentRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchContent();
  }, []);

  const fetchContent = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('landing_content')
      .select('*');
    if (data) {
      const map: Record<string, ContentRow> = {};
      data.forEach((row: any) => {
        map[row.section_key] = {
          id: row.id,
          section_key: row.section_key,
          content: row.content || {},
          is_active: row.is_active,
        };
      });
      setSections(map);
    }
    setLoading(false);
  };

  const updateField = (sectionKey: string, fieldName: string, value: string) => {
    setSections(prev => {
      const existing = prev[sectionKey] || { id: '', section_key: sectionKey, content: {}, is_active: true };
      return {
        ...prev,
        [sectionKey]: {
          ...existing,
          content: { ...existing.content, [fieldName]: value },
        },
      };
    });
  };

  const toggleActive = (sectionKey: string) => {
    setSections(prev => {
      const existing = prev[sectionKey] || { id: '', section_key: sectionKey, content: {}, is_active: true };
      return {
        ...prev,
        [sectionKey]: { ...existing, is_active: !existing.is_active },
      };
    });
  };

  const saveSection = async (sectionKey: string) => {
    setSaving(sectionKey);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const section = sections[sectionKey];
      const payload = {
        section_key: sectionKey,
        content: section?.content || {},
        is_active: section?.is_active ?? true,
        updated_by: user?.id || null,
      };

      if (section?.id) {
        await supabase.from('landing_content').update(payload as any).eq('id', section.id);
      } else {
        const { data } = await supabase.from('landing_content').insert(payload as any).select().single();
        if (data) {
          setSections(prev => ({
            ...prev,
            [sectionKey]: { ...prev[sectionKey], id: (data as any).id },
          }));
        }
      }
      toast.success(`${sectionKey} section saved`);
    } catch (err: any) {
      toast.error('Save failed', { description: err.message });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Landing Page Editor</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Customize the content shown on the public landing page
        </p>
      </div>

      <Tabs defaultValue="hero" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          {SECTIONS.map(sec => {
            const Icon = sec.icon;
            const isActive = sections[sec.key]?.is_active !== false;
            return (
              <TabsTrigger key={sec.key} value={sec.key} className="gap-1.5 text-xs rounded-lg">
                <Icon className="w-3.5 h-3.5" />
                {sec.label}
                {!isActive && <Badge variant="outline" className="text-[9px] px-1 py-0">Off</Badge>}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="testimonials" className="gap-1.5 text-xs rounded-lg">
            <Quote className="w-3.5 h-3.5" />
            Testimonials
          </TabsTrigger>
        </TabsList>

        <TabsContent value="testimonials">
          <Card className="rounded-2xl">
            <CardContent className="pt-6">
              <ClientTestimonialsManager />
            </CardContent>
          </Card>
        </TabsContent>

        {SECTIONS.map(sec => {
          const sectionData = sections[sec.key];
          const isActive = sectionData?.is_active !== false;
          return (
            <TabsContent key={sec.key} value={sec.key}>
              <Card className="rounded-2xl">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <sec.icon className="w-5 h-5 text-primary" />
                    {sec.label}
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      {isActive ? <Eye className="w-4 h-4 text-primary" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                      <span className="text-xs text-muted-foreground">{isActive ? 'Visible' : 'Hidden'}</span>
                      <Switch checked={isActive} onCheckedChange={() => toggleActive(sec.key)} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {sec.fields.map(field => (
                    <div key={field.name} className="space-y-1.5">
                      <Label className="text-xs font-medium">{field.label}</Label>
                      {field.type === 'textarea' ? (
                        <Textarea
                          value={sectionData?.content?.[field.name] || ''}
                          onChange={e => updateField(sec.key, field.name, e.target.value)}
                          placeholder={field.placeholder}
                          rows={3}
                          className="text-sm"
                        />
                      ) : (
                        <Input
                          value={sectionData?.content?.[field.name] || ''}
                          onChange={e => updateField(sec.key, field.name, e.target.value)}
                          placeholder={field.placeholder}
                          className="text-sm"
                        />
                      )}
                    </div>
                  ))}
                  <div className="flex justify-end pt-2">
                    <Button onClick={() => saveSection(sec.key)} disabled={saving === sec.key} className="gap-2">
                      {saving === sec.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save {sec.label}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
