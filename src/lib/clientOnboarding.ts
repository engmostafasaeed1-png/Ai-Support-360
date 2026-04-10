export interface ClientOnboardingSnapshot {
  onboarding_completed?: boolean | null;
  company_name?: string | null;
  company_size?: string | null;
  industry?: string | null;
  phone?: string | null;
  sap_modules?: string[] | null;
}

const hasText = (value?: string | null) => Boolean(value?.trim());

export function getClientOnboardingState(profile: ClientOnboardingSnapshot | null | undefined) {
  const checks = {
    companyName: hasText(profile?.company_name),
    companySize: hasText(profile?.company_size),
    industry: hasText(profile?.industry),
    phone: hasText(profile?.phone),
    sapModules: (profile?.sap_modules?.length ?? 0) > 0,
  };

  return {
    checks,
    completed: Boolean(profile?.onboarding_completed) || Object.values(checks).every(Boolean),
  };
}
