import { Bell, Globe, Palette, HardDrive, Mail, Server, Monitor, BookOpen, Settings, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

function SectionShell({ icon: Icon, title, description, children }: { icon: any; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" /> {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SettingCard({ title, items }: { title: string; items: { label: string; value?: string; enabled?: boolean }[] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{item.label}</span>
            {item.enabled !== undefined ? (
              <Switch checked={item.enabled} disabled />
            ) : (
              <span className="text-sm font-medium text-foreground">{item.value}</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function NotificationsSection() {
  return (
    <SectionShell icon={Bell} title="Notifications" description="Configure notification channels and preferences">
      <div className="grid gap-4 md:grid-cols-2">
        <SettingCard title="Channels" items={[
          { label: 'In-App Notifications', enabled: true },
          { label: 'Email Notifications', enabled: true },
          { label: 'SMS Notifications', enabled: false },
          { label: 'Push Notifications', enabled: false },
        ]} />
        <SettingCard title="Events" items={[
          { label: 'New Ticket', enabled: true },
          { label: 'Ticket Assigned', enabled: true },
          { label: 'Payment Completed', enabled: true },
          { label: 'NDA Signed', enabled: true },
        ]} />
      </div>
    </SectionShell>
  );
}

export function LocalizationSection() {
  return (
    <SectionShell icon={Globe} title="Localization" description="Language and regional settings">
      <div className="grid gap-4 md:grid-cols-2">
        <SettingCard title="Languages" items={[
          { label: 'English', enabled: true },
          { label: 'Arabic', enabled: true },
          { label: 'Default Language', value: 'English' },
        ]} />
        <SettingCard title="Regional" items={[
          { label: 'Default Timezone', value: 'Asia/Riyadh' },
          { label: 'Currency', value: 'USD' },
          { label: 'Date Format', value: 'MMM d, yyyy' },
        ]} />
      </div>
    </SectionShell>
  );
}

export function AppearanceSection() {
  return (
    <SectionShell icon={Palette} title="Appearance & Theme" description="Configure platform look and feel">
      <div className="grid gap-4 md:grid-cols-2">
        <SettingCard title="Theme" items={[
          { label: 'Dark Mode', enabled: true },
          { label: 'Video Backgrounds', enabled: true },
          { label: 'Animations', enabled: true },
        ]} />
        <SettingCard title="Branding" items={[
          { label: 'Custom Logo', enabled: true },
          { label: 'Custom Colors', enabled: true },
          { label: 'WhatsApp Button', enabled: true },
        ]} />
      </div>
    </SectionShell>
  );
}

export function StorageSection() {
  return (
    <SectionShell icon={HardDrive} title="File Storage" description="Manage storage buckets and file policies">
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { name: 'avatars', public: true, desc: 'User profile pictures' },
          { name: 'chat-files', public: false, desc: 'Chat attachments' },
          { name: 'ticket-documents', public: false, desc: 'Ticket file uploads' },
        ].map((bucket) => (
          <Card key={bucket.name} className="rounded-2xl">
            <CardContent className="pt-6 text-center space-y-2">
              <HardDrive className="w-8 h-8 mx-auto text-primary/40" />
              <p className="font-mono text-sm font-medium text-foreground">{bucket.name}</p>
              <Badge variant={bucket.public ? 'default' : 'secondary'} className="text-[10px]">
                {bucket.public ? 'Public' : 'Private'}
              </Badge>
              <p className="text-xs text-muted-foreground">{bucket.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </SectionShell>
  );
}

export function EmailSection() {
  return (
    <SectionShell icon={Mail} title="Email Templates" description="Configure transactional email templates">
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { template: 'Welcome Email', status: 'Active' },
          { template: 'Password Reset', status: 'Active' },
          { template: 'Ticket Created', status: 'Active' },
          { template: 'Payment Receipt', status: 'Draft' },
        ].map((t) => (
          <Card key={t.template} className="rounded-xl">
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t.template}</span>
              <Badge variant={t.status === 'Active' ? 'default' : 'secondary'} className="text-[10px]">{t.status}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </SectionShell>
  );
}

export function IntegrationsSection() {
  return (
    <SectionShell icon={Server} title="Integrations & API" description="Manage external service integrations">
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { name: 'Jira', status: 'Available', desc: 'Sync tickets with Jira projects' },
          { name: 'ServiceNow', status: 'Available', desc: 'Enterprise service management' },
          { name: 'Slack', status: 'Coming Soon', desc: 'Team notifications and alerts' },
          { name: 'Stripe', status: 'Available', desc: 'Payment processing' },
        ].map((i) => (
          <Card key={i.name} className="rounded-2xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-foreground">{i.name}</span>
                <Badge variant={i.status === 'Available' ? 'outline' : 'secondary'} className="text-[10px]">{i.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{i.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </SectionShell>
  );
}

export function EnvironmentsSection() {
  return (
    <SectionShell icon={Monitor} title="Remote Environments" description="Manage SAP remote access environments">
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center text-muted-foreground">
          Remote environment management. Configure Guacamole connections and manage access.
        </CardContent>
      </Card>
    </SectionShell>
  );
}

export function LandingEditorSection() {
  return (
    <SectionShell icon={BookOpen} title="Landing Page Editor" description="Customize the public landing page content">
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center text-muted-foreground">
          Landing page content editor. Manage hero, features, testimonials, and FAQ sections.
        </CardContent>
      </Card>
    </SectionShell>
  );
}

export function PlatformSettingsSection() {
  return (
    <SectionShell icon={Settings} title="Platform Settings" description="General platform configuration">
      <div className="grid gap-4 md:grid-cols-2">
        <SettingCard title="General" items={[
          { label: 'Platform Name', value: 'AI Support 360' },
          { label: 'Support Email', value: 'support@qurtuba.com' },
          { label: 'Default Currency', value: 'USD' },
        ]} />
        <SettingCard title="Features" items={[
          { label: 'AI Chatbot', enabled: true },
          { label: 'Guest Mode', enabled: true },
          { label: 'Referral Program', enabled: true },
          { label: 'Screen Protection', enabled: true },
        ]} />
      </div>
    </SectionShell>
  );
}

export function MaintenanceSection() {
  return (
    <SectionShell icon={AlertTriangle} title="Maintenance Mode" description="Enable maintenance mode to restrict access">
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Maintenance Mode</p>
              <p className="text-xs text-muted-foreground">When enabled, only admins can access the platform</p>
            </div>
            <Switch disabled />
          </div>
        </CardContent>
      </Card>
    </SectionShell>
  );
}
