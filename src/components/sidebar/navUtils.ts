import type { NavGroup } from './navTypes';

export const titleize = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Picks the nav entry that best matches the current URL, so deep routes such as
 * /client/tickets/123 keep their parent entry highlighted. The portal root
 * (for example /client) only matches exactly, otherwise it would match every page.
 */
export function bestMatchPath(pathname: string, paths: string[], rootPath: string): string {
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best = '';
  for (const p of paths) {
    if (p === rootPath) {
      if (current === rootPath && best === '') best = p;
      continue;
    }
    if (current === p || current.startsWith(`${p}/`)) {
      if (p.length > best.length) best = p;
    }
  }
  return best;
}

/** Drops the entries the user hid in "Customize menu" and any group left empty. */
export function visibleGroups(groups: NavGroup[], isVisible: (key: string) => boolean): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => isVisible(i.key)) }))
    .filter((g) => g.items.length > 0);
}

export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length === 0 || text.toLowerCase().includes(q);
}
