import type { TileDensity } from '@/hooks/useTileDensity';

/**
 * Tailwind class fragments controlling the mobile (<sm) tile size for each
 * density mode. Desktop styles are unchanged across modes.
 */
export const mobileTileDensityClasses: Record<
  TileDensity,
  { row: string; iconBox: string; label: string }
> = {
  comfortable: {
    row: 'gap-3 px-3 py-2.5 min-h-[52px]',
    iconBox: 'w-10 h-10',
    label: 'text-[13px]',
  },
  compact: {
    row: 'gap-2 px-2.5 py-1.5 min-h-[40px]',
    iconBox: 'w-8 h-8',
    label: 'text-[12px]',
  },
};
