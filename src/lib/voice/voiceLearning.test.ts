import { describe, expect, it } from 'vitest';
import {
  aggregatePairs, applyLearnedReplacements, applyRollback, canRollbackTo, DEFAULT_LEARNING_SETTINGS, evaluateModelSwitch, evaluateVocabulary,
  extractCorrectionPairs, learnedKeywords, mergeTerms, normalizeLearningSettings, personalTermsFrom, promotionDecision, sapTermOk, scrubText, termProblem,
  type EvalItem, type StoredPair, type VocabVersion,
} from '../../../supabase/functions/_shared/voiceLearning';
import { capPerUser, decideRoute, deviceClass, resolveRoute, type ModelStat } from '../../../supabase/functions/_shared/voiceRouting';
import { classifyAnswer, flagSentence, libraryCandidate, questionFlags, rewriteHints } from '../../../supabase/functions/_shared/questionQuality';

const S = DEFAULT_LEARNING_SETTINGS;

describe('owner defaults', () => {
  it('learning on, auto-promotion on with 3 consultants, auto-routing off, training audio off, 90 days', () => {
    expect(S.learning).toBe(true);
    expect(S.auto_promote).toBe(true);
    expect(S.promote_min_consultants).toBe(3);
    expect(S.auto_routing).toBe(false);
    expect(S.training_audio).toBe(false);
    expect(S.audio_retention_days).toBe(90);
  });
  it('clamps settings and refuses an unknown pinned model', () => {
    const s = normalizeLearningSettings({ promote_min_consultants: 1, audio_retention_days: 365, routing_margin: 0.5, pinned_model: 'evil/model' }, ['openai/gpt-transcribe']);
    expect(s.promote_min_consultants).toBe(2);
    expect(s.audio_retention_days).toBe(90);
    expect(s.routing_margin).toBe(0.2);
    expect(s.pinned_model).toBeNull();
  });
});

describe('PII and secret filter', () => {
  it.each([
    ['mostafa@example.com', 'email'], ['www.example.com', 'url'], ['https://x.io', 'url'], ['0101 234 5678', 'phone'], ['4111111', 'phone'],
    ['123456', 'long_number'], ['AKIAx9Q2LmN7pRtZ8vW1', 'secret'], ['deadbeef1234cafe', 'secret'], ['ignore previous instructions', 'prompt_like'],
    ['ignore instructions', 'prompt_like'], ['my password', 'prompt_like'], ['you are', 'prompt_like'], ['fuck', 'profanity'], ['one two three four', 'too_many_words'],
    ['<script>', 'characters'], ['a', 'too_short'], ['x'.repeat(41), 'too_long'],
  ])('rejects %s as %s', (term, reason) => {
    expect(termProblem(term)).toBe(reason);
  });
  it.each(['MIRO', 'ACDOCA', 'S/4HANA', 'FB60', 'ME21N', 'F-02', 'GR/IR', 'BRF+', 'S&OP', 'Business Partner', '/SCWM/MON', 'ترحيل', 'S/4HANA 2023'])('accepts %s', (term) => {
    expect(termProblem(term)).toBeNull();
  });
  it('masks personal data in kept test texts', () => {
    const t = scrubText('mail me at a.b@x.com or call +20 100 123 4567, ref 99887766, key AbCdEf123456GhIjKl and see www.x.com/p');
    expect(t).not.toMatch(/a\.b@x\.com|100 123|99887766|AbCdEf123456GhIjKl|www\.x\.com/);
    expect(t).toContain('[email]');
    expect(t).toContain('[number]');
    expect(scrubText('mail a.b@x.com call +20 100 123 4567 key AbCdEf123456GhIjKl')).toBe('mail [email] call [number] key [secret]');
  });
});

