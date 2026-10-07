import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, Ticket, Users, BarChart3, Settings, CreditCard,
  MessageSquare, Bell, Shield, FileText, Monitor, Briefcase, Calendar,
  DollarSign, UserCheck, Blocks, Building2, Star,
} from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  clientNavGroups, consultantNavGroups, adminNavGroups, superAdminNavGroups,
} from "@/components/sidebar/navConfig";
import type { NavGroup } from "@/components/sidebar/navTypes";
import { titleize } from "@/components/sidebar/navUtils";
import { OPEN_GLOBAL_SEARCH_EVENT } from "@/lib/globalSearch";

interface SearchItem {
  label: string;
  href: string;
  icon: React.ElementType;
  group: string;
}

// Used outside the portals (public pages).
const searchItems: SearchItem[] = [
  { label: "Client Dashboard", href: "/client", icon: LayoutDashboard, group: "Client" },
  { label: "New Request", href: "/client/new-request", icon: Ticket, group: "Client" },
  { label: "My Tickets", href: "/client/tickets", icon: FileText, group: "Client" },
  { label: "Consultants", href: "/client/consultants", icon: Users, group: "Client" },
  { label: "Payments", href: "/client/payments", icon: CreditCard, group: "Client" },
  { label: "Sessions", href: "/client/sessions", icon: Monitor, group: "Client" },
  { label: "Chat", href: "/client/chat", icon: MessageSquare, group: "Client" },
  { label: "Settings", href: "/client/settings", icon: Settings, group: "Client" },
  { label: "Company Profile", href: "/client/company", icon: Building2, group: "Client" },
  { label: "Integrations", href: "/client/integrations", icon: Blocks, group: "Client" },
  { label: "Remote Access", href: "/client/remote-access", icon: Monitor, group: "Client" },
  { label: "Consultant Dashboard", href: "/consultant", icon: LayoutDashboard, group: "Consultant" },
  { label: "Cases", href: "/consultant/cases", icon: Briefcase, group: "Consultant" },
  { label: "Calendar", href: "/consultant/calendar", icon: Calendar, group: "Consultant" },
  { label: "Earnings", href: "/consultant/earnings", icon: DollarSign, group: "Consultant" },
  { label: "Verification", href: "/consultant/verification", icon: UserCheck, group: "Consultant" },
  { label: "Profile", href: "/consultant/profile", icon: Star, group: "Consultant" },
  { label: "Admin Dashboard", href: "/admin", icon: Shield, group: "Admin" },
  { label: "Users", href: "/admin/users", icon: Users, group: "Admin" },
  { label: "Ticket Board", href: "/admin/tickets", icon: Ticket, group: "Admin" },
  { label: "Approvals", href: "/admin/approvals", icon: UserCheck, group: "Admin" },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3, group: "Admin" },
  { label: "NDA Management", href: "/admin/nda-management", icon: FileText, group: "Admin" },
  { label: "Environments", href: "/admin/environments", icon: Monitor, group: "Admin" },
  { label: "Pricing", href: "/pricing", icon: CreditCard, group: "Pages" },
  { label: "Notifications", href: "/client/notifications", icon: Bell, group: "Pages" },
];

const PORTALS: { prefix: string; groups: NavGroup[] }[] = [
  { prefix: "/super-admin", groups: superAdminNavGroups },
  { prefix: "/admin", groups: adminNavGroups },
  { prefix: "/consultant", groups: consultantNavGroups },
  { prefix: "/client", groups: clientNavGroups },
];

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openIt = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener(OPEN_GLOBAL_SEARCH_EVENT, openIt);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener(OPEN_GLOBAL_SEARCH_EVENT, openIt);
    };
  }, []);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      navigate(href);
    },
    [navigate],
  );

  const portal = PORTALS.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  const items = useMemo<SearchItem[]>(() => {
    if (!portal) return searchItems;
    const fromMenu = portal.groups.flatMap((g) => {
      const group = String(t(g.labelKey, { defaultValue: g.fallback }));
      return g.items.map((item) => ({
        label: String(t(item.labelKey ?? `sidebar.${item.key}`, { defaultValue: item.fallback ?? titleize(item.key) })),
        href: item.path,
        icon: item.icon as React.ElementType,
        group,
      }));
    });
    if (portal.prefix !== "/client") return fromMenu;
    return [
      {
        label: String(t("sidebar.new_request", { defaultValue: "New request" })),
        href: "/client/new-request",
        icon: Ticket as React.ElementType,
        group: String(t("search_quick_actions", { defaultValue: "Quick actions" })),
      },
      ...fromMenu,
    ];
  }, [portal, t]);

  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("search_placeholder", "Search pages, features...")} />
      <CommandList>
        <CommandEmpty>{t("no_results", "No results found.")}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {items
              .filter((i) => i.group === group)
              .map((item) => (
                <CommandItem
                  key={`${group}-${item.href}`}
                  value={item.label}
                  onSelect={() => handleSelect(item.href)}
                  className="gap-2"
                >
                  <item.icon className="w-4 h-4 text-muted-foreground" />
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
};

export default GlobalSearch;
