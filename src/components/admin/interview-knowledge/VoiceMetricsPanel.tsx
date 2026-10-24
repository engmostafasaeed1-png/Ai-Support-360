// AI Interviewer Training › Voice: speech-to-text settings and quality per interview (no audio, no answer text in the
// summary; the per-interview audit shows the raw transcript and the SAP spelling fixes). Reads only through the
// administrators-only database functions in docs/sql/interview-voice.sql; shows a notice until that file is applied.
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AudioLines, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { resetVoiceProbe } from '@/lib/voice/transcribeClient';
import {
  DEFAULT_VOICE_SETTINGS, normalizeVoiceSettings, VOICE_CREDITS_PER_SECOND, VOICE_LIMITS, VOICE_MODEL, VOICE_SETTINGS_KEY, voiceCredits, type VoiceSettings,
} from '../../../../supabase/functions/_shared/voiceSettings';

interface MetricRow {
  interview_id: string | null; consultant_name: string | null; started_at: string | null; model: string | null;
  segments: number; failed_segments: number; audio_minutes: number; avg_latency_ms: number | null; corrected_segments: number;
  answers: number; server_answers: number; webspeech_answers: number; typed_answers: number; fallback_answers: number;
  voice_answers: number; edited_answers: number;
}
interface SegmentRow {
  segment_index: number; created_at: string; status: string; audio_seconds: number; latency_ms: number | null; language: string | null;
  corrected: boolean; corrections: Array<{ from: string; to: string }> | null; raw_text: string | null; error_code: string | null; has_audio: boolean;
}

