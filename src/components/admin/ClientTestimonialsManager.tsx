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
import {
  Loader2, Plus, Save, Trash2, Upload, Quote, ImageIcon, Send,
  CheckCircle2, XCircle, EyeOff, Star, GripVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import LogoCropDialog from './LogoCropDialog';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type TestimonialStatus = 'draft' | 'pending_review' | 'published';

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
  is_featured: boolean;
  status: TestimonialStatus;
  rejected_reason: string | null;
  submitted_at: string | null;
  published_at: string | null;
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

  // Role detection — drives which moderation actions are available.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    fetchAll();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      setIsSuperAdmin(!!data?.some((r: any) => r.role === 'super_admin'));
    })();
  }, []);

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
    // Strip moderation timestamps — those are owned by the trigger.
    const { id, status, submitted_at, published_at, rejected_reason, ...rest } = item;
    const { data, error } = await supabase
      .from('client_testimonials')
      .update(rest)
      .eq('id', id)
      .select()
      .single();
    setSavingId(null);
    if (error) {
      toast.error('Save failed', { description: error.message });
      return;
    }
    // Re-sync from the server so we pick up any status flip the trigger
    // applied (e.g. published → pending_review when an admin edits).
    if (data) {
      patchItem(id, data as Partial<Testimonial>);
      const newStatus = (data as Testimonial).status;
      if (newStatus === 'pending_review' && status === 'published') {
        toast.info('Saved — sent back for review', {
          description: 'Edits to a published testimonial require super-admin approval.',
        });
      } else {
        toast.success('Testimonial saved');
      }
    }
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
        status: 'draft',
      })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error('Could not create', { description: error?.message });
      return;
    }
    setItems((prev) => [...prev, data as Testimonial]);
    toast.success('Testimonial created', { description: 'Saved as draft.' });
  }

  async function deleteItem(item: Testimonial) {
    const { error } = await supabase.from('client_testimonials').delete().eq('id', item.id);
    if (error) { toast.error('Delete failed', { description: error.message }); return; }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast.success('Deleted');
  }

  // ── Moderation actions ────────────────────────────────────────────────
  async function setStatus(item: Testimonial, status: TestimonialStatus, extra: Partial<Testimonial> = {}) {
    const { data, error } = await supabase
      .from('client_testimonials')
      .update({ status, ...extra })
      .eq('id', item.id)
      .select()
      .single();
    if (error) {
      toast.error('Could not update status', { description: error.message });
      return;
    }
    if (data) patchItem(item.id, data as Partial<Testimonial>);
  }

  async function submitForReview(item: Testimonial) {
    await setStatus(item, 'pending_review');
    toast.success('Submitted for review', {
      description: 'A super admin will approve this before it goes live.',
    });
  }

  async function approveAndPublish(item: Testimonial) {
    await setStatus(item, 'published', { rejected_reason: null });
    toast.success('Published', { description: 'This testimonial is now live.' });
  }

  async function unpublish(item: Testimonial) {
    await setStatus(item, 'draft');
    toast.success('Unpublished', { description: 'Hidden from the public landing page.' });
  }

  async function reject(item: Testimonial, reason: string) {
    await setStatus(item, 'draft', { rejected_reason: reason || 'Sent back for changes.' });
    toast.success('Sent back to draft', { description: 'The author will see your note.' });
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
      // Send the cropped PNG to the edge function for server-side
      // validation (1:1 square, exactly 512×512, transparent PNG, ≤ 2MB)
      // before it ever lands in storage.
      const file = new File([blob], 'logo.png', { type: 'image/png' });
      const form = new FormData();
      form.append('testimonial_id', id);
      form.append('file', file);

      const { data, error } = await supabase.functions.invoke('validate-client-logo', {
        body: form,
      });

      // `functions.invoke` only sets `error` on transport / non-2xx;
      // for 4xx the body still contains our structured error payload.
      const payload = (data ?? (error as any)?.context?.json?.()) as
        | { ok: true; logo_url: string }
        | { ok: false; code: string; message: string }
        | undefined;

      let resolved = payload;
      if (!resolved && error) {
        // Try to read JSON body off the failed response.
        try {
          const ctx = (error as any).context;
          if (ctx?.body) resolved = await new Response(ctx.body).json();
        } catch {
          /* fall through */
        }
      }

      if (!resolved || resolved.ok !== true) {
        const code = (resolved as any)?.code ?? 'internal';
        const msg = (resolved as any)?.message ?? error?.message ?? 'Validation failed';
        toast.error(humanizeLogoErrorTitle(code), { description: msg });
        return;
      }

      patchItem(id, { logo_url: resolved.logo_url });
      toast.success('Logo updated', {
        description: 'Validated as a transparent 512×512 PNG.',
      });
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
                    {item.status === 'draft' && item.rejected_reason && (
                      <p className="mt-1 text-[11px] text-destructive">
                        Sent back: {item.rejected_reason}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={item.status} />
                  <Badge variant={item.is_active ? 'default' : 'outline'} className="text-[10px]">
                    {item.is_active ? 'Visible' : 'Hidden'}
                  </Badge>
                  <Switch
                    checked={item.is_active}
                    onCheckedChange={(v) => patchItem(item.id, { is_active: v })}
                    aria-label="Toggle visibility"
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

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <ModerationActions
                      item={item}
                      isSuperAdmin={isSuperAdmin}
                      onSubmit={() => submitForReview(item)}
                      onApprove={() => approveAndPublish(item)}
                      onReject={(reason) => reject(item, reason)}
                      onUnpublish={() => unpublish(item)}
                    />

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

/**
 * Map the structured `code` returned by the validate-client-logo edge
 * function to a short, human-friendly toast title. Keep titles to a
 * single line — the full server message is shown in the description.
 */
function humanizeLogoErrorTitle(code: string): string {
  switch (code) {
    case 'unauthenticated':  return 'Please sign in again';
    case 'forbidden':        return 'Admin role required';
    case 'missing_fields':   return 'Missing upload data';
    case 'bad_mime':         return 'Wrong file type';
    case 'file_too_large':   return 'File too large';
    case 'unreadable_png':   return 'Invalid PNG file';
    case 'wrong_dimensions': return 'Wrong dimensions';
    case 'not_square':       return 'Logo is not square';
    case 'not_transparent':  return 'Background is not transparent';
    case 'upload_failed':    return 'Could not save the logo';
    case 'db_update_failed': return 'Saved file but failed to link it';
    default:                 return 'Logo validation failed';
  }
}

/**
 * Compact status pill shown next to each testimonial card. Status flow:
 *  - draft           → not visible to the public; admin is editing
 *  - pending_review  → admin asked for super-admin approval
 *  - published       → visible on the public landing page (if active)
 */
function StatusBadge({ status }: { status: TestimonialStatus }) {
  const map = {
    draft:          { label: 'Draft',        className: 'bg-muted text-muted-foreground border-transparent' },
    pending_review: { label: 'Pending review', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
    published:      { label: 'Published',    className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  } as const;
  const s = map[status];
  return (
    <Badge variant="outline" className={`text-[10px] font-semibold ${s.className}`}>
      {s.label}
    </Badge>
  );
}

/**
 * Moderation buttons rendered per testimonial. The available actions
 * depend on the row's status and the caller's role:
 *
 *   draft           → admin: Submit for review · super: Publish
 *   pending_review  → super: Approve & Publish · Reject (with reason)
 *   published       → super: Unpublish
 *
 * All transitions are also enforced server-side by the
 * `guard_testimonial_publish` trigger, so the UI is purely a guard rail.
 */
function ModerationActions({
  item, isSuperAdmin, onSubmit, onApprove, onReject, onUnpublish,
}: {
  item: Testimonial;
  isSuperAdmin: boolean;
  onSubmit: () => void | Promise<void>;
  onApprove: () => void | Promise<void>;
  onReject: (reason: string) => void | Promise<void>;
  onUnpublish: () => void | Promise<void>;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  // Draft → submit for review (admin) or publish directly (super).
  if (item.status === 'draft') {
    return (
      <>
        {!isSuperAdmin && (
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={onSubmit}>
            <Send className="w-4 h-4" /> Submit for review
          </Button>
        )}
        {isSuperAdmin && (
          <Button variant="default" size="sm" className="gap-1.5" onClick={onApprove}>
            <CheckCircle2 className="w-4 h-4" /> Publish
          </Button>
        )}
      </>
    );
  }

  // Pending → super-admin approves or rejects.
  if (item.status === 'pending_review') {
    if (!isSuperAdmin) {
      return (
        <span className="text-xs text-muted-foreground italic">
          Awaiting super-admin approval
        </span>
      );
    }
    return (
      <>
        <Button variant="default" size="sm" className="gap-1.5" onClick={onApprove}>
          <CheckCircle2 className="w-4 h-4" /> Approve &amp; Publish
        </Button>
        <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <XCircle className="w-4 h-4" /> Reject
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send back for changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Add a short note so the author knows what to fix. The testimonial returns to draft.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Replace the logo with a higher-resolution version."
              rows={3}
              className="text-sm"
            />
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setReason('')}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => { await onReject(reason.trim()); setReason(''); }}
              >
                Send back
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // Published → only super-admin can unpublish.
  if (item.status === 'published' && isSuperAdmin) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onUnpublish}>
        <EyeOff className="w-4 h-4" /> Unpublish
      </Button>
    );
  }

  return null;
}
