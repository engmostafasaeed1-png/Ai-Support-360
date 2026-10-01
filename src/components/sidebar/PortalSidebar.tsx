import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Building, ChevronRight, Shield } from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenuButton, useSidebar,
} from '@/components/ui/sidebar';
import ProfileEditDialog from '@/components/profile/ProfileEditDialog';
import ScreenPersonalizationDialog from '@/components/sidebar/ScreenPersonalizationDialog';
import { useLanguage } from '@/hooks/useLanguage';
import { useScreenPreferences } from '@/hooks/useScreenPreferences';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import SidebarAccountMenu from './SidebarAccountMenu';
import SidebarBrand from './SidebarBrand';
import SidebarNav from './SidebarNav';
import type { NavGroup, NavItem, NavScope } from './navTypes';
import { bestMatchPath, titleize, visibleGroups } from './navUtils';

/** The page filter is only worth its space once the menu is long. */
const SEARCH_MIN_ITEMS = 12;

interface ScreenEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  group: string;
  required: boolean;
}

export interface PortalSidebarProps {
  scope: NavScope;
  /** The portal home, e.g. /client. It only counts as active on that exact URL. */
  rootPath: string;
  /** Where the logo links to. */
  homePath?: string;
  subtitleKey: string;
  subtitleFallback: string;
  groups: NavGroup[];
  /** Highlighted button above the menu (the client's "New request"). */
  primaryAction?: NavItem;
  /** Company switcher row (client portal). */
  workspace?: { name: string; subtitle?: string; to: string } | null;
  /** Per-item runtime state, e.g. a finished onboarding. */
  itemState?: Record<string, { done?: boolean }>;
  /** Enables "Edit profile" in the account menu. */
  profileRole?: 'client' | 'consultant';
}

export default function PortalSidebar({
  scope, rootPath, homePath = '/', subtitleKey, subtitleFallback, groups, primaryAction, workspace, itemState, profileRole,
}: PortalSidebarProps) {
  const { state, isMobile } = useSidebar();
  // The mobile sheet always shows the full menu, whatever the desktop rail is doing.
  const collapsed = state === 'collapsed' && !isMobile;
  const { isRTL } = useLanguage();
  const { t } = useTranslation();
  const location = useLocation();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const labelOf = useCallback(
    (item: NavItem) =>
      String(t(item.labelKey ?? `sidebar.${item.key}`, { defaultValue: item.fallback ?? titleize(item.key) })),
    [t],
  );
  const groupLabelOf = useCallback(
    (group: NavGroup) => String(t(group.labelKey, { defaultValue: group.fallback })),
    [t],
  );

  // Everything the user can show or hide in "Customize menu".
  const screens = useMemo<ScreenEntry[]>(() => {
    const list: ScreenEntry[] = groups.flatMap((g) =>
      g.items.map((item) => ({
        key: item.key,
        label: labelOf(item),
        icon: item.icon,
        group: groupLabelOf(g),
        required: item.required === true,
      })),
    );
    if (primaryAction) {
      list.unshift({
        key: primaryAction.key,
        label: labelOf(primaryAction),
        icon: primaryAction.icon,
        group: groups[0] ? groupLabelOf(groups[0]) : '',
        required: primaryAction.required === true,
      });
    }
    return list;
  }, [groups, primaryAction, labelOf, groupLabelOf]);

  const { hiddenScreens, toggleScreen, resetAll, isVisible, loading } = useScreenPreferences(screens);

  const shownGroups = useMemo(() => visibleGroups(groups, isVisible), [groups, isVisible]);
  const itemCount = shownGroups.reduce((n, g) => n + g.items.length, 0);
  const allPaths = useMemo(
    () => [...groups.flatMap((g) => g.items.map((i) => i.path)), ...(primaryAction ? [primaryAction.path] : [])],
    [groups, primaryAction],
  );
  const activePath = bestMatchPath(location.pathname, allPaths, rootPath);

  const subtitle = String(t(subtitleKey, { defaultValue: subtitleFallback }));
  const showPrimaryAction = primaryAction !== undefined && isVisible(primaryAction.key);
  const PrimaryIcon = primaryAction?.icon;

  return (
    <>
      <Sidebar side={isRTL ? 'right' : 'left'} collapsible="icon" className="border-sidebar-border">
        <SidebarHeader className="gap-2 p-2">
          <SidebarBrand to={homePath} subtitle={subtitle} collapsed={collapsed} />

          {workspace && !collapsed && (
            <Link
              to={workspace.to}
              className="flex items-center gap-2.5 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/30 p-2 outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary/20 text-sidebar-primary">
                <Building aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium text-sidebar-foreground">{workspace.name}</span>
                {workspace.subtitle && (
                  <span className="block truncate text-[11px] text-sidebar-foreground/60">{workspace.subtitle}</span>
                )}
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-sidebar-foreground/40 rtl:rotate-180" />
            </Link>
          )}

          {showPrimaryAction && primaryAction && PrimaryIcon && (
            <SidebarMenuButton
              asChild
              isActive={activePath === primaryAction.path}
              tooltip={labelOf(primaryAction)}
              className="h-9 justify-center gap-2 rounded-md bg-blue-600 px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-blue-500 hover:text-white data-[active=true]:bg-blue-600 data-[active=true]:text-white"
            >
              <Link
                to={primaryAction.path}
                aria-current={activePath === primaryAction.path ? 'page' : undefined}
                aria-label={collapsed ? labelOf(primaryAction) : undefined}
              >
                <PrimaryIcon aria-hidden="true" focusable="false" />
                {!collapsed && <span>{labelOf(primaryAction)}</span>}
              </Link>
            </SidebarMenuButton>
          )}
        </SidebarHeader>

        <SidebarContent className="gap-0">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-color:hsl(var(--sidebar-border))_transparent] [scrollbar-width:thin] group-data-[collapsible=icon]:[scrollbar-width:none]">
            <SidebarNav
              scope={scope}
              groups={shownGroups}
              activePath={activePath}
              collapsed={collapsed}
              loading={loading}
              labelOf={labelOf}
              groupLabelOf={groupLabelOf}
              itemState={itemState}
              showSearch={itemCount >= SEARCH_MIN_ITEMS}
            />
          </div>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/60 p-2">
          <SidebarAccountMenu
            collapsed={collapsed}
            onEditProfile={profileRole ? () => setProfileOpen(true) : undefined}
            onCustomize={() => setCustomizeOpen(true)}
          />
        </SidebarFooter>
      </Sidebar>

      <ScreenPersonalizationDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        screens={screens}
        hiddenScreens={hiddenScreens}
        onToggle={toggleScreen}
        onResetAll={resetAll}
      />
      {profileRole && <ProfileEditDialog open={profileOpen} onOpenChange={setProfileOpen} role={profileRole} />}
    </>
  );
}
