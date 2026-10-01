import type { LucideIcon } from 'lucide-react';

export type NavScope = 'client' | 'consultant' | 'admin' | 'super-admin';

export interface NavItem {
  /** Stable key. It is also stored in user_screen_preferences, so never rename an existing one. */
  key: string;
  icon: LucideIcon;
  path: string;
  /** i18n key for the label. Defaults to `sidebar.${key}`. */
  labelKey?: string;
  /** English fallback used when the translation is missing. Defaults to the title-cased key. */
  fallback?: string;
  /** Cannot be hidden from the menu by the user (for example the dashboard). */
  required?: boolean;
}

export interface NavGroup {
  id: string;
  labelKey: string;
  fallback: string;
  /** Expanded for new users. The group that holds the current page is always opened. */
  defaultOpen?: boolean;
  items: NavItem[];
}
