import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/safeRpc', () => ({ safeRpc: vi.fn(async () => ({ data: null, error: null })) }));
import { learningArgs } from './learning';
import { benchmarkItemsFromCsv, parseCsv } from './benchmarkImport';
import { trendSeries } from '@/components/admin/interview-knowledge/VoiceLearningPanel';

const meta = (raw: Record<string, string>, model = 'openai/gpt-transcribe') => ({ engine: 'server' as const, fallback: null, segments: 1, rawByModel: raw, model, vocabVersion: 3, device: 'desktop-chrome' });

describe('learning payload from an interview answer', () => {
  it('a typed answer records timing only: no correction pairs, no texts, no model errors', () => {
    const a = learningArgs({ interviewId: 'i1', answerOrder: 1, answerMs: 4000, shown: '', final: 'I post with MIRO', meta: null, language: 'en' })!;
    expect(a._engine).toBe('typed');
    expect(a._pairs).toEqual([]);
    expect(a._models).toEqual([]);
    expect(a._raw).toBeNull();
    expect(a._edited).toBe(false);
  });

  it('a corrected spoken answer sends the changed SAP term and per-model error counts', () => {
    const a = learningArgs({ interviewId: 'i1', answerOrder: 2, answerMs: 9000, shown: 'we read the ac doca table', final: 'we read the ACDOCA table',
      meta: meta({ 'openai/gpt-transcribe': 'we read the ac doca table' }), language: 'en' })!;
    expect(a._engine).toBe('server');
    expect(a._edited).toBe(true);
    expect(a._pairs.some((p) => p.final === 'ACDOCA')).toBe(true);
    expect(a._models[0]).toMatchObject({ model: 'openai/gpt-transcribe', words: 5 });
    expect(a._models[0].errors).toBeGreaterThan(0);
    expect(a._vocab_version).toBe(3);
  });

  it('never sends an e-mail address or phone number typed as a correction', () => {
    const a = learningArgs({ interviewId: 'i1', answerOrder: 3, answerMs: null, shown: 'call me on the number', final: 'call me on 01012345678 or ali@example.com',
      meta: meta({ 'openai/gpt-transcribe': 'call me on the number' }), language: 'en' })!;
    expect(JSON.stringify(a._pairs)).not.toMatch(/01012345678|ali@example\.com/);
    expect(a._final ?? '').not.toMatch(/01012345678|ali@example\.com/);
  });

  it('skips model error counts when typed text came before the spoken words', () => {
    const a = learningArgs({ interviewId: 'i1', answerOrder: 4, answerMs: 1, shown: 'typed first and then spoken', final: 'typed first and then spoken',
      meta: meta({ 'openai/gpt-transcribe': 'and then spoken' }), language: 'en', partialVoice: true })!;
    expect(a._models).toEqual([]);
    expect(a._raw).toBeNull();
  });

  it('records nothing without an interview or an answer', () => {
    expect(learningArgs({ interviewId: null, answerOrder: 1, answerMs: 1, shown: '', final: 'x', meta: null, language: 'en' })).toBeNull();
    expect(learningArgs({ interviewId: 'i', answerOrder: 1, answerMs: 1, shown: '', final: '  ', meta: null, language: 'en' })).toBeNull();
  });
});

describe('benchmark import (results.csv → frozen test set)', () => {
  const csv = [
    'id,category,lang,config,variant,ok,reference,raw',
    'b01,sap-en,en,gpt,openai/gpt-transcribe,true,"Post the invoice in MIRO","post the invoice in miro"',
    'b01,sap-en,en,gem,google/gemini-3.5-transcribe,true,"Post the invoice in MIRO","Post the invoice in Miro"',
    'b01,sap-en,en,gpt2,openai/gpt-transcribe,true,"Post the invoice in MIRO","second run ignored"',
    'b02,mixed,ar,gpt,openai/gpt-transcribe,false,"x","y"',
    'b03,mixed,ar,bad,unknown/model,true,"x","y"',
  ].join('\n');

  it('reads quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('a,"b, ""c"""\n1,2')).toEqual([['a', 'b, "c"'], ['1', '2']]);
  });

  it('keeps one item per sentence, first raw per allowed model, and drops failed runs', () => {
    const items = benchmarkItemsFromCsv(csv, ['openai/gpt-transcribe', 'google/gemini-3.5-transcribe']);
    expect(items).toHaveLength(1);
    expect(items[0].raws).toEqual({ 'openai/gpt-transcribe': 'post the invoice in miro', 'google/gemini-3.5-transcribe': 'Post the invoice in Miro' });
  });

  it('rejects a file without the benchmark columns', () => {
    expect(benchmarkItemsFromCsv('name,value\na,b', ['openai/gpt-transcribe'])).toEqual([]);
  });
});

describe('weekly word error rate chart', () => {
  it('pools words and errors per model and week', () => {
    const s = trendSeries([
      { week: '2026-10-19', model: 'm1', vocab_version: 1, answers: 2, words: 100, errors: 5 },
      { week: '2026-10-19', model: 'm2', vocab_version: 1, answers: 1, words: 50, errors: 1 },
      { week: '2026-10-12', model: 'm1', vocab_version: 1, answers: 1, words: 0, errors: 0 },
    ]);
    expect(s.map((r) => r.week)).toEqual(['2026-10-12', '2026-10-19']);
    expect(s[1]).toMatchObject({ m1: 5, m2: 2 });
  });
});
