import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Briefcase, FileText, Loader2, Pencil, Plus, Trash2, Upload, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import CvImportDialog, { type ParsedCv } from './CvImportDialog';

type Job = {
  id?: string;
  company_name: string;
  job_title: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string | null;
};

const EMPTY: Job = { company_name: '', job_title: '', start_date: null, end_date: null, is_current: false, description: '' };
const BUCKET = 'consultant-documents';
const MAX = 10 * 1024 * 1024;
const OK_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

function fmt(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export default function ExperienceCvCard({ onProfileChanged }: { onProfileChanged?: () => void }) {
  // userId = consultants.id (row key for consultant tables); authId = auth user id (storage folder).
  const [userId, setUserId] = useState<string | null>(null);
  const [authId, setAuthId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [cvPath, setCvPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<ParsedCv | null>(null);

  const readCv = async (file: File, path: string) => {
    if (file.type === 'application/msword') {
      toast.info('CV saved. To fill your profile automatically, upload it as PDF or .docx.');
      return;
    }
    setReading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const { data, error } = await supabase.functions.invoke('parse-cv', {
        body: { file_base64: btoa(bin), mime_type: file.type, source_path: path, save: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : 'Could not read CV');
      setParsed(data.profile);
    } catch (e: any) {
      toast.error(e.message || 'Could not read your CV');
    } finally {
      setReading(false);
    }
  };

  const load = async (uid: string) => {
    const [{ data: wh }, { data: c }] = await Promise.all([
      supabase.from('consultant_work_history').select('*').eq('consultant_id', uid).order('is_current', { ascending: false }).order('start_date', { ascending: false }),
      supabase.from('consultant_private').select('cv_url').eq('consultant_id', uid).maybeSingle(),
    ]);
    setJobs((wh as Job[]) || []);
    setCvPath(c?.cv_url ?? null);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return setLoading(false);
      setAuthId(session.user.id);
      const { data: c } = await supabase.from('consultants').select('id').eq('user_id', session.user.id).maybeSingle();
      if (!c) return setLoading(false);
      setUserId(c.id);
      load(c.id);
    });
  }, []);

  const uploadCv = async (file: File) => {
    if (!userId || !authId) return;
    if (!OK_TYPES.includes(file.type)) return toast.error('Please choose a PDF or Word file');
    if (file.size > MAX) return toast.error('CV must be under 10 MB');
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const path = `${authId}/cv/cv-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (error) throw error;
      const { error: upErr } = await supabase.from('consultant_private').upsert({ consultant_id: userId, cv_url: path }, { onConflict: 'consultant_id' });
      if (upErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw upErr;
      }
      if (cvPath && !cvPath.startsWith('http')) await supabase.storage.from(BUCKET).remove([cvPath]);
      setCvPath(path);
      toast.success('CV uploaded — reading it now…');
      readCv(file, path);
    } catch (e: any) {
      toast.error(e.message || 'Could not upload CV');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const viewCv = async () => {
    if (!cvPath) return;
    if (cvPath.startsWith('http')) return window.open(cvPath, '_blank', 'noopener');
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(cvPath, 60);
    if (error || !data) return toast.error('Could not open CV');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const saveJob = async () => {
    if (!userId || !editing) return;
    if (!editing.company_name.trim() || !editing.job_title.trim()) return toast.error('Company and job title are required');
    if (!editing.is_current && editing.start_date && editing.end_date && editing.end_date < editing.start_date)
      return toast.error('End date must be after start date');
    setSaving(true);
    const row = {
      consultant_id: userId,
      company_name: editing.company_name.trim(),
      job_title: editing.job_title.trim(),
      start_date: editing.start_date || null,
      end_date: editing.is_current ? null : editing.end_date || null,
      is_current: editing.is_current,
      description: editing.description?.trim() || null,
    };
    const { error } = editing.id
      ? await supabase.from('consultant_work_history').update(row).eq('id', editing.id)
      : await supabase.from('consultant_work_history').insert(row);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Experience saved');
    setEditing(null);
    load(userId);
    onProfileChanged?.();
  };

  const removeJob = async (id: string) => {
    if (!userId || !confirm('Remove this experience?')) return;
    const { error } = await supabase.from('consultant_work_history').delete().eq('id', id);
    if (error) return toast.error(error.message);
    load(userId);
    onProfileChanged?.();
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Briefcase className="h-4 w-4" /> Experience &amp; CV</CardTitle>
        <Button size="sm" onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4 me-1" /> Add experience</Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
          <FileText className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-[160px]">
            <p className="text-sm font-medium text-foreground">Your CV</p>
            <p className="text-xs text-muted-foreground">{cvPath ? 'CV attached — visible to the platform team' : 'PDF or Word, up to 10 MB — we read it and fill your profile for you'}</p>
          </div>
          {reading && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Reading CV…</span>}
          {cvPath && <Button variant="outline" size="sm" onClick={viewCv}><Download className="h-4 w-4 me-1" /> View</Button>}
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCv(e.target.files[0])} />
          <Button size="sm" variant={cvPath ? 'outline' : 'default'} disabled={uploading || !userId} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Upload className="h-4 w-4 me-1" />}
            {cvPath ? 'Replace CV' : 'Attach CV'}
          </Button>
        </div>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No experience added yet. Add your past roles so clients can see your background.</p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-xl border border-border/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{j.job_title}</p>
                    <p className="text-sm text-muted-foreground">{j.company_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmt(j.start_date)}{(j.start_date || j.end_date || j.is_current) && ' – '}{j.is_current ? 'Present' : fmt(j.end_date)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Edit experience" onClick={() => setEditing({ ...j, description: j.description ?? '' })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Remove experience" onClick={() => { if (j.id) void removeJob(j.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
                {j.description && <p className="text-sm text-foreground/80 mt-2 whitespace-pre-line">{j.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {userId && (
        <CvImportDialog open={!!parsed} onOpenChange={(o) => !o && setParsed(null)} userId={userId} data={parsed} onApplied={() => { void load(userId); onProfileChanged?.(); }} />
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit experience' : 'Add experience'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div><Label>Job title *</Label><Input value={editing.job_title} onChange={(e) => setEditing({ ...editing, job_title: e.target.value })} maxLength={120} /></div>
                <div><Label>Company *</Label><Input value={editing.company_name} onChange={(e) => setEditing({ ...editing, company_name: e.target.value })} maxLength={120} /></div>
                <div><Label>Start date</Label><Input type="date" value={editing.start_date ?? ''} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></div>
                <div><Label>End date</Label><Input type="date" disabled={editing.is_current} value={editing.end_date ?? ''} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={editing.is_current} onCheckedChange={(v) => setEditing({ ...editing, is_current: !!v })} /> I currently work here
              </label>
              <div>
                <Label>Description</Label>
                <Textarea rows={5} maxLength={2000} placeholder="Projects, modules, responsibilities and results…" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveJob} disabled={saving}>{saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