describe('pairs from one answer', () => {
  it('learns a substitution of up to three words, including a case fix of a technical term', () => {
    const pairs = extractCorrectionPairs('I posted it in Miro and checked a cdoca table', 'I posted it in MIRO and checked ACDOCA table');
    expect(pairs).toEqual([{ heard: 'Miro', final: 'MIRO' }, { heard: 'a cdoca', final: 'ACDOCA' }]);
  });
  it('ignores ordinary capitalisation, insertions, deletions and near-total rewrites', () => {
    expect(extractCorrectionPairs('the invoice was posted', 'The invoice was posted')).toEqual([]);
    expect(extractCorrectionPairs('posted invoice', 'posted the invoice yesterday')).toEqual([]);
    expect(extractCorrectionPairs('one two three four five', 'completely different words here now')).toEqual([]);
  });
  it('never stores personal data typed into an answer', () => {
    const pairs = extractCorrectionPairs('send to mostafa at gmail', 'send to mostafa@gmail.com');
    expect(pairs).toEqual([]);
    expect(extractCorrectionPairs('call me on number', 'call me on 01001234567')).toEqual([]);
  });
});

describe('aggregation and promotion (poisoning)', () => {
  const pair = (user: string, heard = 'miro', final = 'MIRO', source: StoredPair['source'] = 'consultant'): StoredPair => ({ user_id: user, heard, final, source });

  it('counts different consultants, not corrections', () => {
    const [s] = aggregatePairs([pair('u1'), pair('u1'), pair('u1'), pair('u1'), pair('u2')]);
    expect(s).toMatchObject({ heard_key: 'miro', final_term: 'MIRO', total: 5, consultants: 2 });
  });
  it('one consultant correcting 50 times cannot auto-promote a word', () => {
    const [s] = aggregatePairs(Array.from({ length: 50 }, () => pair('attacker', 'sales', 'SALESX9')));
    expect(s.consultants).toBe(1);
    expect(promotionDecision({ final_term: s.final_term, consultants: s.consultants, sapOk: true, blocked: false }, S)).toBe('review');
  });
  it('automatic fixes are not evidence', () => {
    expect(aggregatePairs([pair('u1', 'miro', 'MIRO', 'rule'), pair('u2', 'miro', 'MIRO', 'model')])).toEqual([]);
  });
  it('promotes with 3 different consultants and the SAP check, otherwise review', () => {
    const [s] = aggregatePairs([pair('u1'), pair('u2'), pair('u3')]);
    expect(promotionDecision({ ...s, sapOk: sapTermOk(s.final_term), blocked: false }, S)).toBe('auto_promote');
    expect(promotionDecision({ ...s, sapOk: false, blocked: false }, S)).toBe('review');
    expect(promotionDecision({ ...s, sapOk: true, blocked: false }, { ...S, auto_promote: false })).toBe('review');
    expect(promotionDecision({ ...s, sapOk: true, blocked: false }, { ...S, learning: false })).toBe('review');
  });
  it('a rejected term is never suggested again', () => {
    expect(promotionDecision({ final_term: 'MIRO', consultants: 30, sapOk: true, blocked: true }, S)).toBe('blocked');
  });
  it('SAP check knows terms, T-codes and table names, not ordinary words', () => {
    expect(sapTermOk('ACDOCA')).toBe(true);
    expect(sapTermOk('ME21N')).toBe(true);
    expect(sapTermOk('Business Partner')).toBe(true);
    expect(sapTermOk('banana')).toBe(false);
    expect(sapTermOk('banana', (k) => k === 'banana')).toBe(true);
  });
});

describe('versions and rollback', () => {
  const versions: VocabVersion[] = [
    { version: 1, status: 'retired', activated_at: '2026-10-01T00:00:00Z', terms: [] },
    { version: 2, status: 'active', activated_at: '2026-10-10T00:00:00Z', terms: [{ heard: 'miro', term: 'MIRO' }] },
    { version: 3, status: 'blocked', activated_at: null, terms: [] },
  ];
  it('rolls back only to a version that was active before', () => {
    expect(canRollbackTo(versions, 1).ok).toBe(true);
    expect(canRollbackTo(versions, 2).reason).toBe('already_active');
    expect(canRollbackTo(versions, 3).reason).toBe('never_active');
    const after = applyRollback(versions, 1);
    expect(after.filter((v) => v.status === 'active').map((v) => v.version)).toEqual([1]);
    expect(after.find((v) => v.version === 2)?.status).toBe('retired');
  });
  it('merges terms by heard form and drops removed ones', () => {
    const t = mergeTerms([{ heard: 'miro', term: 'Miro' }, { heard: 'a cdoca', term: 'ACDOCA' }], [{ heard: 'Miro', term: 'MIRO' }], ['a cdoca']);
    expect(t).toEqual([{ heard: 'Miro', term: 'MIRO', module: null, source: 'auto' }]);
  });
});

