import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';

export const ALL_KPI_KEYS = [
  'totalTickets',
  'resolved',
  'resolutionRate',
  'avgResolution',
  'revenue',
  'avgSession',
] as const;
export type KpiKey = (typeof ALL_KPI_KEYS)[number];

export const KPI_LABELS: Record<KpiKey, string> = {
  totalTickets: 'Total Tickets',
  resolved: 'Resolved',
  resolutionRate: 'Resolution Rate',
  avgResolution: 'Avg Resolution',
  revenue: 'Revenue',
  avgSession: 'Avg Session',
};

export const ALL_RANGES = ['7d', '30d', '90d'] as const;
export type RangeKey = (typeof ALL_RANGES)[number];

const RANGE_LABELS: Record<RangeKey, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

const STORAGE_KEY = 'admin_analytics_panel_config_v1';

export interface AnalyticsPanelConfig {
  kpis: KpiKey[];
  ranges: RangeKey[];
}

const DEFAULT_CONFIG: AnalyticsPanelConfig = {
  kpis: [...ALL_KPI_KEYS],
  ranges: [...ALL_RANGES],
};

export function loadAnalyticsConfig(): AnalyticsPanelConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AnalyticsPanelConfig>;
    const kpis = Array.isArray(parsed.kpis)
      ? parsed.kpis.filter((k): k is KpiKey => (ALL_KPI_KEYS as readonly string[]).includes(k))
      : DEFAULT_CONFIG.kpis;
    const ranges = Array.isArray(parsed.ranges)
      ? parsed.ranges.filter((r): r is RangeKey => (ALL_RANGES as readonly string[]).includes(r))
      : DEFAULT_CONFIG.ranges;
    return {
      kpis: kpis.length > 0 ? kpis : DEFAULT_CONFIG.kpis,
      ranges: ranges.length > 0 ? ranges : DEFAULT_CONFIG.ranges,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveAnalyticsConfig(cfg: AnalyticsPanelConfig) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    window.dispatchEvent(new CustomEvent('admin_analytics_config_changed'));
  } catch {
    // ignore
  }
}

export function useAnalyticsConfig(): AnalyticsPanelConfig {
  const [cfg, setCfg] = useState<AnalyticsPanelConfig>(() => loadAnalyticsConfig());
  useEffect(() => {
    const handler = () => setCfg(loadAnalyticsConfig());
    window.addEventListener('admin_analytics_config_changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('admin_analytics_config_changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return cfg;
}

export function AnalyticsConfigPanel() {
  const [cfg, setCfg] = useState<AnalyticsPanelConfig>(() => loadAnalyticsConfig());

  const toggleKpi = (key: KpiKey) => {
    setCfg((prev) => {
      const next = prev.kpis.includes(key)
        ? { ...prev, kpis: prev.kpis.filter((k) => k !== key) }
        : { ...prev, kpis: [...prev.kpis, key] };
      // Don't allow zero KPIs
      const safe = next.kpis.length === 0 ? prev : next;
      saveAnalyticsConfig(safe);
      return safe;
    });
  };

  const toggleRange = (key: RangeKey) => {
    setCfg((prev) => {
      const next = prev.ranges.includes(key)
        ? { ...prev, ranges: prev.ranges.filter((r) => r !== key) }
        : { ...prev, ranges: [...prev.ranges, key] };
      const safe = next.ranges.length === 0 ? prev : next;
      saveAnalyticsConfig(safe);
      return safe;
    });
  };

  const reset = () => {
    setCfg(DEFAULT_CONFIG);
    saveAnalyticsConfig(DEFAULT_CONFIG);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs h-8 gap-1">
          <Settings2 className="w-3.5 h-3.5" /> Configure
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="end">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              KPI Cards
            </p>
            <div className="space-y-2">
              {ALL_KPI_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
                >
                  <Checkbox
                    checked={cfg.kpis.includes(key)}
                    onCheckedChange={() => toggleKpi(key)}
                  />
                  <span>{KPI_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Time ranges
            </p>
            <div className="space-y-2">
              {ALL_RANGES.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
                >
                  <Checkbox
                    checked={cfg.ranges.includes(key)}
                    onCheckedChange={() => toggleRange(key)}
                  />
                  <span>{RANGE_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>

          <Separator />

          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={reset}>
            Reset to defaults
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
