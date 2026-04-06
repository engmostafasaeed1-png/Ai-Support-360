import { useTenant } from '@/contexts/TenantContext';

type FeatureKey =
  | 'ai_chatbot'
  | 'ai_matching'
  | 'ai_ticket_classification'
  | 'kpi_dashboard'
  | 'remote_environments'
  | 'integrations'
  | 'knowledge_base'
  | 'custom_sla'
  | 'dedicated_support';

const TIER_FEATURES: Record<string, FeatureKey[]> = {
  basic: ['knowledge_base'],
  professional: [
    'knowledge_base',
    'ai_chatbot',
    'ai_matching',
    'ai_ticket_classification',
    'integrations',
    'kpi_dashboard',
  ],
  enterprise: [
    'knowledge_base',
    'ai_chatbot',
    'ai_matching',
    'ai_ticket_classification',
    'integrations',
    'kpi_dashboard',
    'remote_environments',
    'custom_sla',
    'dedicated_support',
  ],
};

export function useFeatureAccess() {
  const { tenant } = useTenant();

  const hasFeature = (feature: FeatureKey): boolean => {
    if (!tenant) return false;
    const tier = tenant.subscription_tier;
    return TIER_FEATURES[tier]?.includes(feature) ?? false;
  };

  const isWithinLimit = (usage: number, limitKey: 'max_tickets_per_month' | 'max_sessions_per_month' | 'ai_quota'): boolean => {
    if (!tenant) return false;
    const limit = tenant[limitKey];
    if (limit === -1) return true; // unlimited
    return usage < limit;
  };

  return { hasFeature, isWithinLimit, tier: tenant?.subscription_tier ?? 'basic' };
}
