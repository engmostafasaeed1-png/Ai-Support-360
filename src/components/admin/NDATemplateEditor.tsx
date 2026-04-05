import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileSignature, Save, Info, Eye, Pencil } from 'lucide-react';
import { useNDATemplate } from '@/hooks/useNDA';

const SAMPLE_DATA: Record<string, string> = {
  '{{consultant_name}}': 'Ahmed Al-Rashid',
  '{{consultant_email}}': 'ahmed.rashid@example.com',
  '{{client_name}}': 'Sarah Johnson',
  '{{client_company}}': 'Acme Corporation',
  '{{client_industry}}': 'Manufacturing',
  '{{sap_modules}}': 'SAP FI, SAP MM, SAP SD',
  '{{date}}': new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
};

const PLACEHOLDERS = [
  { tag: '{{consultant_name}}', label: 'Consultant Name' },
  { tag: '{{consultant_email}}', label: 'Consultant Email' },
  { tag: '{{client_name}}', label: 'Client Name' },
  { tag: '{{client_company}}', label: 'Client Company' },
  { tag: '{{client_industry}}', label: 'Client Industry' },
  { tag: '{{sap_modules}}', label: 'SAP Modules' },
  { tag: '{{date}}', label: 'Signing Date' },
];

export default function NDATemplateEditor() {
  const { t } = useTranslation();
  const { template, loading, saveTemplate } = useNDATemplate();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => { setDraft(template); }, [template]);

  const handleSave = async () => {
    setSaving(true);
    await saveTemplate(draft);
    setSaving(false);
  };

  const isDirty = draft !== template;

  const previewContent = useMemo(() => {
    let content = draft;
    for (const [placeholder, value] of Object.entries(SAMPLE_DATA)) {
      content = content.replaceAll(placeholder, value);
    }
    return content;
  }, [draft]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <FileSignature className="w-5 h-5 text-primary" />
        <CardTitle className="text-base">{t('admin.nda_title', 'NDA Template')}</CardTitle>
        <div className="ms-auto">
          <Button
            variant={previewing ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setPreviewing(!previewing)}
          >
            {previewing ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {previewing ? t('admin.nda_edit', 'Edit') : t('admin.nda_preview', 'Preview')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('admin.nda_description', 'Edit the Non-Disclosure Agreement template that consultants must sign before working with each client.')}
        </p>

        {/* Placeholder Reference */}
        {!previewing && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Info className="w-4 h-4 text-primary" />
              {t('admin.nda_placeholders_title', 'Available Placeholders')}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('admin.nda_placeholders_desc', 'Use these placeholders in the template — they will be auto-filled with real data when the consultant signs.')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((p) => (
                <Badge
                  key={p.tag}
                  variant="secondary"
                  className="text-[11px] font-mono cursor-pointer select-all"
                  title={p.label}
                  onClick={() => { navigator.clipboard.writeText(p.tag); }}
                >
                  {p.tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : previewing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] gap-1">
                <Eye className="w-3 h-3" />
                {t('admin.nda_preview_label', 'Preview with sample data')}
              </Badge>
            </div>
            <ScrollArea className="max-h-[400px] border rounded-lg p-4 bg-muted/20">
              <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">
                {previewContent}
              </pre>
            </ScrollArea>
          </div>
        ) : (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="font-mono text-sm"
          />
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!isDirty || saving || previewing} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}