import { describe, expect, it } from 'vitest';
import {
  baseDifficulty, buildInterviewPlan, extractPlanTag, freshQuestions, inferVersion, missingVersionQuestions, moduleDifficulty,
  moduleWeight, normalizeQuestion, questionHash, questionSlots, sampleSlots, scenarioParameters, seededShuffle, stripPlanTags,
  type PlanProfile,
} from '../../supabase/functions/_shared/interviewPlan.ts';
import { normalizeKnowledgeSettings, DEFAULT_KNOWLEDGE_SETTINGS } from '../../supabase/functions/_shared/knowledgeDocs.ts';

const profile = (over: Partial<PlanProfile> = {}): PlanProfile => ({
  skills: [
    { module: 'SAP FI', version: 'S/4HANA 2023', years: 10, proficiency: 5, certified: true },
    { module: 'SAP MM', version: null, years: 3, proficiency: 3, certified: false },
    { module: 'SAP Fiori', version: null, years: 1, proficiency: 2, certified: false },
  ],
  seniority: 'senior',
  totalYears: 11,
  technologies: ['S/4HANA On-Premise'],
  deployment: ['On-premise'],
  projectTypes: ['Implementation'],
  projects: [{ modules: ['FI'], durationMonths: 18 }, { modules: ['SAP FI', 'MM'], durationMonths: 6 }],
  cvSummary: null,
  ...over,
});

describe('plan weights', () => {
  it('weighs years, proficiency, certification and project use', () => {
    const strong = moduleWeight({ module: 'FI', version: null, years: 15, proficiency: 5, certified: true }, [{ modules: ['FI'], durationMonths: 48 }]);
    const weak = moduleWeight({ module: 'FI', version: null, years: 0, proficiency: 1, certified: false }, []);
    expect(strong).toBe(1);
    expect(weak).toBe(0.05);
    const certified = moduleWeight({ module: 'X', version: null, years: 5, proficiency: 3, certified: true }, []);
    const notCertified = moduleWeight({ module: 'X', version: null, years: 5, proficiency: 3, certified: false }, []);
    expect(Math.round((certified - notCertified) * 100) / 100).toBe(0.1);
  });

  it('does not count "Fiori" projects as "FI" use', () => {
    const a = moduleWeight({ module: 'FI', version: null, years: 2, proficiency: 3, certified: false }, [{ modules: ['SAP Fiori'], durationMonths: 24 }]);
    const b = moduleWeight({ module: 'FI', version: null, years: 2, proficiency: 3, certified: false }, []);
    expect(a).toBe(b);
  });
});

describe('plan allocation', () => {
  it('covers every declared module at least once and gives the strongest more', () => {
    const plan = buildInterviewPlan(profile(), { minPerModule: 1, maxPerModule: 3, totalQuestions: 6, maxModules: 8 });
    expect(plan.items.map((i) => i.module)).toEqual(['SAP FI', 'SAP MM', 'SAP Fiori']);
    expect(plan.items.every((i) => i.questions >= 1)).toBe(true);
    expect(plan.items[0].questions).toBe(3);
    expect(plan.totalQuestions).toBe(6);
  });

  it('never exceeds the maximum per module', () => {
    const plan = buildInterviewPlan(profile(), { minPerModule: 1, maxPerModule: 2, totalQuestions: 16, maxModules: 8 });
    expect(Math.max(...plan.items.map((i) => i.questions))).toBe(2);
    expect(plan.totalQuestions).toBe(6);
  });

  it('raises a short interview so every module still gets its minimum', () => {
    const plan = buildInterviewPlan(profile(), { minPerModule: 1, maxPerModule: 3, totalQuestions: 3, maxModules: 8 });
    expect(plan.items.map((i) => i.questions)).toEqual([1, 1, 1]);
  });

  it('lists modules beyond the module limit as not covered', () => {
    const plan = buildInterviewPlan(profile(), { minPerModule: 1, maxPerModule: 3, totalQuestions: 6, maxModules: 2 });
    expect(plan.items).toHaveLength(2);
    expect(plan.uncovered).toEqual(['SAP Fiori']);
  });

  it('ignores duplicate modules ("SAP FI" and "fi")', () => {
    const p = profile();
    p.skills.push({ module: 'fi', version: null, years: 1, proficiency: 1, certified: false });
    expect(buildInterviewPlan(p).items.filter((i) => i.module.toLowerCase().includes('fi') && !i.module.includes('Fiori'))).toHaveLength(1);
  });

  it('is the same for the same profile', () => {
    expect(buildInterviewPlan(profile())).toEqual(buildInterviewPlan(profile()));
  });
});

describe('difficulty', () => {
  it('follows seniority, else total years', () => {
    expect(baseDifficulty('junior', 20)).toBe('easy');
    expect(baseDifficulty('principal', 1)).toBe('expert');
    expect(baseDifficulty(null, 2)).toBe('easy');
    expect(baseDifficulty(null, 7)).toBe('hard');
    expect(baseDifficulty(null, null)).toBe('medium');
  });
  it('is one lower for a light module and one higher for a deep one', () => {
    expect(moduleDifficulty('hard', { years: 1, proficiency: 2 })).toBe('medium');
    expect(moduleDifficulty('hard', { years: 12, proficiency: 5 })).toBe('expert');
    expect(moduleDifficulty('expert', { years: 12, proficiency: 5 })).toBe('expert');
  });
});

