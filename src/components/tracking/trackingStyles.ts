import {
  Circle, Search, Hourglass, UserCog, KeyRound, Wrench, FlaskConical, Eye, RotateCcw, Pause, CheckCircle2, type LucideIcon,
} from 'lucide-react';
import type { TtColor, TtIcon, StageState } from '@/lib/ticketTracking';

export const STATUS_ICONS: Record<TtIcon, LucideIcon> = {
  circle: Circle, search: Search, hourglass: Hourglass, 'user-clock': UserCog, key: KeyRound, wrench: Wrench,
  flask: FlaskConical, eye: Eye, rotate: RotateCcw, pause: Pause, check: CheckCircle2,
};

/** Chip surface (text stays foreground for contrast; colour is never the only signal: icon + words). */
export const CHIP: Record<TtColor, string> = {
  muted: 'border-border bg-muted text-foreground',
  primary: 'border-primary/40 bg-primary/10 text-foreground',
  accent: 'border-accent/40 bg-accent/10 text-foreground',
  info: 'border-info/40 bg-info/10 text-foreground',
  success: 'border-success/40 bg-success/10 text-foreground',
  warning: 'border-warning/50 bg-warning/15 text-foreground',
  destructive: 'border-destructive/40 bg-destructive/10 text-foreground',
};

export const ICON: Record<TtColor, string> = {
  muted: 'text-muted-foreground', primary: 'text-primary', accent: 'text-accent', info: 'text-info',
  success: 'text-success', warning: 'text-warning', destructive: 'text-destructive',
};

export const BAR: Record<TtColor, string> = {
  muted: 'bg-muted-foreground/40', primary: 'bg-primary', accent: 'bg-accent', info: 'bg-info',
  success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive',
};

export const STAGE_DOT: Record<StageState, string> = {
  done: 'bg-success text-success-foreground border-success',
  current: 'bg-accent text-accent-foreground border-accent ring-4 ring-accent/20',
  pending: 'bg-background text-muted-foreground border-border',
  skipped: 'bg-background text-muted-foreground border-dashed border-muted-foreground/50',
};
