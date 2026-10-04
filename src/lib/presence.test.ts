import { describe, it, expect } from 'vitest';
import { PRESENCE_CHANNEL, applyPresence, presentIds } from './presence';

type Row = { id: string; status: 'available' | 'busy' | 'offline'; available: boolean; name: string };
const row = (id: string, status: Row['status']): Row => ({ id, status, available: status === 'available', name: `Consultant ${id}` });

describe('presentIds', () => {
  it('takes the keys of the presence state', () => {
    expect(Array.from(presentIds({ 'c-1': [{ at: 'x' }], 'c-2': [{ at: 'y' }, { at: 'z' }] })).sort()).toEqual(['c-1', 'c-2']);
  });

  it('leaves out a key without an open window', () => {
    expect(Array.from(presentIds({ 'c-1': [], 'c-2': [{ at: 'y' }] }))).toEqual(['c-2']);
  });

  it('gives an empty set for no state at all', () => {
    expect(presentIds({}).size).toBe(0);
    expect(presentIds(null).size).toBe(0);
    expect(presentIds(undefined).size).toBe(0);
  });

  it('uses one channel name for everybody', () => {
    expect(PRESENCE_CHANNEL).toBe('consultant-presence');
  });
});

describe('applyPresence', () => {
  it('keeps the status of a consultant who is present', () => {
    const online = row('c-1', 'available');
    const busy = row('c-2', 'busy');
    const present = new Set(['c-1', 'c-2']);
    expect(applyPresence(online, present)).toBe(online);
    expect(applyPresence(busy, present)).toBe(busy);
  });

  it('shows a consultant who is not present as offline', () => {
    const shown = applyPresence(row('c-1', 'available'), new Set(['c-9']));
    expect(shown.status).toBe('offline');
    expect(shown.available).toBe(false);
    expect(shown.name).toBe('Consultant c-1');
    expect(applyPresence(row('c-2', 'busy'), new Set()).status).toBe('offline');
  });

  it('does not change the original row', () => {
    const original = row('c-1', 'available');
    applyPresence(original, new Set());
    expect(original.status).toBe('available');
    expect(original.available).toBe(true);
  });

  it('keeps an offline consultant as it is, present or not', () => {
    const offline = row('c-1', 'offline');
    expect(applyPresence(offline, new Set())).toBe(offline);
    expect(applyPresence(offline, new Set(['c-1']))).toBe(offline);
  });

  it('shows the status that the consultant set while it is not known who is present', () => {
    const online = row('c-1', 'available');
    expect(applyPresence(online, null)).toBe(online);
  });

  it('works for a row without the field "available"', () => {
    const shown = applyPresence({ id: 'c-1', status: 'busy' as const }, new Set());
    expect(shown.status).toBe('offline');
  });
});
