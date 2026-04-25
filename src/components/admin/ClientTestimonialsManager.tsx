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
import { withCacheBust } from '@/lib/cacheBust';
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
  updated_at: string;
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

  // dnd-kit sensors — pointer for mouse/touch, keyboard for a11y so
  // admins can reorder rows without a mouse.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      // Mirror the public landing-page sort: featured first, then by
      // manual display_order. Reordering in the admin UI updates
      // display_order within each "bucket" (featured / not featured).
      .order('is_featured', { ascending: false })
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
        is_featured: false,
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

  // ── Featured + reordering ─────────────────────────────────────────────
  // Toggling featured is an immediate write so the bucket the row lives
  // in (featured vs not) updates without needing a full Save click.
  async function toggleFeatured(item: Testimonial, next: boolean) {
    // Optimistic flip
    patchItem(item.id, { is_featured: next });
    const { error } = await supabase
      .from('client_testimonials')
      .update({ is_featured: next })
      .eq('id', item.id);
    if (error) {
      patchItem(item.id, { is_featured: !next });
      toast.error('Could not update featured flag', { description: error.message });
      return;
    }
    toast.success(next ? 'Marked as featured' : 'Removed from featured');
  }

  // Persist a new visual order by writing a fresh display_order for
  // every affected row. We renumber 1..N inside each bucket so the
  // landing page sort (is_featured DESC, display_order ASC) matches
  // exactly what the admin sees here.
  async function persistOrder(next: Testimonial[]) {
    const featured = next.filter((t) => t.is_featured);
    const rest     = next.filter((t) => !t.is_featured);

    const renumbered = [
      ...featured.map((t, i) => ({ ...t, display_order: i + 1 })),
      ...rest.map((t, i)     => ({ ...t, display_order: i + 1 })),
    ];

    setItems(renumbered);

    // Batch the updates — one round-trip per row, but they're tiny.
    const updates = await Promise.all(
      renumbered.map((t) =>
        supabase
          .from('client_testimonials')
          .update({ display_order: t.display_order })
          .eq('id', t.id),
      ),
    );
    const failed = updates.find((u) => u.error);
    if (failed?.error) {
      toast.error('Order saved partially', { description: failed.error.message });
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((t) => t.id === active.id);
    const newIndex = items.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // Prevent dragging across the featured / non-featured boundary —
    // those buckets are independent and have their own ordering. The
    // user should toggle Featured to move a row between them.
    if (items[oldIndex].is_featured !== items[newIndex].is_featured) {
      toast.info('Toggle “Featured” to move between sections');
      return;
    }

    void persistOrder(arrayMove(items, oldIndex, newIndex));
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="grid gap-4">
              {items.map((item, idx) => {
                // Render a small visual divider where the featured
                // bucket ends, so the user understands why drags don't
                // cross that line.
                const prev = items[idx - 1];
                const showDivider = prev && prev.is_featured && !item.is_featured;
                return (
                  <div key={item.id} className="contents">
                    {showDivider && (
                      <div className="flex items-center gap-3 px-1 pt-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Other testimonials
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <SortableTestimonialRow
                      item={item}
                      savingId={savingId}
                      isSuperAdmin={isSuperAdmin}
                      onPatch={(patch) => patchItem(item.id, patch)}
                      onToggleFeatured={(v) => toggleFeatured(item, v)}
                      onPickFile={() => pickFileFor(item.id)}
                      onSave={() => saveItem(item)}
                      onDelete={() => deleteItem(item)}
                      onSubmitForReview={() => submitForReview(item)}
                      onApprove={() => approveAndPublish(item)}
                      onReject={(reason) => reject(item, reason)}
                      onUnpublish={() => unpublish(item)}
                    />
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/**
 * One sortable card. Owns the dnd-kit `useSortable` wiring so the
 * parent list stays declarative. The drag handle is a dedicated button
 * (rather than the whole card) to avoid hijacking text selection,
 * input focus, and dialog clicks inside the editor.
 */
function SortableTestimonialRow({
  item, savingId, isSuperAdmin,
  onPatch, onToggleFeatured, onPickFile, onSave, onDelete,
  onSubmitForReview, onApprove, onReject, onUnpublish,
}: {
  item: Testimonial;
  savingId: string | null;
  isSuperAdmin: boolean;
  onPatch: (patch: Partial<Testimonial>) => void;
  onToggleFeatured: (next: boolean) => void;
  onPickFile: () => void;
  onSave: () => void;
  onDelete: () => void;
  onSubmitForReview: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onUnpublish: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the dragged row above its siblings + dim the rest visually.
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl ${isDragging ? 'ring-2 ring-primary shadow-lg' : ''}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Drag handle — only this element listens for drag events. */}
          <button
            type="button"
            className="flex h-9 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
            aria-label={`Reorder ${item.name || 'testimonial'}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <LogoPreview url={withCacheBust(item.logo_url, item.updated_at)} accent={item.accent} name={item.name} />
          <div className="min-w-0">
            <CardTitle className="text-base truncate flex items-center gap-1.5">
              {item.name || 'Untitled'}
              {item.is_featured && (
                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" aria-label="Featured" />
              )}
            </CardTitle>
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
            onCheckedChange={(v) => onPatch({ is_active: v })}
            aria-label="Toggle visibility"
          />
        </div>
      </CardHeader>

      <CardContent className="grid md:grid-cols-2 gap-4">
        <Field label="Name">
          <Input value={item.name} onChange={(e) => onPatch({ name: e.target.value })} />
        </Field>
        <Field label="Role / title line">
          <Input value={item.role} onChange={(e) => onPatch({ role: e.target.value })} />
        </Field>
        <Field label="Company (used for logo alt text)">
          <Input value={item.company} onChange={(e) => onPatch({ company: e.target.value })} />
        </Field>
        <Field label="Display order (auto-managed by drag & drop)">
          <Input
            type="number"
            value={item.display_order}
            onChange={(e) => onPatch({ display_order: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Quote" className="md:col-span-2">
          <Textarea
            rows={3}
            value={item.quote}
            onChange={(e) => onPatch({ quote: e.target.value })}
          />
        </Field>
        <Field label="Rating (1–5)">
          <Input
            type="number"
            min={1}
            max={5}
            value={item.rating}
            onChange={(e) =>
              onPatch({ rating: Math.min(5, Math.max(1, Number(e.target.value) || 5)) })
            }
          />
        </Field>
        <Field label="Accent gradient">
          <select
            value={item.accent}
            onChange={(e) => onPatch({ accent: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {ACCENT_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>

        {/* Featured toggle — persists immediately so the row jumps to
            the right bucket without waiting for Save. */}
        <Field label="Featured" className="md:col-span-2">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Star className={`w-4 h-4 ${item.is_featured ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground'}`} />
              <span>
                {item.is_featured
                  ? 'Pinned to the top of the landing page'
                  : 'Shown after featured testimonials'}
              </span>
            </div>
            <Switch
              checked={item.is_featured}
              onCheckedChange={onToggleFeatured}
              aria-label="Toggle featured"
            />
          </div>
        </Field>

        <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button variant="outline" onClick={onPickFile} className="gap-2">
            <Upload className="w-4 h-4" />
            {item.logo_url ? 'Replace logo' : 'Upload logo'}
          </Button>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <ModerationActions
              item={item}
              isSuperAdmin={isSuperAdmin}
              onSubmit={onSubmitForReview}
              onApprove={onApprove}
              onReject={onReject}
              onUnpublish={onUnpublish}
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
                  <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button onClick={onSave} disabled={savingId === item.id} className="gap-2">
              {savingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
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
