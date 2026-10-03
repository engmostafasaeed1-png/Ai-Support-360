import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleanTitle,
  buildQuery,
  rankHits,
  searchCommunity,
  clearCommunityCache,
} from '../../supabase/functions/_shared/sapCommunity.ts';

const SITE = 'https://community.sap.com/t5/enterprise-resource-planning-q-a/';

function item(slug: string, subject: string, over: Record<string, unknown> = {}) {
  return {
    view_href: `${SITE}${slug}/qaq-p/1`,
    subject,
    message_type: 'forum_topic_message',
    post_time: '2026-09-01T10:00:00.000+02:00',
    conversation: { solved: false },
    ...over,
  };
}

function answer(items: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ status: 'success', data: { items } }) };
}

function fakeFetch(...answers: Array<ReturnType<typeof answer> | { ok: boolean; status: number; json: () => Promise<unknown> } | Error>) {
  let n = 0;
  return vi.fn(async (_url: string, _init?: unknown) => {
    const next = answers[Math.min(n, answers.length - 1)];
    n += 1;
    if (next instanceof Error) throw next;
    return next;
  });
}

const asFetch = (f: unknown) => f as unknown as typeof fetch;

describe('cleanTitle', () => {
  it('removes tags and decodes entities', () => {
    expect(cleanTitle('Posting &quot;period&quot; <b>closed</b> &amp; locked &#39;now&#39; &#x27;ok&#x27;')).toBe('Posting "period" closed & locked \'now\' \'ok\'');
  });

  it('collapses spaces and cuts long titles', () => {
    expect(cleanTitle('  many    spaces \n here ')).toBe('many spaces here');
    expect(cleanTitle('x'.repeat(300))).toHaveLength(140);
  });

  it('is safe for anything that is not text', () => {
    expect(cleanTitle(null)).toBe('');
    expect(cleanTitle(42)).toBe('');
    expect(cleanTitle({})).toBe('');
  });

  it('leaves an unknown entity as it is and drops an impossible code', () => {
    expect(cleanTitle('a &unknown; b')).toBe('a &unknown; b');
    expect(cleanTitle('a &#99999999; b')).toBe('a b');
  });
});

describe('buildQuery', () => {
  it('asks for topics whose title has all the words', () => {
    expect(buildQuery(['posting', 'period'], 5)).toBe(
      "SELECT id, subject, view_href, conversation.solved, post_time, message_type FROM messages WHERE depth = 0 AND subject MATCHES '+posting +period' LIMIT 5",
    );
  });
});

describe('rankHits', () => {
  it('puts solved questions first, then questions, then newer before older', () => {
    const hits = rankHits([
      item('a', 'Old open question', { post_time: '2025-01-01T00:00:00.000+01:00' }),
      item('b', 'Blog about it', { message_type: 'blog_topic_message', post_time: '2026-10-01T00:00:00.000+02:00' }),
      item('c', 'Solved question', { conversation: { solved: true }, post_time: '2024-01-01T00:00:00.000+01:00' }),
      item('d', 'New open question', { post_time: '2026-10-02T00:00:00.000+02:00' }),
    ]);
    expect(hits.map((h) => h.title)).toEqual(['Solved question', 'New open question', 'Old open question']);
    expect(hits[0].solved).toBe(true);
  });

  it('keeps only links on SAP Community, once each, with a title', () => {
    const hits = rankHits([
      item('a', 'Fine'),
      item('a', 'Fine again'),
      { ...item('b', 'Elsewhere'), view_href: 'https://evil.example.com/x' },
      { ...item('c', ''), subject: '   ' },
      { ...item('d', 'Not a link'), view_href: 42 },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].url.startsWith('https://community.sap.com/')).toBe(true);
  });

  it('gives at most three', () => {
    expect(rankHits(Array.from({ length: 9 }, (_, i) => item(`s${i}`, `Topic ${i}`)))).toHaveLength(3);
  });
});

describe('searchCommunity', () => {
  beforeEach(() => clearCommunityCache());

  it('asks with all the words and returns up to three hits', async () => {
    const f = fakeFetch(answer([item('a', 'One'), item('b', 'Two'), item('c', 'Three'), item('d', 'Four')]));
    const hits = await searchCommunity(['posting', 'period', 'closed', 'fb60'], { fetchImpl: asFetch(f) });
    expect(hits).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(String(f.mock.calls[0][0]));
    expect(url).toContain("MATCHES '+posting +period +closed +fb60'");
  });

  it('asks again with fewer words when it finds fewer than three', async () => {
    const f = fakeFetch(answer([item('a', 'Only one')]), answer([item('a', 'Only one'), item('b', 'Two'), item('c', 'Three')]));
    const hits = await searchCommunity(['posting', 'period', 'closed'], { fetchImpl: asFetch(f) });
    expect(hits).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(String(f.mock.calls[1][0]))).toContain("MATCHES '+posting +period'");
  });

  it('remembers an answer for ten minutes', async () => {
    const f = fakeFetch(answer([item('a', 'One'), item('b', 'Two'), item('c', 'Three')]));
    let clock = 1_000;
    const now = () => clock;
    await searchCommunity(['posting', 'period'], { fetchImpl: asFetch(f), now });
    clock += 5 * 60 * 1000;
    await searchCommunity(['posting', 'period'], { fetchImpl: asFetch(f), now });
    expect(f).toHaveBeenCalledTimes(1);
    clock += 6 * 60 * 1000;
    await searchCommunity(['posting', 'period'], { fetchImpl: asFetch(f), now });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('gives an empty list when SAP Community does not answer, and does not remember that', async () => {
    const f = fakeFetch(new Error('network down'), answer([item('a', 'One'), item('b', 'Two'), item('c', 'Three')]));
    expect(await searchCommunity(['posting', 'period'], { fetchImpl: asFetch(f) })).toEqual([]);
    expect(await searchCommunity(['posting', 'period'], { fetchImpl: asFetch(f) })).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('gives an empty list for an answer that is not OK', async () => {
    const f = fakeFetch({ ok: false, status: 503, json: async () => ({}) });
    expect(await searchCommunity(['posting', 'period'], { fetchImpl: asFetch(f) })).toEqual([]);
  });

  it('does not ask at all with fewer than two usable words', async () => {
    const f = fakeFetch(answer([]));
    expect(await searchCommunity(['error', 'x', '12345'], { fetchImpl: asFetch(f) })).toEqual([]);
    expect(await searchCommunity(['invoice'], { fetchImpl: asFetch(f) })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('sends only clean words, never a quote or a symbol', async () => {
    const f = fakeFetch(answer([]));
    await searchCommunity(["posting'; DROP", 'period"', 'a b'], { fetchImpl: asFetch(f) });
    const url = decodeURIComponent(String(f.mock.calls[0][0]));
    expect(url).toContain("MATCHES '+postingdrop +period +ab'");
  });
});