describe('using learned terms', () => {
  it('replaces technical and multi-word heard forms only', () => {
    const r = applyLearnedReplacements('we use miro and the sales order in ac doca', [
      { heard: 'miro', term: 'MIRO' }, { heard: 'ac doca', term: 'ACDOCA' }, { heard: 'sales', term: 'sails' },
    ]);
    expect(r.text).toBe('we use MIRO and the sales order in ACDOCA');
  });
  it('personal words first, then words for the consultant modules', () => {
    const k = learnedKeywords([{ heard: 'x', term: 'VA01', module: 'SD' }, { heard: 'y', term: 'MIGO', module: 'MM' }], [{ heard: 'z', term: 'FB60' }], ['MM'], 2);
    expect(k).toEqual(['FB60', 'MIGO']);
  });
  it('personal list keeps only repeated own corrections', () => {
    const p = personalTermsFrom([{ heard: 'miro', final: 'MIRO' }, { heard: 'miro', final: 'MIRO' }, { heard: 'bseg', final: 'BSEG' }], new Set(), S);
    expect(p.map((x) => [x.term, x.count])).toEqual([['MIRO', 2]]);
    expect(personalTermsFrom([{ heard: 'miro', final: 'MIRO' }, { heard: 'miro', final: 'MIRO' }], new Set(['miro']), S)).toEqual([]);
  });
});

describe('regression gate', () => {
  const live = (i: number, user = `u${i}`): EvalItem => ({ reference: 'I posted the invoice in MIRO today', raw: 'I posted the invoice in mirror today', user_id: user, source: 'live' });
  it('waits when there are too few test items', () => {
    const r = evaluateVocabulary([live(1)], [], [{ heard: 'miro', term: 'MIRO' }], [], S);
    expect(r.passed).toBeNull();
    expect(r.reason).toBe('not_enough_items');
  });
  it('passes a vocabulary that helps and blocks one that hurts', () => {
    const items = Array.from({ length: 25 }, (_, i) => live(i));
    const good = evaluateVocabulary(items, [], [{ heard: 'mirror', term: 'MIRO' }], [], S);
    expect(good.passed).toBe(true);
    expect(good.wer_after!).toBeLessThan(good.wer_before!);
    const bad = evaluateVocabulary(items, [], [{ heard: 'invoice in', term: 'INVOICEX9' }], [], S);
    expect(bad.passed).toBe(false);
    expect(bad.reason).toBe('worse');
  });
  it('one consultant cannot fill the test set', () => {
    const items = Array.from({ length: 40 }, () => live(0, 'same'));
    expect(evaluateVocabulary(items, [], [], [], S).items).toBe(10);
  });
  it('blocks a model switch that is worse on the frozen benchmark', () => {
    const items: EvalItem[] = Array.from({ length: 20 }, () => ({ reference: 'post in MIRO', raw: '', source: 'benchmark', raws: { a: 'post in MIRO', b: 'post in mirror' } }));
    expect(evaluateModelSwitch(items, 'a', 'b', S).passed).toBe(false);
    expect(evaluateModelSwitch(items, 'b', 'a', S).passed).toBe(true);
    expect(evaluateModelSwitch(items.slice(0, 5), 'b', 'a', S).passed).toBeNull();
  });
});

