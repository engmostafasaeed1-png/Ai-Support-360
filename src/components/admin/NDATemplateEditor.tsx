import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { FileSignature, Save, Info } from 'lucide-react';
import { useNDATemplate } from '@/hooks/useNDA';

export default function NDATemplateEditor() {
  const { t } = useTranslation();
  const { template, loading, saveTemplate } = useNDATemplate();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(template); }, [template]);

  const handleSave = async () => {
    setSaving(true);
    await saveTemplate(draft);
    setSaving(false);
  };

  const isDirty = draft !== template;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <FileSignature className="w-5 h-5 text-primary" />
        <CardTitle className="text-base">{t('admin.nda_title', 'NDA Template')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('admin.nda_description', 'Edit the Non-Disclosure Agreement template that consultants must sign before working with each client.')}
        </p>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="font-mono text-sm"
          />
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!isDirty || saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
