import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search, LayoutDashboard, Ticket, Users, BarChart3, Settings, CreditCard,
  MessageSquare, Bell, Shield, FileText, Monitor, Briefcase, Calendar,
  DollarSign, UserCheck, Blocks, Building2, Star,
} from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

interface SearchItem {
  label: string;
  href: string;
  icon: React.ElementType;
  group: string;
}

const searchItems: SearchItem[] = [
  // Client
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
  // Consultant
  { label: "Consultant Dashboard", href: "/consultant", icon: LayoutDashboard, group: "Consultant" },
  { label: "Cases", href: "/consultant/cases", icon: Briefcase, group: "Consultant" },
  { label: "Calendar", href: "/consultant/calendar", icon: Calendar, group: "Consultant" },
  { label: "Earnings", href: "/consultant/earnings", icon: DollarSign, group: "Consultant" },
  { label: "Verification", href: "/consultant/verification", icon: UserCheck, group: "Consultant" },
  { label: "Profile", href: "/consultant/profile", icon: Star, group: "Consultant" },
  // Admin
  { label: "Admin Dashboard", href: "/admin", icon: Shield, group: "Admin" },
  { label: "Users", href: "/admin/users", icon: Users, group: "Admin" },
  { label: "Ticket Board", href: "/admin/tickets", icon: Ticket, group: "Admin" },
  { label: "Approvals", href: "/admin/approvals", icon: UserCheck, group: "Admin" },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3, group: "Admin" },
  { label: "NDA Management", href: "/admin/nda-management", icon: FileText, group: "Admin" },
  { label: "Environments", href: "/admin/environments", icon: Monitor, group: "Admin" },
  // General
  { label: "Pricing", href: "/pricing", icon: CreditCard, group: "Pages" },
  { label: "Notifications", href: "/client/notifications", icon: Bell, group: "Pages" },
];

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      navigate(href);
    },
    [navigate]
  );

  const groups = [...new Set(searchItems.map((i) => i.group))];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-muted/30 text-muted-foreground text-xs hover:bg-muted/60 transition-colors"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="w-3.5 h-3.5" />
        <span>{t('search', 'Search...')}</span>
        <kbd className="ml-2 px-1.5 py-0.5 rounded bg-muted border border-border/50 text-[10px] font-mono">⌘K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t('search_placeholder', 'Search pages, features...')} />
        <CommandList>
          <CommandEmpty>{t('no_results', 'No results found.')}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {searchItems
                .filter((i) => i.group === group)
                .map((item) => (
                  <CommandItem
                    key={item.href}
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
    </>
  );
};

export default GlobalSearch;
