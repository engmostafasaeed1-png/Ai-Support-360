// The prepared database file must use the same SAP word list, defaults and models as the shared TypeScript rules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODULE_TERMS, SAP_CORE_TERMS } from '../../../supabase/functions/_shared/voiceGlossary';
import { AUDIO_CONSENT_VERSION, DEFAULT_LEARNING_SETTINGS, LEARNING_LIMITS } from '../../../supabase/functions/_shared/voiceLearning';
import { VOICE_MODELS } from '../../../supabase/functions/_shared/voiceProviders';
import { ACCENT_GROUPS } from '../../../supabase/functions/_shared/voiceRouting';

const sql = readFileSync('docs/sql/interview-voice-learning.sql', 'utf8');

describe('interview-voice-learning.sql mirrors the shared rules', () => {
  it('seeds exactly the SAP glossary terms', () => {
    const seed = sql.slice(sql.indexOf('INSERT INTO public.voice_sap_terms'), sql.indexOf('ON CONFLICT DO NOTHING', sql.indexOf('INSERT INTO public.voice_sap_terms')));
    const inSql = [...seed.matchAll(/\('((?:[^']|'')*)'\)/g)].map((m) => m[1].replace(/''/g, "'")).sort();
    const inTs = [...new Set([...SAP_CORE_TERMS, ...Object.values(MODULE_TERMS).flat()].map((t) => t.toLowerCase()))].sort();
    expect(inSql).toEqual(inTs);
  });
  it('uses the same defaults and limits', () => {
    const block = sql.slice(sql.indexOf("d jsonb := '"), sql.indexOf("'::jsonb;", sql.indexOf("d jsonb := '")));
    const defaults = JSON.parse(block.replace("d jsonb := '", '').replace(/\s+/g, ' '));
    const { pinned_model: _p, ...ts } = DEFAULT_LEARNING_SETTINGS;
    expect(defaults).toEqual(ts);
    const limBlock = sql.slice(sql.indexOf("lim jsonb := '"), sql.indexOf("'::jsonb;", sql.indexOf("lim jsonb := '")));
    expect(JSON.parse(limBlock.replace("lim jsonb := '", '').replace(/\s+/g, ' '))).toEqual(JSON.parse(JSON.stringify(LEARNING_LIMITS)));
  });
  it('allows exactly the shared models, accent groups and consent version', () => {
    const models = sql.match(/SELECT _m IN \(([^)]*)\)/)![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(models).toEqual(Object.keys(VOICE_MODELS).sort());
    const accents = sql.match(/accent_group IN \(([^)]*)\)/)![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(accents).toEqual([...ACCENT_GROUPS]);
    expect(sql.match(/'2026-10-24'/g)!.length).toBeGreaterThanOrEqual(4);
    expect(AUDIO_CONSENT_VERSION).toBe('2026-10-24');
  });
  it('keeps the owner defaults: N = 3, auto-routing and training audio off, 90 days', () => {
    expect(sql).toContain("'promote_min_consultants', 3");
    expect(sql).toContain("'auto_routing', false");
    expect(sql).toContain("'training_audio', false");
    expect(sql).toContain("'audio_retention_days', 90");
  });
});
