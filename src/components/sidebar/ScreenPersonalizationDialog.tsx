import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Settings2, Search, RotateCcw, Eye, EyeOff, Sparkles, Rows3, Rows2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTileDensity, type TileDensity } from '@/hooks/useTileDensity';

interface ScreenItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  group?: string;
  required?: boolean; // dashboard should always be visible
}

interface Props {
  screens: ScreenItem[];
  hiddenScreens: Set<string>;
  onToggle: (key: string, visible: boolean) => void;
  onResetAll: () => void;
  collapsed?: boolean;
}

export default function ScreenPersonalizationDialog({ screens, hiddenScreens, onToggle, onResetAll, collapsed }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { density, setDensity } = useTileDensity();

  const densityOptions: { value: TileDensity; label: string; hint: string; Icon: LucideIcon }[] = [
    { value: 'comfortable', label: t('sidebar.density_comfortable', 'Comfortable'), hint: t('sidebar.density_comfortable_hint', 'Bigger labels, easier to tap'), Icon: Rows2 },
    { value: 'compact', label: t('sidebar.density_compact', 'Compact'), hint: t('sidebar.density_compact_hint', 'Fit more tiles on screen'), Icon: Rows3 },
  ];

  const groups = [...new Set(screens.map(s => s.group || 'General'))];
  const filtered = screens.filter(s =>
    s.label.toLowerCase().includes(search.toLowerCase()) ||
    s.key.toLowerCase().includes(search.toLowerCase())
  );

  const visibleCount = screens.filter(s => !hiddenScreens.has(s.key)).length;
  const hiddenCount = hiddenScreens.size;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-2 text-[11px] text-sidebar-foreground/50 hover:text-sidebar-foreground transition-all hover:bg-sidebar-accent/40 rounded-lg px-2 py-1.5 w-full"
          title={t('sidebar.personalize', 'Personalize Screens')}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {!collapsed && <span>{t('sidebar.personalize', 'Personalize')}</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 bg-gradient-to-br from-primary/5 to-primary/10 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            {t('sidebar.personalize_title', 'Personalize Screens')}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t('sidebar.personalize_desc', 'Show or hide pages from your navigation. Changes are saved automatically.')}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Eye className="w-3 h-3" /> {visibleCount} visible
            </Badge>
            {hiddenCount > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                <EyeOff className="w-3 h-3" /> {hiddenCount} hidden
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="px-4 py-3 border-b border-border/30">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t('sidebar.search_screens', 'Search screens...')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="ps-9 h-9 text-sm bg-muted/30"
            />
          </div>
        </div>

        {/* Tile density (mobile-focused but applies anywhere the row tile shows) */}
        <div className="px-4 py-3 border-b border-border/30">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t('sidebar.density_title', 'Tile density (mobile)')}
            </p>
            <span className="text-[10px] text-muted-foreground/70">
              {t('sidebar.density_subtitle', 'Choose your reading comfort')}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label={t('sidebar.density_title', 'Tile density (mobile)')}
            className="grid grid-cols-2 gap-2"
          >
            {densityOptions.map(({ value, label, hint, Icon }) => {
              const active = density === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setDensity(value)}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-start transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-border/60 bg-background hover:bg-muted/40'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                      {label}
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                      {hint}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <ScrollArea className="max-h-[400px]">
          <div className="p-4 space-y-5">
            {groups.map(group => {
              const groupScreens = filtered.filter(s => (s.group || 'General') === group);
              if (groupScreens.length === 0) return null;
              return (
                <div key={group}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5 px-1">
                    {group}
                  </p>
                  <div className="space-y-1">
                    {groupScreens.map(screen => {
                      const Icon = screen.icon;
                      const visible = !hiddenScreens.has(screen.key);
                      const isRequired = screen.required;
                      return (
                        <div
                          key={screen.key}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                            visible
                              ? 'bg-background hover:bg-muted/50'
                              : 'bg-muted/20 opacity-60 hover:opacity-80'
                          }`}
                        >
                          {Icon && (
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                            }`}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                          )}
                          <span className={`flex-1 text-sm font-medium ${
                            visible ? 'text-foreground' : 'text-muted-foreground line-through'
                          }`}>
                            {screen.label}
                          </span>
                          {isRequired ? (
                            <Badge variant="secondary" className="text-[9px]">Required</Badge>
                          ) : (
                            <Switch
                              checked={visible}
                              onCheckedChange={val => onToggle(screen.key, val)}
                              className="scale-90"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {hiddenCount > 0 && (
          <div className="p-4 border-t border-border/30 bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              onClick={onResetAll}
              className="w-full gap-2 text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('sidebar.reset_all', 'Reset All — Show Everything')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
