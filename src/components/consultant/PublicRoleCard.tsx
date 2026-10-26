// Public profile: professional roles + role details, then "Success stories & achievements".
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Briefcase } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useRoleCatalog } from '@/hooks/useRoleCatalog';
import { normalizeRoles, roleLabel, type RoleDetails } from '@/lib/consultantRoles';
import { RoleDetailsView } from './RoleDetailsFields';
import AchievementsSection from './AchievementsSection';

export default function PublicRoleCard({ consultantId }: { consultantId: string }) {
  const { t, i18n } = useTranslation();
  const { catalog } = useRoleCatalog();
  const q = useQuery({
    queryKey: ['public-role-profile', consultantId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const db = supabase as any;
      const full = await db.from('consultants').select('sap_role, sap_roles, role_details, created_at').eq('id', consultantId).maybeSingle();
      if (!full.error) return full.data as { sap_role: string | null; sap_roles: string[] | null; role_details?: RoleDetails; created_at?: string } | null;
      const basic = await db.from('consultants').select('sap_role, sap_roles, created_at').eq('id', consultantId).maybeSingle();
      return basic.data as { sap_role: string | null; sap_roles: string[] | null; created_at?: string } | null;
    },
  });
  const roles = q.data ? normalizeRoles(q.data.sap_roles ?? [], q.data.sap_role, catalog).roles : [];
  const details = (q.data as { role_details?: RoleDetails } | null)?.role_details;
  return (
    <>
      {roles.length > 0 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base font-semibold flex items-center gap-2"><Briefcase className="h-4 w-4" />{t('roles.public_title', 'Professional roles')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r, i) => (
                <span key={r} className={`rounded-full px-2.5 py-1 text-xs ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                  {roleLabel(r, i18n.language, catalog)}{i === 0 && <span className="sr-only"> ({t('roles.primary', 'Main role')})</span>}
                </span>
              ))}
            </div>
            <RoleDetailsView details={details} />
          </CardContent>
        </Card>
      )}
      <AchievementsSection consultantId={consultantId} joinedAt={q.data?.created_at ?? null} />
    </>
  );
}
