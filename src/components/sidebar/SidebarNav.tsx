import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronRight, Search, X } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';
import type { NavGroup, NavItem } from './navTypes';
import { matchesQuery, titleize } from './navUtils';

const STORAGE_PREFIX = 'sidebar:groups:';

/** Which groups the user opened or closed by hand. Groups without an entry follow their default. */
function readGroupState(scope: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + scope);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean'),
      ) as Record<string, boolean>;
    }
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return {};
}

function writeGroupState(scope: string, state: Record<string, boolean>) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

interface NavRowProps {
  item: NavItem;
  label: string;
  active: boolean;
  collapsed: boolean;
  done?: boolean;
  badge?: number;
}

function NavRow({ item, label, active, collapsed, done, badge }: NavRowProps) {
  const Icon = done ? CheckCircle2 : item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={label}
        className={cn(
          'relative h-9 gap-3 rounded-md px-3 text-start text-[13px] font-medium text-sidebar-foreground/75',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground',
          'data-[active=true]:before:absolute data-[active=true]:before:inset-y-2 data-[active=true]:before:start-0 data-[active=true]:before:w-[3px] data-[active=true]:before:rounded-full data-[active=true]:before:bg-sidebar-primary',
        )}
      >
        <Link to={item.path} aria-current={active ? 'page' : undefined} aria-label={collapsed ? label : undefined}>
          <Icon aria-hidden="true" focusable="false" className={done ? 'text-emerald-400' : undefined} />
          {!collapsed && <span>{label}</span>}
          {!collapsed && badge ? (
            <span className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
              {badge > 99 ? '99+' : badge}
            </span>
          ) : null}
          {collapsed && badge ? (
            <span aria-hidden="true" className="absolute end-1 top-1 h-2 w-2 rounded-full bg-accent" />
          ) : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

interface SidebarNavProps {
  scope: string;
  /** Groups that still have at least one visible item. */
  groups: NavGroup[];
  activePath: string;
  collapsed: boolean;
  loading: boolean;
  labelOf: (item: NavItem) => string;
  groupLabelOf: (group: NavGroup) => string;
  itemState?: Record<string, { done?: boolean; badge?: number }>;
  showSearch: boolean;
}

export default function SidebarNav({
  scope, groups, activePath, collapsed, loading, labelOf, groupLabelOf, itemState, showSearch,
}: SidebarNavProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => readGroupState(scope));
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const searching = !collapsed && showSearch && query.trim().length > 0;
  const activeGroupId = groups.find((g) => g.items.some((i) => i.path === activePath))?.id;

  const filtered = useMemo(() => {
    if (!searching) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => matchesQuery(`${labelOf(i)} ${i.fallback ?? titleize(i.key)}`, query)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, searching, query, labelOf]);

  // Arriving on a page whose group the user had closed re-opens that group.
  useEffect(() => {
    if (!activeGroupId) return;
    if (overridesRef.current[activeGroupId] === false) {
      const next = { ...overridesRef.current, [activeGroupId]: true };
      setOverrides(next);
      writeGroupState(scope, next);
    }
  }, [activeGroupId, scope]);

  // Keep the current page visible inside the scrolling menu.
  useEffect(() => {
    if (loading) return undefined;
    const id = window.setTimeout(() => {
      navRef.current
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView?.({ block: 'nearest' });
    }, 60);
    return () => window.clearTimeout(id);
  }, [activePath, collapsed, loading]);

  const isOpen = (g: NavGroup) =>
    searching || (overrides[g.id] ?? (g.defaultOpen === true || g.id === activeGroupId));

  const toggle = (g: NavGroup) => {
    const next = { ...overridesRef.current, [g.id]: !isOpen(g) };
    setOverrides(next);
    writeGroupState(scope, next);
  };

  const navLabel = String(t('sidebar.nav_label', { defaultValue: 'Portal navigation' }));

  if (collapsed) {
    return (
      <nav ref={navRef} aria-label={navLabel} aria-busy={loading} className="px-2 py-1">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="mb-1 h-8 w-8 rounded-md bg-sidebar-accent/50" />
            ))
          : groups.map((group, index) => (
              <div key={group.id} className={cn(index > 0 && 'mt-1.5 border-t border-sidebar-border/60 pt-1.5')}>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => (
                    <NavRow
                      key={item.key}
                      item={item}
                      label={labelOf(item)}
                      active={item.path === activePath}
                      collapsed
                      done={itemState?.[item.key]?.done} badge={itemState?.[item.key]?.badge}
                    />
                  ))}
                </SidebarMenu>
              </div>
            ))}
      </nav>
    );
  }

  return (
    <nav ref={navRef} aria-label={navLabel} aria-busy={loading} className="px-2 pb-3">
      {loading ? (
        <div className="space-y-4 pt-2" aria-hidden="true">
          {[5, 4].map((rows, gi) => (
            <div key={gi} className="space-y-1.5">
              <Skeleton className="ms-3 h-3 w-16 bg-sidebar-accent/50" />
              {Array.from({ length: rows }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-md bg-sidebar-accent/40" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <>
          {showSearch && (
            <div className="relative mb-2 mt-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/60"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('');
                  if (e.key === 'Enter') {
                    const first = filtered[0]?.items[0];
                    if (first) {
                      navigate(first.path);
                      setQuery('');
                    }
                  }
                }}
                placeholder={String(t('sidebar.search_placeholder', { defaultValue: 'Find a page…' }))}
                aria-label={String(t('sidebar.search_label', { defaultValue: 'Search menu' }))}
                className="h-9 w-full appearance-none rounded-md border border-transparent bg-sidebar-accent/40 ps-9 pe-8 text-[13px] text-sidebar-foreground outline-none transition-colors placeholder:text-sidebar-foreground/60 hover:bg-sidebar-accent/60 focus-visible:border-sidebar-ring focus-visible:bg-sidebar-accent/60 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={String(t('sidebar.search_clear', { defaultValue: 'Clear search' }))}
                  className="absolute end-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/60 outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <p role="status" className="px-3 py-6 text-center text-xs text-sidebar-foreground/60">
              {String(t('sidebar.no_results', { defaultValue: 'No matching pages' }))}
            </p>
          ) : (
            filtered.map((group) => {
              const open = isOpen(group);
              const listId = `sidebar-${scope}-${group.id}`;
              return (
                <section key={group.id} className="py-0.5">
                  <button
                    type="button"
                    onClick={() => toggle(group)}
                    disabled={searching}
                    aria-expanded={open}
                    aria-controls={listId}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-3 text-xs font-medium text-sidebar-foreground/60 outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none"
                  >
                    <span className="truncate">{groupLabelOf(group)}</span>
                    {!searching && (
                      <span className="ms-auto flex items-center gap-2">
                        {!open && group.id === activeGroupId && (
                          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
                        )}
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40 transition-transform duration-200',
                            open ? 'rotate-90' : isRTL && 'rotate-180',
                          )}
                        />
                      </span>
                    )}
                  </button>
                  {open && (
                    <SidebarMenu
                      id={listId}
                      className="mt-0.5 gap-0.5 animate-in fade-in-0 slide-in-from-top-1 duration-150"
                    >
                      {group.items.map((item) => (
                        <NavRow
                          key={item.key}
                          item={item}
                          label={labelOf(item)}
                          active={item.path === activePath}
                          collapsed={false}
                          done={itemState?.[item.key]?.done} badge={itemState?.[item.key]?.badge}
                        />
                      ))}
                    </SidebarMenu>
                  )}
                </section>
              );
            })
          )}
        </>
      )}
    </nav>
  );
}
