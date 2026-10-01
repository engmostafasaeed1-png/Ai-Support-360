import { useTranslation } from 'react-i18next';
import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { clientNavGroups, clientPrimaryAction } from '@/components/sidebar/navConfig';
import { useTenant } from '@/contexts/TenantContext';

export default function ClientSidebar() {
  const { t } = useTranslation();
  const { tenant } = useTenant();

  const tier = tenant?.subscription_tier || 'basic';
  const workspace = tenant
    ? {
        name: tenant.name,
        subtitle: String(
          t('sidebar.plan_name', {
            tier: String(t(`sidebar.tier.${tier}`, { defaultValue: tier })),
            defaultValue: '{{tier}} plan',
          }),
        ),
        to: '/client/companies',
      }
    : null;

  return (
    <PortalSidebar
      scope="client"
      rootPath="/client"
      subtitleKey="sidebar.portal_client"
      subtitleFallback="Client portal"
      groups={clientNavGroups}
      primaryAction={clientPrimaryAction}
      workspace={workspace}
      profileRole="client"
    />
  );
}
