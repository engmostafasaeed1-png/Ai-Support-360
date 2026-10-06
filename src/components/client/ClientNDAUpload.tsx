import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSignature, Upload, FileText, Trash2, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { openExternal } from '@/lib/safeUrl';

export default function ClientNDAUpload() {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: clientProfile, isLoading } = useQuery({
    queryKey: ['client-nda-doc'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const { data } = await supabase
        .from('client_profiles')
        .select('custom_nda_url, custom_nda_filename, use_custom_nda')
        .eq('user_id', session.user.id)
        .maybeSingle();
      return data;
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|doc|docx)$/i)) {
      toast.error(t('nda.invalid_file', 'Please upload a PDF or Word document'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('nda.file_too_large', 'File must be under 10MB'));
      return;
    }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const ext = file.name.split('.').pop();
      const storagePath = `${session.user.id}/custom-nda.${ext}`;

      // Delete old file if exists
      if (clientProfile?.custom_nda_url) {
        await supabase.storage.from('nda-documents').remove([clientProfile.custom_nda_url]);
      }

      const { error: uploadError } = await supabase.storage
        .from('nda-documents')
        .upload(storagePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('client_profiles')
        .update({
          custom_nda_url: storagePath,
          custom_nda_filename: file.name,
        })
        .eq('user_id', session.user.id);
      if (updateError) throw updateError;

      qc.invalidateQueries({ queryKey: ['client-nda-doc'] });
      toast.success(t('nda.uploaded', 'Custom NDA uploaded successfully'));
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    if (!clientProfile?.custom_nda_url) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      await supabase.storage.from('nda-documents').remove([clientProfile.custom_nda_url]);
      await supabase
        .from('client_profiles')
        .update({ custom_nda_url: null, custom_nda_filename: null })
        .eq('user_id', session.user.id);

      qc.invalidateQueries({ queryKey: ['client-nda-doc'] });
      toast.success(t('nda.removed', 'Custom NDA removed'));
    } catch (err: any) {
      toast.error(err.message || 'Remove failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    if (!clientProfile?.custom_nda_url) return;
    const { data, error } = await supabase.storage
      .from('nda-documents')
      .createSignedUrl(clientProfile.custom_nda_url, 3600);
    if (error || !data?.signedUrl) {
      toast.error('Could not generate download link');
      return;
    }
    openExternal(data.signedUrl);
  };

  const hasFile = !!clientProfile?.custom_nda_url;
  const useCustom = clientProfile?.use_custom_nda !== false;
  const hasCustomNDA = hasFile;

  const setChoice = async (value: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { error } = await supabase
      .from('client_profiles')
      .update({ use_custom_nda: value })
      .eq('user_id', session.user.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ['client-nda-doc'] });
    toast.success(value
      ? t('nda.choice_custom_saved', 'Consultants will now sign your own NDA')
      : t('nda.choice_portal_saved', 'Consultants will now sign the portal NDA'));
  };

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileSignature className="w-4 h-4 text-primary" />
          {t('nda.custom_nda_title', 'Custom NDA Document')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('nda.custom_nda_desc', 'Upload your own NDA document that consultants must sign before working on your tickets. If not uploaded, the platform default NDA will be used.')}
        </p>

        <div role="radiogroup" aria-label={t('nda.choice_label', 'Which NDA should consultants sign?')} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { v: false, title: t('nda.choice_portal', 'Portal NDA'), desc: t('nda.choice_portal_desc', 'Use the standard agreement provided by the portal') },
            { v: true, title: t('nda.choice_custom', 'My company NDA'), desc: hasFile ? t('nda.choice_custom_desc', 'Replace the portal NDA with your uploaded document') : t('nda.choice_custom_need_file', 'Upload your document below to use it') },
          ].map((o) => {
            const selected = hasFile ? useCustom === o.v : o.v === false;
            return (
              <button
                key={String(o.v)}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={o.v && !hasFile}
                onClick={() => !selected && setChoice(o.v)}
                className={`text-start p-3 rounded-xl border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
              >
                <p className="text-sm font-medium">{o.title}</p>
                <p className="text-xs text-muted-foreground">{o.desc}</p>
              </button>
            );
          })}
        </div>

        {hasCustomNDA ? (
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/50">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{clientProfile?.custom_nda_filename || 'custom-nda'}</p>
                <p className="text-xs text-muted-foreground">{useCustom ? t('nda.custom_active', 'Active — consultants will sign this NDA') : t('nda.custom_inactive', 'Saved — not used while Portal NDA is selected')}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownload}>
                <Download className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={handleRemove} disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full h-20 border-dashed gap-2 flex-col"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t('nda.upload_nda', 'Upload NDA (PDF, DOC, DOCX)')}</span>
              </>
            )}
          </Button>
        )}

        {hasCustomNDA && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="w-3.5 h-3.5" />
            {t('nda.replace_nda', 'Replace NDA')}
          </Button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx"
          className="hidden"
          onChange={handleUpload}
        />
      </CardContent>
    </Card>
  );
}
