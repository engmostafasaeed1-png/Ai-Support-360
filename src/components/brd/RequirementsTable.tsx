import { useTranslation } from 'react-i18next';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LIMITS, REQ_PRIORITIES, REQ_STATUSES, emptyRequirement, renumberRequirements,
  type BrdRequirement,
} from '../../../supabase/functions/_shared/brdModel';

interface Props {
  rows: BrdRequirement[];
  onChange: (rows: BrdRequirement[]) => void;
  bilingual: boolean;
  readOnly?: boolean;
  dir: 'ltr' | 'rtl';
}

function Row({ row, index, update, remove, bilingual, readOnly, dir }: {
  row: BrdRequirement; index: number; update: (patch: Partial<BrdRequirement>) => void; remove: () => void; bilingual: boolean; readOnly?: boolean; dir: 'ltr' | 'rtl';
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `req-${index}` });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li ref={setNodeRef} style={style} className={`rounded-xl border border-border bg-card p-3 space-y-2 ${isDragging ? 'shadow-lg ring-2 ring-accent' : ''}`}>
      <div className="flex items-center gap-2">
        {!readOnly && (
          <button type="button" className="cursor-grab text-muted-foreground p-1 rounded focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('brd.req.drag', { id: row.id })} {...attributes} {...listeners}>
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <span className="font-semibold text-sm">{row.id}</span>
        <div className="flex-1" />
        <Select value={row.priority} onValueChange={(v) => update({ priority: v as BrdRequirement['priority'] })} disabled={readOnly}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label={t('brd.req.priority')}><SelectValue /></SelectTrigger>
          <SelectContent>{REQ_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{t(`brd.req.p_${p}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={row.status} onValueChange={(v) => update({ status: v as BrdRequirement['status'] })} disabled={readOnly}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label={t('brd.req.status')}><SelectValue /></SelectTrigger>
          <SelectContent>{REQ_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`brd.req.s_${s}`)}</SelectItem>)}</SelectContent>
        </Select>
        {!readOnly && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={remove} aria-label={t('brd.req.remove', { id: row.id })}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <Textarea dir={dir} value={row.description} maxLength={LIMITS.reqText} readOnly={readOnly} rows={2} spellCheck
        aria-label={t('brd.req.description')} placeholder={t('brd.req.description')} onChange={(e) => update({ description: e.target.value })} />
      {bilingual && (
        <Textarea dir="rtl" lang="ar" value={row.description_ar ?? ''} maxLength={LIMITS.reqText} readOnly={readOnly} rows={2} spellCheck
          aria-label={t('brd.req.descriptionAr')} placeholder={t('brd.req.descriptionAr')} onChange={(e) => update({ description_ar: e.target.value })} />
      )}
      <Textarea dir={dir} value={row.acceptance} maxLength={LIMITS.reqText} readOnly={readOnly} rows={2} spellCheck
        aria-label={t('brd.req.acceptance')} placeholder={t('brd.req.acceptance')} onChange={(e) => update({ acceptance: e.target.value })} />
      {bilingual && (
        <Textarea dir="rtl" lang="ar" value={row.acceptance_ar ?? ''} maxLength={LIMITS.reqText} readOnly={readOnly} rows={2}
          aria-label={t('brd.req.acceptanceAr')} placeholder={t('brd.req.acceptanceAr')} onChange={(e) => update({ acceptance_ar: e.target.value })} />
      )}
      <Input dir={dir} value={row.owner} maxLength={LIMITS.owner} readOnly={readOnly} className="h-8 text-xs"
        aria-label={t('brd.req.owner')} placeholder={t('brd.req.owner')} onChange={(e) => update({ owner: e.target.value })} />
    </li>
  );
}

/** Numbered requirements (REQ-001 ...): add, remove, drag (mouse, touch or keyboard) to reorder; ids follow the order. */
export default function RequirementsTable({ rows, onChange, bilingual, readOnly, dir }: Props) {
  const { t } = useTranslation();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = rows.map((_, i) => `req-${i}`);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(renumberRequirements(arrayMove(rows, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)))));
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{t('brd.req.heading', { count: rows.length })}</h4>
        {!readOnly && (
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" disabled={rows.length >= LIMITS.requirements}
            onClick={() => onChange([...rows, { ...emptyRequirement(rows.length + 1), ...(bilingual ? { description_ar: '', acceptance_ar: '' } : {}) }])}>
            <Plus className="h-3.5 w-3.5" /> {t('brd.req.add')}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('brd.req.empty')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2" aria-label={t('brd.req.heading', { count: rows.length })}>
              {rows.map((r, i) => (
                <Row key={ids[i]} row={r} index={i} bilingual={bilingual} readOnly={readOnly} dir={dir}
                  update={(patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                  remove={() => onChange(renumberRequirements(rows.filter((_, j) => j !== i)))} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
