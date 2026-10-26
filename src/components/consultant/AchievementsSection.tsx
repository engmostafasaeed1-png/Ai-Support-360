// Public profile: "Success stories & achievements" (consultant stories + automatic platform achievements), and the
// compact top-2 list for directory and team cards.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePublicAchievements } from '@/hooks/useAchievements';
import { useSuccessConfig, useSuccessStat } from '@/hooks/useSuccessStats';
import { usePublicResponsiveness } from '@/hooks/useResponsiveness';
import { useFoundingConsultants } from '@/hooks/useFoundingConsultants';
import { useRoleCatalog } from '@/hooks/useRoleCatalog';
import { successView } from '@/lib/successLevel';
import { platformAchievements, topAchievements, type Achievement } from '@/lib/achievements';
import { roleLabel } from '@/lib/consultantRoles';
import AchievementStatusBadge from './AchievementStatusBadge';

function StoryCard({ a, compact }: { a: Achievement; compact?: boolean }) {
  const { i18n } = useTranslation();
  const { catalog } = useRoleCatalog();
  const meta = [a.role_played && roleLabel(a.role_played, i18n.language, catalog), a.sap_area, a.sap_version, a.industry, a.year].filter(Boolean).join(' · ');
  return (
    <div className={`rounded-xl border border-border/60 ${compact ? 'p-2' : 'p-3'} space-y-1`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`font-medium text-foreground ${compact ? 'text-xs' : 'text-sm'}`}>{a.title}</p>
        <AchievementStatusBadge status={a.status} />
      </div>
      {meta && <p className="text-[11px] text-muted-foreground">{meta}</p>}
      <p className={`text-foreground ${compact ? 'text-[11px] line-clamp-2' : 'text-sm'}`}>{a.outcome}</p>
      {!compact && a.reference_url && <a href={a.reference_url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary underline">{new URL(a.reference_url).hostname}</a>}
    </div>
  );
}

export default function AchievementsSection({ consultantId, joinedAt }: { consultantId: string; joinedAt?: string | null }) {
  const { t } = useTranslation();
  const stories = usePublicAchievements(consultantId);
  const cfg = useSuccessConfig();
  const success = useSuccessStat(consultantId, cfg.publicOn);
  const resp = usePublicResponsiveness();
  const founding = useFoundingConsultants();
  const view = successView(cfg.publicOn, success.data ?? null, cfg.settings);
  const platform = platformAchievements({
    solved: cfg.publicOn ? success.data?.solved ?? null : null,
    successLevel: view.state === 'ok' ? view.level : null,
    respLevel: resp.publicOn ? resp.byId.get(consultantId)?.level ?? null : null,
    joinedAt, foundingNumber: founding.data?.get(consultantId)?.founding_number ?? null,
  });
  const list = topAchievements(stories.data ?? [], 8);
  if (!list.length && !platform.length) return null;
  const text = (p: (typeof platform)[number]) => t(`achievements.pa_${p.key}`, { value: p.key === 'success_level' || p.key === 'responsiveness' ? t(`achievements.lvl_${p.value}`, String(p.value)) : p.value });
  return (
    <Card className="rounded-2xl border-border/50" id="success-stories">
      <CardHeader className="pb-2"><CardTitle className="text-base font-semibold flex items-center gap-2"><Trophy className="h-4 w-4" />{t('achievements.title', 'Success stories & achievements')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {platform.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {platform.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-foreground">
                {text(p)} <AchievementStatusBadge status="platform" />
              </span>
            ))}
          </div>
        )}
        {list.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{list.map((a) => <StoryCard key={a.id} a={a} />)}</div>}
        {list.length > 0 && <p className="text-[11px] text-muted-foreground">{t('achievements.self_note', '"Self-declared" stories come from the consultant; "Verified" ones were checked by the platform team.')}</p>}
      </CardContent>
    </Card>
  );
}

/** Top 2 public stories with a "view all" link (directory and team cards). */
export function TopAchievements({ consultantId, stories, profilePath }: { consultantId: string; stories: Achievement[] | undefined; profilePath?: string }) {
  const { t } = useTranslation();
  const top = topAchievements(stories ?? [], 2);
  if (!top.length) return null;
  return (
    <div className="mt-2 space-y-1.5" data-testid={`top-stories-${consultantId}`}>
      {top.map((a) => <StoryCard key={a.id} a={a} compact />)}
      <Link to={`${profilePath ?? `/client/consultants/${consultantId}`}#success-stories`} className="text-[11px] text-primary underline">{t('achievements.view_all', 'View all success stories')}</Link>
    </div>
  );
}
