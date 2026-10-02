import { useState, useRef, useEffect, useMemo } from 'react';
import { Download, ExternalLink, Eye, ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { FileSignature, PenTool, Type, AlertTriangle } from 'lucide-react';
import { useNDATemplate, useNDAAgreement } from '@/hooks/useNDA';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { exportNDAAsPDF } from '@/lib/ndaPdfExport';
import { openExternal } from '@/lib/safeUrl';

interface NDASigningModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  clientId: string;
  clientName?: string;
  onSigned?: () => void;
}

export default function NDASigningModal({
  open, onOpenChange, consultantId, clientId, clientName, onSigned,
}: NDASigningModalProps) {
  const { t } = useTranslation();
  const { template, loading: templateLoading } = useNDATemplate();
  const { signNDA, wasRevoked } = useNDAAgreement(consultantId, clientId);

  const [step, setStep] = useState<'preview' | 'sign'>('preview');
  const [consultantName, setConsultantName] = useState('');
  const [consultantEmail, setConsultantEmail] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientDisplayName, setClientDisplayName] = useState(clientName || '');
  const [clientIndustry, setClientIndustry] = useState('');
  const [clientSapModules, setClientSapModules] = useState('');
  const [customNdaUrl, setCustomNdaUrl] = useState<string | null>(null);
  const [customNdaFilename, setCustomNdaFilename] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    supabase
      .from('consultants')
      .select('user_id')
      .eq('id', consultantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.user_id) {
          supabase
            .from('profiles')
            .select('display_name')
            .eq('user_id', data.user_id)
            .maybeSingle()
            .then(({ data: p }) => setConsultantName(p?.display_name || ''));

          supabase.auth.getUser().then(({ data: authData }) => {
            setConsultantEmail(authData?.user?.email || '');
          });
        }
      });

    supabase
      .from('profile_directory')
      .select('display_name')
      .eq('user_id', clientId)
      .maybeSingle()
      .then(({ data }) => setClientDisplayName(data?.display_name || clientName || ''));

    supabase
      .from('client_profiles')
      .select('company_name, industry, sap_modules, custom_nda_url, custom_nda_filename')
      .eq('user_id', clientId)
      .maybeSingle()
      .then(({ data }) => {
        setClientCompany(data?.company_name || '');
        setClientIndustry(data?.industry || '');
        setClientSapModules((data?.sap_modules || []).join(', '));
        setCustomNdaUrl(data?.custom_nda_url || null);
        setCustomNdaFilename(data?.custom_nda_filename || null);
      });
  }, [open, consultantId, clientId, clientName]);

  const hasCustomNDA = !!customNdaUrl;

  const [customNdaPublicUrl, setCustomNdaPublicUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!customNdaUrl) {
      setCustomNdaPublicUrl(null);
      return;
    }
    supabase.storage
      .from('nda-documents')
      .createSignedUrl(customNdaUrl, 3600)
      .then(({ data }) => {
        if (!cancelled) setCustomNdaPublicUrl(data?.signedUrl ?? null);
      });
    return () => { cancelled = true; };
  }, [customNdaUrl]);

  const filledTemplate = useMemo(() => {
    return template
      .replace(/\{\{consultant_name\}\}/g, consultantName || '_______________')
      .replace(/\{\{consultant_email\}\}/g, consultantEmail || '_______________')
      .replace(/\{\{client_name\}\}/g, clientDisplayName || '_______________')
      .replace(/\{\{client_company\}\}/g, clientCompany || '_______________')
      .replace(/\{\{client_industry\}\}/g, clientIndustry || '_______________')
      .replace(/\{\{sap_modules\}\}/g, clientSapModules || '_______________')
      .replace(/\{\{date\}\}/g, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
  }, [template, consultantName, consultantEmail, clientDisplayName, clientCompany, clientIndustry, clientSapModules]);

  const [sigType, setSigType] = useState<'draw' | 'type'>('type');
  const [typedName, setTypedName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!open) {
      setTypedName('');
      setAgreed(false);
      setHasDrawn(false);
      setSigType('type');
      setStep('preview');
    }
  }, [open]);

  useEffect(() => {
    if (open && sigType === 'draw' && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
  }, [open, sigType]);

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = '#1B2559';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDraw = () => setIsDrawing(false);

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHasDrawn(false);
    }
  };

  const canSubmit =
    agreed &&
    (sigType === 'type' ? typedName.trim().length >= 2 : hasDrawn);

  const handleSign = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const sigData =
      sigType === 'draw'
        ? canvasRef.current!.toDataURL('image/png')
        : typedName.trim();

    const ndaContentForRecord = hasCustomNDA
      ? `[Custom NDA Document: ${customNdaFilename}] ${customNdaPublicUrl}`
      : filledTemplate;
    const success = await signNDA(sigData, sigType, ndaContentForRecord);
    setSubmitting(false);
    if (success) {
      onOpenChange(false);
      onSigned?.();
    }
  };

  const handleDownloadPreview = async () => {
    if (hasCustomNDA && customNdaPublicUrl) {
      openExternal(customNdaPublicUrl);
      return;
    }
    await exportNDAAsPDF({
      ndaContent: filledTemplate,
      signatureData: '',
      signatureType: 'type',
      signedAt: new Date().toISOString(),
      consultantName: consultantName || 'Consultant',
      clientName: clientDisplayName || 'Client',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-primary" />
            {step === 'preview'
              ? t('nda.preview_title', 'Review NDA Before Signing')
              : t('nda.title', 'Sign Non-Disclosure Agreement')}
          </DialogTitle>
          {clientName && (
            <p className="text-sm text-muted-foreground">
              {t('nda.for_client', 'For client: {{name}}', { name: clientName })}
            </p>
          )}
          {/* Step indicator */}
          <div className="flex items-center gap-2 pt-1">
            <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${step === 'preview' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              <Eye className="w-3 h-3" />
              1. {t('nda.step_review', 'Review')}
            </div>
            <div className="w-4 h-px bg-border" />
            <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${step === 'sign' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              <PenTool className="w-3 h-3" />
              2. {t('nda.step_sign', 'Sign')}
            </div>
          </div>
        </DialogHeader>

        {wasRevoked && (
          <Alert variant="destructive" className="border-destructive/50">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t('nda.revoked_warning', 'Your previous NDA for this client was revoked. Please review and sign the agreement again to continue providing support.')}
            </AlertDescription>
          </Alert>
        )}

        {step === 'preview' ? (
          /* ========== PREVIEW STEP ========== */
          <>
            {hasCustomNDA ? (
              <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <FileText className="w-4 h-4 text-primary" />
                  {t('nda.custom_nda_label', 'Client Custom NDA Document')}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('nda.custom_nda_review', 'The client has provided a custom NDA. Please download, review, and sign below to confirm your agreement.')}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <a href={customNdaPublicUrl || '#'} target="_blank" rel="noopener noreferrer">
                      <Download className="w-3.5 h-3.5" />
                      {customNdaFilename || 'Download NDA'}
                    </a>
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1.5" asChild>
                    <a href={customNdaPublicUrl || '#'} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                      {t('nda.open_in_tab', 'Open in New Tab')}
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <ScrollArea className="flex-1 max-h-[380px] border rounded-lg p-4 bg-muted/30">
                {templateLoading ? (
                  <p className="text-muted-foreground">{t('nda.loading', 'Loading...')}</p>
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">
                    {filledTemplate}
                  </pre>
                )}
              </ScrollArea>
            )}

            <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/50 border border-accent">
              <Eye className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">
                {t('nda.preview_hint', 'Please read the entire agreement carefully before proceeding to sign. You can also download it as PDF for offline review.')}
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" className="gap-1.5" onClick={handleDownloadPreview}>
                <Download className="w-4 h-4" />
                {t('nda.download_pdf', 'Download PDF')}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button className="gap-1.5" onClick={() => setStep('sign')}>
                {t('nda.proceed_to_sign', 'Proceed to Sign')}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ========== SIGN STEP ========== */
          <>
            {/* Collapsed NDA reference */}
            {!hasCustomNDA && (
              <div className="border rounded-lg p-3 bg-muted/20">
                <ScrollArea className="max-h-[120px]">
                  <pre className="whitespace-pre-wrap text-xs font-sans text-muted-foreground leading-relaxed">
                    {filledTemplate}
                  </pre>
                </ScrollArea>
              </div>
            )}

            {/* Agreement Checkbox */}
            <div className="flex items-start gap-2 py-2">
              <Checkbox
                id="nda-agree"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
              />
              <label htmlFor="nda-agree" className="text-sm leading-snug cursor-pointer">
                {t('nda.agree_text', 'I have read and agree to the terms of this Non-Disclosure Agreement')}
              </label>
            </div>

            {/* Signature */}
            <Tabs value={sigType} onValueChange={(v) => setSigType(v as 'draw' | 'type')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="type" className="flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5" />
                  {t('nda.type_signature', 'Type Signature')}
                </TabsTrigger>
                <TabsTrigger value="draw" className="flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5" />
                  {t('nda.draw_signature', 'Draw Signature')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="type" className="mt-3">
                <Input
                  placeholder={t('nda.type_placeholder', 'Type your full name as signature')}
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="text-lg font-serif italic"
                />
              </TabsContent>

              <TabsContent value="draw" className="mt-3 space-y-2">
                <div className="border rounded-lg overflow-hidden bg-white">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={150}
                    className="w-full cursor-crosshair touch-none"
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={stopDraw}
                    onMouseLeave={stopDraw}
                    onTouchStart={startDraw}
                    onTouchMove={draw}
                    onTouchEnd={stopDraw}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={clearCanvas}>
                  {t('nda.clear', 'Clear')}
                </Button>
              </TabsContent>
            </Tabs>

            <DialogFooter className="gap-2">
              <Button variant="ghost" className="gap-1.5" onClick={() => setStep('preview')}>
                <ArrowLeft className="w-4 h-4" />
                {t('nda.back_to_review', 'Back to Review')}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={handleSign} disabled={!canSubmit || submitting}>
                {submitting
                  ? t('nda.signing', 'Signing...')
                  : t('nda.sign_button', 'Sign NDA')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}