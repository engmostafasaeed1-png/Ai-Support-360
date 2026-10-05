import { useEffect, useRef, useState } from 'react';
import { FileSignature, PenTool, Type } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ndaId: string;
  ndaContent: string;
  consultantName: string;
  defaultName?: string;
  onSigned?: () => void;
}

export default function ClientSignNDADialog({ open, onOpenChange, ndaId, ndaContent, consultantName, defaultName, onSigned }: Props) {
  const { toast } = useToast();
  const [sigType, setSigType] = useState<'type' | 'draw'>('type');
  const [fullName, setFullName] = useState(defaultName || '');
  const [typed, setTyped] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (open) { setFullName(defaultName || ''); setTyped(''); setAgreed(false); setHasDrawn(false); setSigType('type'); }
  }, [open, defaultName]);

  useEffect(() => {
    const c = canvasRef.current;
    if (open && sigType === 'draw' && c) {
      const ctx = c.getContext('2d');
      if (ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
    }
  }, [open, sigType]);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); setDrawing(true);
    const ctx = canvasRef.current!.getContext('2d')!; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.strokeStyle = '#1B2559'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return; e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!; const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke(); setHasDrawn(true);
  };
  const clear = () => {
    const c = canvasRef.current; const ctx = c?.getContext('2d');
    if (c && ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); setHasDrawn(false); }
  };

  const nameOk = fullName.trim().length >= 2;
  const sigOk = sigType === 'type' ? typed.trim().length >= 2 : hasDrawn;
  const canSign = agreed && nameOk && sigOk;

  const sign = async () => {
    if (!canSign) return;
    setBusy(true);
    const sig = sigType === 'draw' ? canvasRef.current!.toDataURL('image/png') : typed.trim();
    const { error } = await supabase.rpc('client_sign_nda', {
      _nda_id: ndaId, _signature: sig, _signature_type: sigType, _signer_name: fullName.trim(),
    });
    setBusy(false);
    if (error) {
      toast({ title: 'Could not sign', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'NDA signed', description: `Both signatures are on the document. ${consultantName} has been notified.` });
    onOpenChange(false);
    onSigned?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-primary" /> Sign the NDA as client
          </DialogTitle>
          <DialogDescription>Already signed by {consultantName}. Add your signature to complete the agreement.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[180px] border rounded-lg p-3 bg-muted/30">
          <pre className="whitespace-pre-wrap text-xs font-sans text-muted-foreground leading-relaxed">{ndaContent}</pre>
        </ScrollArea>

        <div className="space-y-1">
          <label htmlFor="client-signer-name" className="text-sm font-medium">Your full name</label>
          <Input id="client-signer-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
        </div>

        <div className="flex items-start gap-2">
          <Checkbox id="client-nda-agree" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
          <label htmlFor="client-nda-agree" className="text-sm leading-snug cursor-pointer">
            I have read and agree to the terms of this Non-Disclosure Agreement on behalf of my company
          </label>
        </div>

        <Tabs value={sigType} onValueChange={(v) => setSigType(v as 'type' | 'draw')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="type" className="gap-1.5"><Type className="w-3.5 h-3.5" /> Type signature</TabsTrigger>
            <TabsTrigger value="draw" className="gap-1.5"><PenTool className="w-3.5 h-3.5" /> Draw signature</TabsTrigger>
          </TabsList>
          <TabsContent value="type" className="mt-3">
            <Input placeholder="Type your signature" value={typed} onChange={(e) => setTyped(e.target.value)} className="text-lg font-serif italic" />
          </TabsContent>
          <TabsContent value="draw" className="mt-3 space-y-2">
            <div className="border rounded-lg overflow-hidden bg-card">
              <canvas ref={canvasRef} width={500} height={150} className="w-full cursor-crosshair touch-none"
                onMouseDown={start} onMouseMove={move} onMouseUp={() => setDrawing(false)} onMouseLeave={() => setDrawing(false)}
                onTouchStart={start} onTouchMove={move} onTouchEnd={() => setDrawing(false)} />
            </div>
            <Button variant="outline" size="sm" onClick={clear}>Clear</Button>
          </TabsContent>
        </Tabs>

        {!canSign && (
          <p className="text-xs text-destructive">
            {!nameOk ? 'Enter your full name.' : !agreed ? 'Tick "I have read and agree" to enable signing.' : sigType === 'type' ? 'Type your signature.' : 'Draw your signature in the box.'}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={sign} disabled={!canSign || busy}>{busy ? 'Signing...' : 'Sign NDA'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
