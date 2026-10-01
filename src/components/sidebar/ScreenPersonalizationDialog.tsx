import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Settings2, Search, RotateCcw, Eye, EyeOff, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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
  /** Controlled mode: when `open` is passed the dialog renders without its own trigger button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function ScreenPersonalizationDialog({
  screens, hiddenScreens, onToggle, onResetAll, collapsed, open: openProp, onOpenChange,
}: Props) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (controlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };

  const groups = [...new Set(screens.map(s => s.group || 'General'))];
  const filtered = screens.filter(s =>
    s.label.toLowerCase().includes(search.toLowerCase()) ||
    s.key.toLowerCase().includes(search.toLowerCase())
  );

  const visibleCount = screens.filter(s => !hiddenScreens.has(s.key)).length;
  const hiddenCount = hiddenScreens.size;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <button
            className="flex items-center gap-2 text-[11px] text-sidebar-foreground/50 hover:text-sidebar-foreground transition-all hover:bg-sidebar-accent/40 rounded-lg px-2 py-1.5 w-full"
            title={String(t('sidebar.personalize', { defaultValue: 'Customize menu' }))}
          >
            <Settings2 className="w-3.5 h-3.5" />
            {!collapsed && <span>{String(t('sidebar.personalize', { defaultValue: 'Customize menu' }))}</span>}
          </button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 bg-gradient-to-br from-primary/5 to-primary/10 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            {String(t('sidebar.personalize_title', { defaultValue: 'Customize menu' }))}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {String(t('sidebar.personalize_desc', { defaultValue: 'Show or hide pages from your navigation. Changes are saved automatically.' }))}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Eye className="w-3 h-3" /> {String(t('sidebar.visible_n', { n: visibleCount, defaultValue: '{{n}} visible' }))}
            </Badge>
            {hiddenCount > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                <EyeOff className="w-3 h-3" /> {String(t('sidebar.hidden_n', { n: hiddenCount, defaultValue: '{{n}} hidden' }))}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="px-4 py-3 border-b border-border/30">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={String(t('sidebar.search_screens', { defaultValue: 'Search pages...' }))}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="ps-9 h-9 text-sm bg-muted/30"
            />
          </div>
        </div>

        <ScrollArea className="max-h-[400px]">
          <div className="p-4 space-y-5">
            {groups.map(group => {
              const groupScreens = filtered.filter(s => (s.group || 'General') === group);
              if (groupScreens.length === 0) return null;
              return (
                <div key={group}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5 px-1 rtl:tracking-normal">
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
                            <Badge variant="secondary" className="text-[9px]">
                              {String(t('sidebar.required', { defaultValue: 'Required' }))}
                            </Badge>
                          ) : (
                            <Switch
                              checked={visible}
                              onCheckedChange={val => onToggle(screen.key, val)}
                              aria-label={screen.label}
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
              {String(t('sidebar.reset_all', { defaultValue: 'Reset all and show everything' }))}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