describe('version rule', () => {
  it('reads a release from the module name, else asks for it', () => {
    expect(inferVersion('SAP ECC 6.0')).toBe('ECC 6.0');
    expect(inferVersion('ECC 6.0 EHP8 FI')).toBe('ECC 6.0 EHP8');
    expect(inferVersion('S/4HANA 2023 Finance')).toBe('S/4HANA 2023');
    expect(inferVersion('SAP MM')).toBeNull();
    const plan = buildInterviewPlan(profile({ skills: [{ module: 'SAP ECC 6.0', version: null, years: 5, proficiency: 3, certified: false }, { module: 'SAP MM', version: null, years: 5, proficiency: 3, certified: false }] }));
    expect(plan.items.find((i) => i.module === 'SAP ECC 6.0')?.versionSource).toBe('inferred');
    expect(plan.items.find((i) => i.module === 'SAP MM')?.versionSource).toBe('ask');
  });

  it('puts a version warm-up first for modules without a release, then the main questions, then one soft-skill question', () => {
    const plan = buildInterviewPlan(profile());
    const slots = questionSlots(plan, 'session-1');
    const warmups = slots.filter((s) => s.kind === 'version_warmup');
    expect(warmups.map((s) => s.module)).toEqual(['SAP MM', 'SAP Fiori']);
    expect(slots.slice(0, 2).every((s) => s.kind === 'version_warmup')).toBe(true);
    expect(slots.filter((s) => s.kind === 'soft_skill')).toHaveLength(1);
    expect(slots[slots.length - 1].kind).toBe('soft_skill');
    expect(slots.map((s) => s.slot)).toEqual(slots.map((_, i) => i + 1));
  });

  it('marks the first question of every module as version-specific', () => {
    const slots = questionSlots(buildInterviewPlan(profile()), 'x');
    const fi = slots.filter((s) => s.module === 'SAP FI' && s.kind !== 'version_warmup');
    expect(fi[0].versionSpecific).toBe(true);
    expect(fi[0].version).toBe('S/4HANA 2023');
    expect(fi.slice(1).every((s) => !s.versionSpecific)).toBe(true);
  });

  it('reports modules with a release but no version-specific question', () => {
    const plan = buildInterviewPlan(profile());
    expect(missingVersionQuestions(plan, [{ module: 'SAP FI', version_specific: false }])).toEqual(['SAP FI']);
    expect(missingVersionQuestions(plan, [{ module: 'FI', version_specific: true }])).toEqual([]);
  });
});

describe('no repeats and variety', () => {
  it('treats case, punctuation, spacing and tags as the same question', () => {
    expect(questionHash('How do you close a period in FI?')).toBe(questionHash('  how do you close a period in fi '));
    expect(questionHash('[[q: 3]] How do you close a period in FI?')).toBe(questionHash('How do you close a period in FI?'));
    expect(questionHash('How do you close a period in FI?')).not.toBe(questionHash('How do you close a period in CO?'));
    expect(normalizeQuestion('Ärger — ACDOCA!')).toBe('ärger acdoca');
  });

  it('drops questions the consultant already got, and duplicates', () => {
    const asked = new Set([questionHash('Explain document splitting.')]);
    const fresh = freshQuestions([{ question: 'Explain document splitting.' }, { question: 'Explain GR/IR clearing.' }, { question: 'explain gr/ir clearing' }], asked);
    expect(fresh.map((q) => q.question)).toEqual(['Explain GR/IR clearing.']);
  });

  it('varies kinds and scenario parameters between sessions but keeps one session stable', () => {
    const plan = buildInterviewPlan(profile());
    const kindsA = questionSlots(plan, 'session-A').map((s) => s.kind).join();
    expect(questionSlots(plan, 'session-A').map((s) => s.kind).join()).toBe(kindsA);
    const variants = new Set(['B', 'C', 'D', 'E', 'F', 'G'].map((x) => questionSlots(plan, `session-${x}`).map((s) => s.kind).join()));
    expect(variants.size).toBeGreaterThan(1);
    const scenarios = new Set(['1', '2', '3', '4', '5'].map((x) => JSON.stringify(scenarioParameters(x))));
    expect(scenarios.size).toBeGreaterThan(1);
    expect(seededShuffle([1, 2, 3, 4, 5], 'a').sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('builds a 5-question admin sample with one question per module first and the soft-skill question', () => {
    const slots = questionSlots(buildInterviewPlan(profile()), 's');
    const sample = sampleSlots(slots, 5);
    expect(sample).toHaveLength(5);
    expect(sample.some((s) => s.kind === 'version_warmup')).toBe(false);
    expect(new Set(sample.filter((s) => s.module).map((s) => s.module))).toEqual(new Set(['SAP FI', 'SAP MM', 'SAP Fiori']));
    expect(sample.filter((s) => s.kind === 'soft_skill')).toHaveLength(1);
  });
});

describe('plan tags', () => {
  it('reads and hides [[q: N]]', () => {
    expect(extractPlanTag('[[speaker: Ezz|Lead]] [[q: 4]] Next question')).toBe(4);
    expect(extractPlanTag('No tag')).toBeNull();
    expect(stripPlanTags('[[q: 12]] Hello [[q:3]]there')).toBe('Hello there');
  });
});

describe('admin settings', () => {
  it('is off by default and keeps numbers in bounds', () => {
    expect(normalizeKnowledgeSettings(null)).toEqual(DEFAULT_KNOWLEDGE_SETTINGS);
    expect(normalizeKnowledgeSettings(null).enabled).toBe(false);
    const s = normalizeKnowledgeSettings({ enabled: 'yes', min_per_module: 3, max_per_module: 1, total_questions: 99, max_ai_calls: 0 });
    expect(s.enabled).toBe(false);
    expect(s.max_per_module).toBe(3);
    expect(s.total_questions).toBe(16);
    expect(s.max_ai_calls).toBe(1);
    expect(normalizeKnowledgeSettings({ enabled: true }).enabled).toBe(true);
  });
});
