import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Plus, Save, Trash2, Upload, Quote, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import LogoCropDialog from './LogoCropDialog';

type Testimonial = {
  id: string;
  name: string;
  role: string;
  company: string;
  quote: string;
  rating: number;
  accent: string;
  logo_url: string | null;
  display_order: number;
  is_active: boolean;
};

const ACCENT_PRESETS = [
  { label: 'Cyan / Blue',     value: 'from-cyan-500 to-blue-600' },
  { label: 'Violet / Purple', value: 'from-violet-500 to-purple-600' },
  { label: 'Emerald / Teal',  value: 'from-emerald-500 to-teal-600' },
  { label: 'Amber / Orange',  value: 'from-amber-500 to-orange-600' },
  { label: 'Rose / Pink',     value: 'from-rose-500 to-pink-600' },
];

export default function ClientTestimonialsManager() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const { data, error } = await supabase
      .from('client_testimonials')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) toast.error('Failed to load testimonials', { description: error.message });
    setItems((data as Testimonial[]) || []);
    setLoading(false);
  }

  function patchItem(id: string, patch: Partial<Testimonial>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function saveItem(item: Testimonial) {
    setSavingId(item.id);
    const { id, ...rest } = item;
    const { error } = await supabase.from('client_testimonials').update(rest).eq('id', id);
    setSavingId(null);
    if (error) toast.error('Save failed', { description: error.message });
    else toast.success('Testimonial saved');
  }

  async function createItem() {
    setCreating(true);
    const { data, error } = await supabase
      .from('client_testimonials')
      .insert({
        name: 'New Client',
        role: 'Title, Company',
        company: 'Company',
        quote: 'Their words about working with us…',
        rating: 5,
        accent: 'from-cyan-500 to-blue-600',
        display_order: (items.at(-1)?.display_order ?? 0) + 1,
        is_active: false,
      })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error('Could not create', { description: error?.message });
      return;
    }
    setItems((prev) => [...prev, data as Testimonial]);
    toast.success('Testimonial created');
  }

  async function deleteItem(item: Testimonial) {
    const { error } = await supabase.from('client_testimonials').delete().eq('id', item.id);
    if (error) { toast.error('Delete failed', { description: error.message }); return; }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast.success('Deleted');
  }

  function pickFileFor(id: string) {
    setCropTargetId(id);
    fileInputRef.current?.click();
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    const url = URL.createObjectURL(file);
    setCropSrc(url);
    setCropOpen(true);
  }

  async function handleCropConfirm(blob: Blob) {
    if (!cropTargetId) return;
    const id = cropTargetId;
    try {
      const path = `${id}/${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from('client-logos')
        .upload(path, blob, { contentType: 'image/png', upsert: true });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from('client-logos').getPublicUrl(path);
      const cacheBusted = `${publicUrl}?t=${Date.now()}`;

      const { error: updErr } = await supabase
        .from('client_testimonials')
        .update({ logo_url: cacheBusted })
        .eq('id', id);
      if (updErr) throw updErr;

      patchItem(id, { logo_url: cacheBusted });
      toast.success('Logo updated');
    } catch (err: any) {
      toast.error('Upload failed', { description: err.message });
    } finally {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
      setCropOpen(false);
      setCropTargetId(null);
    }
  }

  function cancelCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setCropOpen(false);
    setCropTargetId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Quote className="w-5 h-5 text-primary" />
            Client Testimonials
          </h2>
          <p className="text-xs text-muted-foreground">
            Manage the cards shown in the “What Our Clients Say” section. Upload square 1:1 logos for best results.
          </p>
        </div>
        <Button onClick={createItem} disabled={creating} className="gap-2">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add testimonial
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />

      <LogoCropDialog
        imageSrc={cropSrc}
        open={cropOpen}
        onCancel={cancelCrop}
        onConfirm={handleCropConfirm}
      />

      {items.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No testimonials yet. Add one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <Card key={item.id} className="rounded-2xl">
              <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
                <div className="flex items-center gap-4 min-w-0">
                  <LogoPreview url={item.logo_url} accent={item.accent} name={item.name} />
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{item.name || 'Untitled'}</CardTitle>
                    <CardDescription className="truncate">{item.company}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={item.is_active ? 'default' : 'outline'} className="text-[10px]">
                    {item.is_active ? 'Live' : 'Hidden'}
                  </Badge>
                  <Switch
                    checked={item.is_active}
                    onCheckedChange={(v) => patchItem(item.id, { is_active: v })}
                  />
                </div>
              </CardHeader>

              <CardContent className="grid md:grid-cols-2 gap-4">
                <Field label="Name">
                  <Input value={item.name} onChange={(e) => patchItem(item.id, { name: e.target.value })} />
                </Field>
                <Field label="Role / title line">
                  <Input value={item.role} onChange={(e) => patchItem(item.id, { role: e.target.value })} />
                </Field>
                <Field label="Company (used for logo alt text)">
                  <Input value={item.company} onChange={(e) => patchItem(item.id, { company: e.target.value })} />
                </Field>
                <Field label="Display order">
                  <Input
                    type="number"
                    value={item.display_order}
                    onChange={(e) => patchItem(item.id, { display_order: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label="Quote" className="md:col-span-2">
                  <Textarea
                    rows={3}
                    value={item.quote}
                    onChange={(e) => patchItem(item.id, { quote: e.target.value })}
                  />
                </Field>
                <Field label="Rating (1–5)">
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={item.rating}
                    onChange={(e) =>
                      patchItem(item.id, {
                        rating: Math.min(5, Math.max(1, Number(e.target.value) || 5)),
                      })
                    }
                  />
                </Field>
                <Field label="Accent gradient">
                  <select
                    value={item.accent}
                    onChange={(e) => patchItem(item.id, { accent: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {ACCENT_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </Field>

                <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-2">
                  <Button variant="outline" onClick={() => pickFileFor(item.id)} className="gap-2">
                    <Upload className="w-4 h-4" />
                    {item.logo_url ? 'Replace logo' : 'Upload logo'}
                  </Button>

                  <div className="flex items-center gap-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive gap-1.5">
                          <Trash2 className="w-4 h-4" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete testimonial?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the testimonial from the landing page. The uploaded logo file is kept in storage.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteItem(item)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    <Button onClick={() => saveItem(item)} disabled={savingId === item.id} className="gap-2">
                      {savingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function LogoPreview({ url, accent, name }: { url: string | null; accent: string; name: string }) {
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?';
  return (
    <div className="relative w-14 h-14 rounded-2xl overflow-hidden border border-border/50 bg-card flex items-center justify-center shadow-sm">
      {url ? (
        <img src={url} alt={`${name} logo preview`} className="w-full h-full object-contain p-1.5" />
      ) : (
        <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${accent} text-white text-xs font-bold`}>
          {initials || <ImageIcon className="w-5 h-5 opacity-70" />}
        </div>
      )}
    </div>
  );
}
