import { describe, expect, it } from 'vitest';
import {
  adminNavGroups, clientNavGroups, clientPrimaryAction, consultantNavGroups, superAdminNavGroups,
} from './navConfig';
import type { NavGroup, NavItem } from './navTypes';

// Links that deliberately lead into another portal.
const CROSS_PORTAL = ['/admin', '/super-admin'];

const portals: Array<[string, NavGroup[], string, NavItem[], number]> = [
  ['client', clientNavGroups, '/client', [clientPrimaryAction], 38],
  ['consultant', consultantNavGroups, '/consultant', [], 24],
  ['admin', adminNavGroups, '/admin', [], 26],
  ['super-admin', superAdminNavGroups, '/super-admin', [], 10],
];

describe.each(portals)('%s navigation config', (_name, groups, root, extra, count) => {
  const items = [...extra, ...groups.flatMap((g) => g.items)];

  it('has the expected number of menu items', () => {
    expect(items).toHaveLength(count);
  });

  it('has unique group ids and no empty group', () => {
    const ids = groups.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it('has unique item keys (they are saved as user preferences)', () => {
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has unique paths', () => {
    const paths = items.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps every page inside its portal, except deliberate cross-portal links and public-site links', () => {
    for (const item of items) {
      const inside = item.path === root || item.path.startsWith(`${root}/`);
      expect(inside || CROSS_PORTAL.includes(item.path) || item.external === true).toBe(true);
    }
  });

  it('has a required home entry that points at the portal root', () => {
    const home = items.find((i) => i.path === root);
    expect(home?.required).toBe(true);
  });

  it('opens at least one group by default', () => {
    expect(groups.some((g) => g.defaultOpen)).toBe(true);
  });
});

describe('consultant tour ids', () => {
  it('tags the menu items the product tour points at', () => {
    const ids = Object.fromEntries(consultantNavGroups.flatMap((g) => g.items).filter((i) => i.tourId).map((i) => [i.tourId, i.key]));
    expect(ids).toEqual({
      'nav-profile': 'profile', 'nav-my-bids': 'proposals', 'nav-open-requests': 'open_tickets',
      'nav-sessions': 'calendar', 'nav-messages': 'chat', 'nav-earnings': 'earnings',
    });
  });
});

describe('consultant landing-page link', () => {
  const item = consultantNavGroups.flatMap((g) => g.items).find((i) => i.key === 'landing_page');

  it('points at the public page and opens in a new tab', () => {
    expect(item).toMatchObject({
      path: '/for-consultants',
      labelKey: 'nav.landing_page',
      fallback: 'Landing page',
      external: true,
    });
    // The tour only targets the items it lists, so this one needs no data-tour id.
    expect(item?.tourId).toBeUndefined();
  });

  it('is offered to consultants only', () => {
    for (const [, groups, , extra] of portals) {
      const all = [...extra, ...groups.flatMap((g) => g.items)];
      expect(all.some((i) => i.key === 'landing_page')).toBe(groups === consultantNavGroups);
    }
  });

  it('sits at the bottom of the menu, not among the work items', () => {
    const last = consultantNavGroups[consultantNavGroups.length - 1];
    expect(last.id).toBe('account');
    expect(last.items[last.items.length - 1].key).toBe('landing_page');
  });
});
