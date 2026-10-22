import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useKnowledgeEnabledForMe } from '@/hooks/useInterviewKnowledge';
import { isNotAppliedError } from '@/lib/interviewKnowledge';

/** "Questions are based on the modules and versions in your profile: ..." Shown only while the knowledge base is on. */
export function basisList(skills: ReadonlyArray<{ sap_module: string; sap_version?: string | null }>, max = 8): string {
  const items = skills.slice(0, max).map((s) => (s.sap_version ? `${s.sap_module} (${s.sap_version})` : s.sap_module));
  return skills.length > max ? `${items.join(', ')} +${skills.length - max}` : items.join(', ');
}

export default function InterviewBasisNotice({ onDark = true }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const enabled = useKnowledgeEnabledForMe(true);
  const skills = useQuery({
    queryKey: ['ik', 'my-interview-basis'],
    enabled: enabled.data === true,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return [];
      const { data: me } = await supabase.from('consultants').select('id').eq('user_id', session.user.id).maybeSingle();
      if (!me) return [];
      const withVersion = await (supabase as any).from('consultant_skills').select('sap_module, sap_version, proficiency_level').eq('consultant_id', me.id).order('proficiency_level', { ascending: false });
      if (!withVersion.error) return withVersion.data as Array<{ sap_module: string; sap_version: string | null }>;
      if (!isNotAppliedError(withVersion.error)) return [];
      const { data } = await supabase.from('consultant_skills').select('sap_module').eq('consultant_id', me.id);
      return (data ?? []) as Array<{ sap_module: string }>;
    },
  });
  if (enabled.data !== true || !skills.data) return null;
  const list = basisList(skills.data);
  return (
    <p className={`w-full flex items-start gap-2 rounded-xl p-3 text-start text-xs leading-relaxed ${onDark ? 'bg-white/5 border border-white/10 text-white/75' : 'bg-muted text-muted-foreground'}`}>
      <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden />
      <span>
        {list
          ? t('ik.notice.based_on', { list, defaultValue: 'Questions are based on the modules and versions in your profile: {{list}}.' })
          : t('ik.notice.no_modules', 'Questions are based on the modules and versions in your profile, but your profile has no SAP modules yet.')}{' '}
        <Link to="/consultant/profile" className="text-primary underline underline-offset-2">{t('ik.notice.update', 'Update your profile if this is not right.')}</Link>
      </span>
    </p>
  );
}
