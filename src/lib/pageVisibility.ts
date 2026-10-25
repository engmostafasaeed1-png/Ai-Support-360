import type { NavGroup } from '@/components/sidebar/navTypes';

/**
 * Pages the platform owner can hide or show without a deploy. Each key is a boolean row in platform_settings
 * (admin switch in Admin settings, default OFF; readable by signed-in users only after
 * docs/sql/solution-architecture-flag.sql). A missing or unreadable setting counts as hidden.
 */
export const PAGE_VISIBILITY_SETTINGS = ['solution_architecture_visible', 'support_agreements_visible'] as const;
export type PageVisibilitySetting = (typeof PAGE_VISIBILITY_SETTINGS)[number];
export type PageVisibility = Partial<Record<PageVisibilitySetting, boolean>>;

/** Menu groups without the items whose switch is off; groups left empty are dropped. */
export function filterNavGroups(groups: readonly NavGroup[], visible: PageVisibility): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.visibleSetting || visible[i.visibleSetting as PageVisibilitySetting] === true) }))
    .filter((g) => g.items.length > 0);
}

/** Route decision: show the page, wait (render nothing, so the page never flashes) or send the visitor home. */
export function pageAccess(opts: { loading: boolean; visible: boolean; isAdmin: boolean }): 'show' | 'wait' | 'redirect' {
  if (opts.isAdmin || opts.visible) return 'show';
  if (opts.loading) return 'wait';
  return 'redirect';
}
