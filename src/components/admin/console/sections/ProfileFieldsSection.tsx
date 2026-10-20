import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ListChecks, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionShell } from './shared';
import InterviewWeightCard from './InterviewWeightCard';
import ConsultantFullProfileSheet from '@/components/admin/ConsultantFullProfileSheet';
import {
  fetchProfileFieldRules, PROFILE_FIELD_RULES_KEY, PROFILE_RULES_CONFIG_KEY,
  useProfileRulesConfig, type FieldMode, type ProfileFieldRule,
} from '@/hooks/useProfileFieldRules';

export const PROFILE_SECTIONS = ['Basics', 'Location', 'Links', 'Experience', 'Records', 'Verification'];

interface Incomplete { consultant_id: string; display_name: string; verification_status: string; missing: string[] }
interface LogRow { id: string; field_key: string; old_mode: string | null; new_mode: string; changed_by: string | null; changed_at: string }

/** Only the rows whose mode differs from the saved one. */
export function changedRules(saved: ProfileFieldRule[], draft: Record<string, FieldMode>) {
  return saved.filter(r => draft[r.field_key] && draft[r.field_key] !== r.mode).map(r => ({ field_key: r.field_key, mode: draft[r.field_key] }));
}

export default function ProfileFieldsSection() {
  const [fullProfileId, setFullProfileId] = useState<string | null>(null);
  const { t } = useTranslation();
  const qc = useQueryClient();
  const rulesQ = useQuery({ queryKey: PROFILE_FIELD_RULES_KEY, queryFn: fetchProfileFieldRules, staleTime: 5 * 60 * 1000 });
  const configQ = useProfileRulesConfig();
  const incompleteQ = useQuery({
    queryKey: ['admin-incomplete-consultants'],
    queryFn: async (): Promise<Incomplete[]> => {
      const { data, error } = await (supabase as any).rpc('admin_incomplete_consultants');
      if (error) throw error;
      return (data || []) as Incomplete[];
    },
  });
  const logQ = useQuery({
    queryKey: ['profile-field-rules-log'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('profile_field_rules_log')
        .select('id, field_key, old_mode, new_mode, changed_by, changed_at')
        .order('changed_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data || []) as LogRow[];
      const ids = [...new Set(rows.map(r => r.changed_by).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: p } = await supabase.from('profile_directory').select('user_id, display_name').in('user_id', ids);
        (p || []).forEach((x: any) => names.set(x.user_id, x.display_name || ''));
      }
      return rows.map(r => ({ ...r, who: (r.changed_by && names.get(r.changed_by)) || '-' }));
    },
  });

  const rules = rulesQ.data || [];
  const savedEnforce = !!configQ.data?.enforce;
  const [draft, setDraft] = useState<Record<string, FieldMode>>({});
  const [enforce, setEnforce] = useState(false);
  const [search, setSearch] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState('rules');

  useEffect(() => { setDraft(Object.fromEntries(rules.map(r => [r.field_key, r.mode]))); }, [rulesQ.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEnforce(savedEnforce); }, [savedEnforce]);

  const labelOf = useMemo(() => new Map(rules.map(r => [r.field_key, r.label])), [rules]);
  const changes = changedRules(rules, draft);
  const enforceChanged = enforce !== savedEnforce;
  const dirty = changes.length > 0 || enforceChanged;
  const incomplete = incompleteQ.data || [];
  const hiddenWarn = changes.some(c => c.mode === 'hidden');

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc('admin_set_profile_field_rules', {
        _rules: changes,
        _enforce: enforceChanged ? enforce : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t('admin.profileFields.saved', 'Profile field rules saved.'));
      qc.invalidateQueries({ queryKey: PROFILE_FIELD_RULES_KEY });
      qc.invalidateQueries({ queryKey: PROFILE_RULES_CONFIG_KEY });
      qc.invalidateQueries({ queryKey: ['admin-incomplete-consultants'] });
      qc.invalidateQueries({ queryKey: ['profile-field-rules-log'] });
    },
    onError: (e: any) => toast.error(e?.message || t('common.error', 'Something went wrong. Please try again.')),
  });

  const modeLabel = (m: string) => m === 'required' ? t('admin.profileFields.required', 'Required') : m === 'hidden' ? t('admin.profileFields.hidden', 'Hidden') : t('admin.profileFields.optional', 'Optional');

  const visible = rules.filter(r => {
    if (search && !r.label.toLowerCase().includes(search.toLowerCase())) return false;
    if (changedOnly && draft[r.field_key] === r.default_mode) return false;
    return true;
  });

  return (
    <SectionShell
      icon={ListChecks}
      title={t('admin.profileFields.title', 'Profile fields')}
      description={t('admin.profileFields.intro', 'Choose which fields every consultant profile must have. Required fields appear with a star and a to-do list for the consultant. Hidden fields are removed from the profile forms.')}
    >
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            {t('admin.profileFields.missingCount', '{{n}} consultants are missing required fields', { n: incomplete.length })}
          </p>
          <Button size="sm" variant="outline" onClick={() => setTab('incomplete')}>{t('admin.profileFields.viewWho', 'View who')}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="flex items-center justify-between gap-4 pt-6">
          <Label htmlFor="enforce-switch" className="text-sm">
            {t('admin.profileFields.enforce', 'Hide incomplete profiles from the client directory and map, and block their new bids')}
          </Label>
          <Switch
            id="enforce-switch"
            checked={enforce}
            onCheckedChange={v => { if (v) setConfirmOpen(true); else setEnforce(false); }}
          />
        </CardContent>
      </Card>

      <InterviewWeightCard />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rules">{t('admin.profileFields.tabRules', 'Rules')}</TabsTrigger>
          <TabsTrigger value="incomplete">{t('admin.profileFields.tabIncomplete', 'Who is incomplete')}</TabsTrigger>
          <TabsTrigger value="log">{t('admin.profileFields.tabLog', 'Change log')}</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[12rem]">
              <Search aria-hidden="true" className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="ps-9" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('admin.profileFields.search', 'Search fields')} aria-label={t('admin.profileFields.search', 'Search fields')} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="changed-only" checked={changedOnly} onCheckedChange={setChangedOnly} />
              <Label htmlFor="changed-only" className="text-sm">{t('admin.profileFields.changedOnly', 'Show changed only')}</Label>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDraft(Object.fromEntries(rules.map(r => [r.field_key, r.default_mode])))}>
              {t('admin.profileFields.reset', 'Reset to defaults')}
            </Button>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {t('admin.profileFields.save', 'Save changes')}
            </Button>
          </div>
          {hiddenWarn && (
            <p className="text-xs text-muted-foreground">{t('admin.profileFields.hiddenWarn', 'Hidden fields stay stored but are not shown or required.')}</p>
          )}
          {PROFILE_SECTIONS.map(section => {
            const rows = visible.filter(r => r.section === section);
            if (rows.length === 0) return null;
            return (
              <Card key={section} className="rounded-2xl" data-testid={`section-${section}`}>
                <CardHeader className="pb-2"><CardTitle className="text-base">{t(`admin.profileFields.section.${section}`, section)}</CardTitle></CardHeader>
                <CardContent className="divide-y divide-border">
                  {rows.map(r => {
                    const mode = draft[r.field_key] || r.mode;
                    return (
                      <div key={r.field_key} data-testid={`rule-${r.field_key}`} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{r.label}</span>
                          {mode !== r.default_mode && <span aria-label={t('admin.profileFields.changed', 'Changed')} className="h-2 w-2 rounded-full bg-primary" />}
                          <span className="text-xs text-muted-foreground">{t('admin.profileFields.default', 'Default: {{mode}}', { mode: modeLabel(r.default_mode) })}</span>
                        </div>
                        {r.hard_required ? (
                          <Badge variant="outline" data-testid={`hard-${r.field_key}`}>{t('admin.profileFields.alwaysRequired', 'Always required (needed for search and the map)')}</Badge>
                        ) : (
                        <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={v => v && setDraft(d => ({ ...d, [r.field_key]: v as FieldMode }))} aria-label={r.label}>
                          <ToggleGroupItem value="required">{modeLabel('required')}</ToggleGroupItem>
                          <ToggleGroupItem value="optional">{modeLabel('optional')}</ToggleGroupItem>
                          <ToggleGroupItem value="hidden">{modeLabel('hidden')}</ToggleGroupItem>
                        </ToggleGroup>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="incomplete">
          <Card className="rounded-2xl"><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('admin.profileFields.colName', 'Name')}</TableHead>
                <TableHead>{t('admin.profileFields.colStatus', 'Status')}</TableHead>
                <TableHead>{t('admin.profileFields.colMissing', 'Missing fields')}</TableHead>
                <TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {incomplete.map(c => (
                  <TableRow key={c.consultant_id}>
                    <TableCell>{c.display_name || '-'}</TableCell>
                    <TableCell><Badge variant="secondary">{c.verification_status}</Badge></TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{c.missing.map(k => <Badge key={k} variant="outline">{labelOf.get(k) || k}</Badge>)}</div></TableCell>
                    <TableCell><div className="flex flex-wrap gap-2 items-center"><Button variant="outline" size="sm" onClick={() => setFullProfileId(c.consultant_id)}>{t('admin.fullProfile.view', 'View full profile')}</Button><Link className="text-sm text-primary underline" to={`/admin/approvals?consultant=${c.consultant_id}`}>{t('admin.profileFields.open', 'Open')}</Link></div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="log">
          <Card className="rounded-2xl"><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('admin.profileFields.colField', 'Field')}</TableHead>
                <TableHead>{t('admin.profileFields.colChange', 'Change')}</TableHead>
                <TableHead>{t('admin.profileFields.colWho', 'Who')}</TableHead>
                <TableHead>{t('admin.profileFields.colWhen', 'When')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(logQ.data || []).map(l => (
                  <TableRow key={l.id}>
                    <TableCell>{labelOf.get(l.field_key) || l.field_key}</TableCell>
                    <TableCell>{modeLabel(l.old_mode || 'optional')} → {modeLabel(l.new_mode)}</TableCell>
                    <TableCell>{l.who}</TableCell>
                    <TableCell>{format(new Date(l.changed_at), 'MMM d, yyyy HH:mm')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.profileFields.confirmTitle', 'Hide incomplete profiles?')}</DialogTitle>
            <DialogDescription>
              {t('admin.profileFields.confirmText', '{{n}} consultants would be hidden right now.', { n: incomplete.length })}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-2 overflow-auto text-sm">
            {incomplete.map(c => (
              <li key={c.consultant_id}>
                <span className="font-medium text-foreground">{c.display_name || '-'}</span>
                <span className="text-muted-foreground">: {c.missing.map(k => labelOf.get(k) || k).join(', ')}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={() => { setEnforce(true); setConfirmOpen(false); }}>{t('admin.profileFields.turnOn', 'Turn on')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConsultantFullProfileSheet consultantId={fullProfileId} onClose={() => setFullProfileId(null)} />
    </SectionShell>
  );
}
