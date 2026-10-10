import { useTranslation } from 'react-i18next';
import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { clientNavGroups, clientPrimaryAction } from '@/components/sidebar/navConfig';
import { useTenant } from '@/contexts/TenantContext';
import { usePricingTerms } from '@/hooks/usePricingTerms';

export default function ClientSidebar() {
  const { t } = useTranslation();
  const { tenant, membership } = useTenant();
  const { data: terms } = usePricingTerms();

  // the plan is only shown while subscription plans are offered; otherwise the sidebar shows the role of the user in the company
  const plansOn = terms?.plansEnabled === true;
  const tier = tenant?.subscription_tier || 'basic';
  const role = membership?.org_role;
  const workspace = tenant
    ? {
        name: tenant.name,
        subtitle: plansOn
          ? String(
              t('sidebar.plan_name', {
                tier: String(t(`sidebar.tier.${tier}`, { defaultValue: tier })),
                defaultValue: '{{tier}} plan',
              }),
            )
          : role
            ? String(t(`sidebar.org_role.${role}`, { defaultValue: role.charAt(0).toUpperCase() + role.slice(1) }))
            : '',
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
