import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { FileSignature, PenTool, Type } from 'lucide-react';
import { useNDATemplate, useNDAAgreement } from '@/hooks/useNDA';
import { supabase } from '@/integrations/supabase/client';

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
  const { signNDA } = useNDAAgreement(consultantId, clientId);

  const [consultantName, setConsultantName] = useState('');
  const [consultantEmail, setConsultantEmail] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientDisplayName, setClientDisplayName] = useState(clientName || '');
  const [clientIndustry, setClientIndustry] = useState('');
  const [clientSapModules, setClientSapModules] = useState('');

  // Fetch consultant & client details when modal opens
  useEffect(() => {
    if (!open) return;

    // Fetch consultant details
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

          // Get consultant email from auth
          supabase.auth.getUser().then(({ data: authData }) => {
            setConsultantEmail(authData?.user?.email || '');
          });
        }
      });

    // Fetch client profile details
    supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', clientId)
      .maybeSingle()
      .then(({ data }) => setClientDisplayName(data?.display_name || clientName || ''));

    supabase
      .from('client_profiles')
      .select('company_name, industry, sap_modules')
      .eq('user_id', clientId)
      .maybeSingle()
      .then(({ data }) => {
        setClientCompany(data?.company_name || '');
        setClientIndustry(data?.industry || '');
        setClientSapModules((data?.sap_modules || []).join(', '));
      });
  }, [open, consultantId, clientId, clientName]);

  // Replace placeholders in template
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

  // Canvas for draw signature
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!open) {
      setTypedName('');
      setAgreed(false);
      setHasDrawn(false);
      setSigType('type');
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

    const success = await signNDA(sigData, sigType, filledTemplate);
    setSubmitting(false);
    if (success) {
      onOpenChange(false);
      onSigned?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-primary" />
            {t('nda.title', 'Non-Disclosure Agreement')}
          </DialogTitle>
          {clientName && (
            <p className="text-sm text-muted-foreground">
              {t('nda.for_client', 'For client: {{name}}', { name: clientName })}
            </p>
          )}
        </DialogHeader>

        {/* NDA Content */}
        <ScrollArea className="flex-1 max-h-[280px] border rounded-lg p-4 bg-muted/30">
          {templateLoading ? (
            <p className="text-muted-foreground">{t('nda.loading', 'Loading...')}</p>
          ) : (
            <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">
              {filledTemplate}
            </pre>
          )}
        </ScrollArea>

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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSign} disabled={!canSubmit || submitting}>
            {submitting
              ? t('nda.signing', 'Signing...')
              : t('nda.sign_button', 'Sign NDA')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