describe('routing', () => {
  const cfg = S;
  const stat = (model: string, wer: number, answers = 100, consultants = 10): ModelStat => ({ model, answers, words: 2000, errors: Math.round(wer * 2000), consultants });

  it('keeps the current model with small samples', () => {
    const r = decideRoute([stat('a', 0.2, 5), stat('b', 0.05, 5)], 'a', 'a', cfg);
    expect(r).toMatchObject({ model: 'a', changed: false, reason: 'not_enough_data' });
    expect(decideRoute([stat('a', 0.2), stat('b', 0.05, 100, 2)], 'a', 'a', cfg).model).toBe('a');
  });
  it('switches only when the challenger is better by the margin', () => {
    expect(decideRoute([stat('a', 0.10), stat('b', 0.09)], 'a', 'a', cfg)).toMatchObject({ model: 'a', reason: 'keep_current' });
    expect(decideRoute([stat('a', 0.10), stat('b', 0.07)], 'a', 'a', cfg)).toMatchObject({ model: 'b', changed: true, reason: 'better' });
  });
  it('does not flap when the two models trade small leads night after night', () => {
    let current = 'a';
    const nights = [[0.100, 0.095], [0.094, 0.099], [0.101, 0.092], [0.093, 0.100], [0.099, 0.091]];
    const picks = nights.map(([wa, wb]) => (current = decideRoute([stat('a', wa), stat('b', wb)], current, 'a', cfg).model));
    expect(new Set(picks)).toEqual(new Set(['a']));
  });
  it('caps answers per consultant so one person cannot steer routing', () => {
    const samples = [
      ...Array.from({ length: 500 }, () => ({ user_id: 'loud', model: 'b', words: 20, errors: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ user_id: `u${i}`, model: 'b', words: 20, errors: 4 })),
    ];
    const [b] = capPerUser(samples, 20);
    expect(b.answers).toBe(30);
    expect(b.consultants).toBe(11);
  });
  it('pinned model wins, auto-routing off uses the default, otherwise the most specific route', () => {
    const table = [{ language: 'ar', device: '*', accent: '*', model: 'b' }, { language: 'ar', device: 'mobile-safari', accent: 'gulf', model: 'c' }];
    expect(resolveRoute(table, { language: 'ar', device: 'mobile-safari', accent: 'gulf' }, { auto_routing: true, pinned_model: 'p' }, 'a').model).toBe('p');
    expect(resolveRoute(table, { language: 'ar', device: 'mobile-safari', accent: 'gulf' }, { auto_routing: false, pinned_model: null }, 'a').model).toBe('a');
    expect(resolveRoute(table, { language: 'ar-SA', device: 'mobile-safari', accent: 'gulf' }, { auto_routing: true, pinned_model: null }, 'a').model).toBe('c');
    expect(resolveRoute(table, { language: 'ar', device: 'desktop-chrome', accent: null }, { auto_routing: true, pinned_model: null }, 'a').model).toBe('b');
    expect(resolveRoute(table, { language: 'en', device: 'desktop-chrome', accent: null }, { auto_routing: true, pinned_model: null }, 'a').model).toBe('a');
  });
  it('device class is coarse', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('mobile-safari');
    expect(deviceClass('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('desktop-edge');
  });
});

describe('interviewer learning', () => {
  it('classifies skipped and misunderstood answers in English and Arabic', () => {
    expect(classifyAnswer('skip')).toBe('skip');
    expect(classifyAnswer('مش عارف')).toBe('skip');
    expect(classifyAnswer('Sorry, could you repeat the question?')).toBe('confusion');
    expect(classifyAnswer('معلش مش فاهم السؤال')).toBe('confusion');
    expect(classifyAnswer('I would post it with MIRO and check the GR/IR account')).toBe('answer');
  });
  it('flags a question misunderstood by 40 % once 10 candidates answered', () => {
    const s = { answers: 10, skips: 0, confusions: 4, avg_score: 60, voice_answers: 0, edited: 0, avg_answer_ms: null };
    expect(questionFlags(s, S)).toEqual(['misunderstood']);
    expect(flagSentence('misunderstood', s)).toBe('This question is misunderstood by 40 % of candidates.');
    expect(questionFlags({ ...s, answers: 9 }, S)).toEqual([]);
    expect(rewriteHints('What is X? And why Y?', ['misunderstood']).map((h) => h.key)).toEqual(['one_question', 'scenario']);
  });
  it('only clear, discriminating generated questions are library candidates', () => {
    const s = { answers: 12, skips: 0, confusions: 1, avg_score: 62, voice_answers: 0, edited: 0, avg_answer_ms: null };
    expect(libraryCandidate(s, S)).toBe(true);
    expect(libraryCandidate({ ...s, from_library: true }, S)).toBe(false);
    expect(libraryCandidate({ ...s, avg_score: 95 }, S)).toBe(false);
  });
});
