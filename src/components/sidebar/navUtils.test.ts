import { describe, expect, it } from 'vitest';
import { Gauge } from 'lucide-react';
import { bestMatchPath, matchesQuery, titleize, visibleGroups } from './navUtils';
import type { NavGroup } from './navTypes';

const paths = ['/client', '/client/tickets', '/client/tickets/archive', '/client/team'];

describe('bestMatchPath', () => {
  it('matches the portal root only on the exact URL', () => {
    expect(bestMatchPath('/client', paths, '/client')).toBe('/client');
    expect(bestMatchPath('/client/unknown', paths, '/client')).toBe('');
  });

  it('keeps the parent entry active on deep routes', () => {
    expect(bestMatchPath('/client/tickets/123', paths, '/client')).toBe('/client/tickets');
  });

  it('prefers the longest matching entry', () => {
    expect(bestMatchPath('/client/tickets/archive/7', paths, '/client')).toBe('/client/tickets/archive');
  });

  it('does not match siblings that only share a prefix', () => {
    expect(bestMatchPath('/client/teamwork', paths, '/client')).toBe('');
  });

  it('ignores a trailing slash', () => {
    expect(bestMatchPath('/client/tickets/', paths, '/client')).toBe('/client/tickets');
    expect(bestMatchPath('/client/', paths, '/client')).toBe('/client');
  });
});

describe('visibleGroups', () => {
  const groups: NavGroup[] = [
    {
      id: 'a',
      labelKey: 'sidebar.a',
      fallback: 'A',
      items: [
        { key: 'one', icon: Gauge, path: '/x/one' },
        { key: 'two', icon: Gauge, path: '/x/two' },
      ],
    },
    { id: 'b', labelKey: 'sidebar.b', fallback: 'B', items: [{ key: 'three', icon: Gauge, path: '/x/three' }] },
  ];

  it('removes hidden items and groups that end up empty', () => {
    const result = visibleGroups(groups, (key) => key !== 'three' && key !== 'one');
    expect(result.map((g) => g.id)).toEqual(['a']);
    expect(result[0].items.map((i) => i.key)).toEqual(['two']);
  });

  it('does not mutate the original groups', () => {
    visibleGroups(groups, () => false);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe('matchesQuery', () => {
  it('is case-insensitive and trims the query', () => {
    expect(matchesQuery('Video sessions', '  VIDEO ')).toBe(true);
  });

  it('treats an empty query as a match', () => {
    expect(matchesQuery('Anything', '   ')).toBe(true);
  });

  it('rejects unrelated text', () => {
    expect(matchesQuery('Invoices', 'ticket')).toBe(false);
  });

  it('works with Arabic labels', () => {
    expect(matchesQuery('جلسات الفيديو', 'الفيديو')).toBe(true);
  });
});

describe('titleize', () => {
  it('turns a key into a readable label', () => {
    expect(titleize('video_sessions')).toBe('Video Sessions');
  });
});
