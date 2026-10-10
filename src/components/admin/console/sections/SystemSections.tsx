import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, HardDrive, Monitor, Server, Settings } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import { useStorageOverview } from '@/hooks/useAdminOverviews';
import { LinkCard, SectionShell } from './shared';

const formatBytes = (b: number): string => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
};

/* These four sections had no real settings behind them (the switches were switched off and the lists were typed by hand), so they were removed. */
export function NotificationsSection() {
  return <Navigate to="/admin/console" replace />;
}
export function LocalizationSection() {
  return <Navigate to="/admin/console" replace />;
}
export function AppearanceSection() {
  return <Navigate to="/admin/console" replace />;
}
export function EmailSection() {
  return <Navigate to="/admin/console" replace />;
}

/** Every storage bucket, read live from the database. */
export function StorageSection() {
  const { data, isLoading, error } = useStorageOverview();
  return (
    <SectionShell icon={HardDrive} title="File Storage" description="Every storage bucket with its real number of files and size, read live.">
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{(error as Error).message}</p>
      ) : (data ?? []).length === 0 ? (
        <p className="rounded-2xl border border-border/50 p-8 text-center text-sm text-muted-foreground">There are no storage buckets.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(data ?? []).map((b) => (
            <Card key={b.id} className="rounded-2xl">
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-mono text-sm font-medium text-foreground">{b.id}</p>
                  {b.public ? (
                    <Badge variant="outline" className="shrink-0 border-warning/50 bg-warning/10 text-[10px] text-warning">Public</Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">Private</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {b.objects} {b.objects === 1 ? 'file' : 'files'} · {formatBytes(b.bytes)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Size limit per file: {b.file_size_limit ? formatBytes(b.file_size_limit) : 'none set'}
                </p>
                {b.public ? (
                  <p className="text-[11px] text-muted-foreground">Public: anyone who has the link to a file can open it.</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

export function IntegrationsSection() {
  return (
    <SectionShell icon={Server} title="Integrations & API" description="External services the platform really uses">
      <LinkCard to="/admin/integrations" label="The integrations monitor shows the real state of the connected services." cta="Open Integrations" />
    </SectionShell>
  );
}

export function EnvironmentsSection() {
  return (
    <SectionShell icon={Monitor} title="Remote Environments" description="SAP remote access environments">
      <LinkCard to="/admin/environments" label="Create and manage the environments, their access and their status." cta="Open Remote Environments" />
    </SectionShell>
  );
}

export function LandingEditorSection() {
  return (
    <SectionShell icon={BookOpen} title="Landing Page Editor" description="The public landing page content">
      <LinkCard to="/admin/landing-editor" label="Edit the hero, features, testimonials and FAQ of the landing page." cta="Open the Landing Page Editor" />
    </SectionShell>
  );
}

export function PlatformSettingsSection() {
  return (
    <SectionShell icon={Settings} title="Platform Settings" description="Maintenance mode, open registration, portal layout and the NDA template">
      <LinkCard to="/admin/settings" label="The platform settings and the NDA template are edited on their own page." cta="Open Platform Settings" />
    </SectionShell>
  );
}

/** A real switch: the same setting as on the Platform Settings page, enforced by the maintenance gate of the app. */
export function MaintenanceSection() {
  const { settings, loading, updateSetting } = useAdminSettings();
  const [confirm, setConfirm] = useState(false);
  const on = !!settings.maintenance_mode;

  return (
    <SectionShell icon={AlertTriangle} title="Maintenance Mode" description="Show a maintenance page to everyone except administrators.">
      <Card className="rounded-2xl">
        <CardContent className="flex items-center justify-between gap-4 pt-6">
          <div className="min-w-0">
            <Label htmlFor="maintenance-mode" className="font-medium text-foreground">Maintenance mode</Label>
            <p className="text-xs text-muted-foreground">
              On: clients and consultants see a maintenance page and cannot work. Administrators can still sign in and use the platform. Open pages notice the change within a minute.
            </p>
          </div>
          {loading ? (
            <Skeleton className="h-5 w-9 rounded-full" />
          ) : (
            <Switch
              id="maintenance-mode"
              checked={on}
              onCheckedChange={(v) => (v ? setConfirm(true) : void updateSetting('maintenance_mode', false))}
            />
          )}
        </CardContent>
      </Card>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on maintenance mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone except administrators will see a maintenance page until you turn it off again. Work in progress on their screens stops.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void updateSetting('maintenance_mode', true)}>Turn on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  );
}