const NUMBERS: Array<[keyof typeof VOICE_LIMITS, string]> = [
  ['max_minutes_interview', 'Audio minutes per interview at most'],
  ['max_minutes_day', 'Audio minutes per person per 24 hours at most'],
  ['dictation_minutes_day', 'Dictation minutes per person per 24 hours (ticket text, chat)'],
  ['max_segment_seconds', 'Longest recording piece (seconds)'],
];

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)} %` : '—');

/** Summary numbers shown above the table (exported for tests). */
export function summarizeVoice(rows: MetricRow[]) {
  const s = rows.reduce((a, r) => ({
    minutes: a.minutes + Number(r.audio_minutes || 0), segments: a.segments + r.segments, failed: a.failed + r.failed_segments,
    voice: a.voice + r.voice_answers, edited: a.edited + r.edited_answers, fallback: a.fallback + r.fallback_answers,
    latencySum: a.latencySum + (r.avg_latency_ms ?? 0) * (r.segments - r.failed_segments), latencyN: a.latencyN + (r.avg_latency_ms != null ? r.segments - r.failed_segments : 0),
  }), { minutes: 0, segments: 0, failed: 0, voice: 0, edited: 0, fallback: 0, latencySum: 0, latencyN: 0 });
  return {
    minutes: Math.round(s.minutes * 100) / 100,
    credits: voiceCredits(s.minutes * 60),
    failedRate: s.segments ? s.failed / s.segments : 0,
    editedRate: s.voice ? s.edited / s.voice : 0,
    fallbackRate: s.voice ? s.fallback / s.voice : 0,
    avgLatencyMs: s.latencyN ? Math.round(s.latencySum / s.latencyN) : null,
  };
}

function Segments({ interviewId }: { interviewId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['voice', 'segments', interviewId],
    queryFn: async () => {
      const { data, error } = await safeRpc<SegmentRow[]>('admin_interview_voice_segments', { _interview_id: interviewId });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  if (q.isLoading) return <Skeleton className="h-16 w-full" />;
  if (q.error) return <p className="text-xs text-destructive">{(q.error as Error).message}</p>;
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">{t('voice.admin.no_segments', 'No recorded pieces for this interview.')}</p>;
  return (
    <ol className="space-y-2">
      {q.data.map((s, i) => (
        <li key={i} className="rounded-lg border border-border/60 p-2 text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>#{s.segment_index + 1}</span>
            <Badge variant={s.status === 'ok' ? 'secondary' : 'destructive'}>{s.status === 'ok' ? t('voice.admin.ok', 'ok') : s.error_code || t('voice.admin.failed', 'failed')}</Badge>
            <span>{Number(s.audio_seconds).toFixed(1)} s</span>
            {s.latency_ms != null && <span>{s.latency_ms} ms</span>}
            {s.language && <span>{s.language}</span>}
            {s.has_audio && <Badge variant="outline">{t('voice.admin.audio_kept', 'audio kept')}</Badge>}
          </div>
          {s.raw_text && <p className="text-foreground" dir="auto">{s.raw_text}</p>}
          {!!s.corrections?.length && (
            <p className="text-muted-foreground">{t('voice.admin.fixes', 'Spelling fixed:')} {s.corrections.map((c) => `${c.from} → ${c.to}`).join(', ')}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function VoiceMetricsPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [saving, setSaving] = useState(false);

  const metrics = useQuery({
    queryKey: ['voice', 'metrics', days],
    queryFn: async () => {
      const { data, error } = await safeRpc<MetricRow[]>('admin_interview_voice_metrics', { _days: days });
      if (error) return { ready: !isMissingRpc(error), rows: [] as MetricRow[], error: isMissingRpc(error) ? null : error.message };
      return { ready: true, rows: data ?? [], error: null };
    },
  });
  const settings = useQuery({
    queryKey: ['voice', 'settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('platform_settings').select('id, value').eq('key', VOICE_SETTINGS_KEY).maybeSingle();
      if (error) throw new Error(error.message);
      return { id: (data as { id?: string } | null)?.id ?? null, value: normalizeVoiceSettings((data as { value?: unknown } | null)?.value) };
    },
  });
  useEffect(() => { if (settings.data) setForm(settings.data.value); }, [settings.data]);

  const ready = metrics.data?.ready ?? false;
  const save = async () => {
    setSaving(true);
    const value = normalizeVoiceSettings(form);
    const id = settings.data?.id;
    const { error } = id
      ? await supabase.from('platform_settings').update({ value: value as never, updated_at: new Date().toISOString() }).eq('id', id)
      : await supabase.from('platform_settings').insert({ key: VOICE_SETTINGS_KEY, value: value as never });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setForm(value);
    resetVoiceProbe();
    void qc.invalidateQueries({ queryKey: ['voice', 'settings'] });
    toast.success(t('voice.admin.saved', 'Voice settings saved'));
  };

  const rows = metrics.data?.rows ?? [];
  const sum = summarizeVoice(rows);

  return (
    <div className="space-y-4">
      {!metrics.isLoading && !ready && (
        <Card className="rounded-2xl border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm text-foreground">
            {t('voice.admin.not_ready', 'Server voice transcription is prepared but not switched on yet: the database update (docs/sql/interview-voice.sql) has not been applied. Until then every microphone uses the browser\'s own speech recognition.')}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AudioLines className="h-4 w-4 text-primary" />{t('voice.admin.settings', 'Voice settings')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {([
            ['server_stt', t('voice.admin.server_stt', 'Use server transcription (better for SAP terms, accents and mixed English/Arabic)'), t('voice.admin.server_stt_hint', 'Off: every microphone uses the browser\'s own speech recognition.')],
            ['post_correct', t('voice.admin.post_correct', 'Fix the spelling of SAP terms after transcription'), t('voice.admin.post_correct_hint', 'Only spelling and capitals of known SAP terms change (for example "ac doca" → "ACDOCA"). The original text is kept for the audit below.')],
            ['store_audio', t('voice.admin.store_audio', 'Keep a copy of interview audio for review'), t('voice.admin.store_audio_hint', 'Off by default: audio is never stored. Switch on only with the owner\'s approval, an updated privacy notice and the private interview-audio storage created.')],
          ] as Array<[keyof VoiceSettings, string, string]>).map(([key, label, hint]) => (
            <label key={key} className="flex items-start gap-3 rounded-xl border border-border/60 p-3">
              <Switch checked={form[key] as boolean} onCheckedChange={(v) => setForm({ ...form, [key]: v })} disabled={!ready} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {NUMBERS.map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={`voice-${key}`} className="text-xs">{t(`voice.admin.${key}`, label)}</Label>
                <Input id={`voice-${key}`} type="number" min={VOICE_LIMITS[key][0]} max={VOICE_LIMITS[key][1]} value={form[key] as number} disabled={!ready}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} className="mt-1" />
                <span className="text-[11px] text-muted-foreground">{VOICE_LIMITS[key][0]}–{VOICE_LIMITS[key][1]}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('voice.admin.model', 'Model: {{model}} · {{rate}} credits per audio minute · no data kept by the provider.', { model: VOICE_MODEL, rate: (VOICE_CREDITS_PER_SECOND * 60).toFixed(3) })}
          </p>
          <Button onClick={() => void save()} disabled={!ready || saving}><Save className="h-4 w-4 me-1" />{t('voice.admin.save', 'Save voice settings')}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('voice.admin.quality', 'Voice quality per interview')}</CardTitle>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-border bg-background px-2 py-1 text-xs" aria-label={t('voice.admin.period', 'Period')}>
            {[7, 30, 90].map((d) => <option key={d} value={d}>{t('voice.admin.days', 'Last {{n}} days', { n: d })}</option>)}
          </select>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            {[
              [t('voice.admin.minutes', 'Audio minutes'), `${sum.minutes}`],
              [t('voice.admin.credits', 'Credits (estimate)'), `${sum.credits}`],
              [t('voice.admin.edited_rate', 'Answers corrected by hand'), pct(sum.editedRate, 1)],
              [t('voice.admin.fallback_rate', 'Answers on browser fallback'), pct(sum.fallbackRate, 1)],
              [t('voice.admin.latency', 'Average wait per piece'), sum.avgLatencyMs != null ? `${sum.avgLatencyMs} ms` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border/60 p-3">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="text-lg font-semibold text-foreground">{value}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{t('voice.admin.edited_note', '"Corrected by hand" counts voice answers the consultant changed before sending: a useful sign of misheard words, but people also edit to add detail.')}</p>
          {metrics.isLoading ? <Skeleton className="h-24 w-full" /> : metrics.data?.error ? (
            <p className="text-sm text-destructive">{metrics.data.error}</p>
          ) : !rows.length ? (
            <p className="text-sm text-muted-foreground">{t('voice.admin.empty', 'No voice answers in this period yet.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">{t('voice.admin.quality', 'Voice quality per interview')}</caption>
                <thead className="text-muted-foreground">
                  <tr className="text-start">
                    <th scope="col" className="text-start py-2 pe-2">{t('voice.admin.col_interview', 'Interview')}</th>
                    <th scope="col" className="text-end px-2">{t('voice.admin.col_minutes', 'Minutes')}</th>
                    <th scope="col" className="text-end px-2">{t('voice.admin.col_pieces', 'Pieces (failed)')}</th>
                    <th scope="col" className="text-end px-2">{t('voice.admin.col_latency', 'Wait')}</th>
                    <th scope="col" className="text-end px-2">{t('voice.admin.col_answers', 'Voice / typed')}</th>
                    <th scope="col" className="text-end px-2">{t('voice.admin.col_edited', 'Corrected')}</th>
                    <th scope="col" className="text-end px-2">{t('voice.admin.col_fallback', 'Fallback')}</th>
                    <th scope="col" className="text-end ps-2"><span className="sr-only">{t('voice.admin.details', 'Details')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const key = r.interview_id ?? 'dictation';
                    return (
                      <Fragment key={key}>
                        <tr className="border-t border-border/50">
                          <td className="py-2 pe-2">
                            <div className="font-medium text-foreground">{r.interview_id ? (r.consultant_name || t('voice.admin.consultant', 'Consultant')) : t('voice.admin.dictation', 'Dictation (ticket text, chat, proposals)')}</div>
                            <div className="text-muted-foreground">{r.started_at ? new Date(r.started_at).toLocaleString() : ''}</div>
                          </td>
                          <td className="text-end px-2">{Number(r.audio_minutes).toFixed(1)}</td>
                          <td className="text-end px-2">{r.segments} ({r.failed_segments})</td>
                          <td className="text-end px-2">{r.avg_latency_ms != null ? `${r.avg_latency_ms} ms` : '—'}</td>
                          <td className="text-end px-2">{r.voice_answers} / {r.typed_answers}</td>
                          <td className="text-end px-2">{pct(r.edited_answers, r.voice_answers)}</td>
                          <td className="text-end px-2">{pct(r.fallback_answers, r.voice_answers)}</td>
                          <td className="text-end ps-2">
                            {r.interview_id && (
                              <Button size="sm" variant="ghost" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}
                                aria-label={t('voice.admin.details', 'Details')}>
                                {open === key ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            )}
                          </td>
                        </tr>
                        {open === key && r.interview_id && (
                          <tr><td colSpan={8} className="pb-3"><Segments interviewId={r.interview_id} /></td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
