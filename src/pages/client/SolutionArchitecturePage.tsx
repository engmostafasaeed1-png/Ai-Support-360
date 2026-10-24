import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Cpu, Plus, Search, Map, PenTool, Network, Ticket, Activity, Lightbulb } from 'lucide-react';
import BlueprintDocuments from '@/components/architecture/BlueprintDocuments';
import DesignDocuments from '@/components/architecture/DesignDocuments';
import SystemLandscape from '@/components/architecture/SystemLandscape';
import TicketReferences from '@/components/architecture/TicketReferences';
import ArchitectureTimeline from '@/components/architecture/ArchitectureTimeline';
import ArchDocList from '@/components/architecture/ArchDocList';
import ArchWizard from '@/components/architecture/ArchWizard';
import LandscapeRegister from '@/components/architecture/LandscapeRegister';
import ArchTimelineReal from '@/components/architecture/ArchTimelineReal';
import SamplePreview, { SamplePreviewNote } from '@/components/common/SamplePreview';
import { useTenant } from '@/contexts/TenantContext';
import { useArchList, useArchSettings } from '@/hooks/useArchitecture';
import { docsByTicket } from '@/lib/architecture/listing';

/**
 * Solution Architecture. Until the database update is applied the page keeps its examples (honestly labelled);
 * once applied, every tab shows the company's own data. "New Document" works only after the owner switches the
 * feature on (admin setting, default off) and only for the company's writers.
 */
export default function SolutionArchitecturePage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('blueprints');
  const [wizard, setWizard] = useState(false);
  const { membership } = useTenant();
  const { data: settings, isLoading: settingsLoading } = useArchSettings();
  const ready = !!settings?.ready;
  const enabled = ready && !!settings?.enabled;
  const isWriter = !membership || membership.org_role !== 'member';
  const canCreate = enabled && isWriter;
  const list = useArchList(ready);
  const byTicket = useMemo(() => (ready && list.data ? docsByTicket(list.data) : null), [ready, list.data]);
  const disabledNote = settingsLoading ? t('arch.loading') : !ready ? t('arch.unavailable.notReady') : !enabled ? t('arch.unavailable.off') : t('arch.unavailable.member');

  const listProps = {
    rows: list.data, loading: list.isLoading, error: list.error ? String(list.error) : null, search: searchQuery,
    canCreate, onCreate: () => setWizard(true), onRetry: () => void list.refetch(),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Cpu className="w-6 h-6 text-primary" aria-hidden />{t('arch.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('arch.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
            <Input placeholder={t('arch.search')} aria-label={t('arch.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="ps-9 h-9 w-56" />
          </div>
          {canCreate ? (
            <Button className="gradient-primary border-0 gap-1.5" onClick={() => setWizard(true)}><Plus className="w-4 h-4" /> {t('arch.newDocument')}</Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-describedby="arch-disabled-note">
                  <Button className="gradient-primary border-0 gap-1.5" disabled aria-disabled><Plus className="w-4 h-4" /> {t('arch.newDocument')}</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent id="arch-disabled-note">{disabledNote}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {!ready && !settingsLoading && <SamplePreviewNote what={t('arch.previewNote')} />}
      {ready && !enabled && <p role="note" className="rounded-xl border border-border bg-muted/50 p-3 text-sm">{t('arch.unavailable.off')}</p>}
      {canCreate && (list.data?.length ?? 0) === 0 && !list.isLoading && (
        <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm"><Lightbulb className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />{t('arch.list.startFromBrd')}</p>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="blueprints" className="gap-1.5"><Map className="w-3.5 h-3.5" aria-hidden /> {t('arch.tabs.blueprints')}</TabsTrigger>
          <TabsTrigger value="design-docs" className="gap-1.5"><PenTool className="w-3.5 h-3.5" aria-hidden /> {t('arch.tabs.design')}</TabsTrigger>
          <TabsTrigger value="landscape" className="gap-1.5"><Network className="w-3.5 h-3.5" aria-hidden /> {t('arch.tabs.landscape')}</TabsTrigger>
          <TabsTrigger value="tickets" className="gap-1.5"><Ticket className="w-3.5 h-3.5" aria-hidden /> {t('arch.tabs.tickets')}</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5"><Activity className="w-3.5 h-3.5" aria-hidden /> {t('arch.tabs.timeline')}</TabsTrigger>
        </TabsList>

        <TabsContent value="blueprints">
          {ready ? <ArchDocList group="blueprints" {...listProps} /> : <SamplePreview><BlueprintDocuments searchQuery={searchQuery} /></SamplePreview>}
        </TabsContent>
        <TabsContent value="design-docs">
          {ready ? <ArchDocList group="design" {...listProps} /> : <SamplePreview><DesignDocuments searchQuery={searchQuery} /></SamplePreview>}
        </TabsContent>
        <TabsContent value="landscape">
          {ready ? <LandscapeRegister canEdit={canCreate} /> : <SamplePreview><SystemLandscape /></SamplePreview>}
        </TabsContent>
        <TabsContent value="tickets">
          <TicketReferences searchQuery={searchQuery} docsByTicket={byTicket} />
        </TabsContent>
        <TabsContent value="timeline">
          {ready ? <ArchTimelineReal search={searchQuery} /> : <SamplePreview><ArchitectureTimeline /></SamplePreview>}
        </TabsContent>
      </Tabs>

      {canCreate && <ArchWizard open={wizard} onOpenChange={setWizard} />}
    </div>
  );
}
