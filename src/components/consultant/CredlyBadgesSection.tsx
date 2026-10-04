import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Award, ExternalLink, CheckCircle, Link2, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import LinkStatus from '@/components/consultant/LinkStatus';
import { CREDLY_HINT, credlyProfileUrl, linkState, normalizeCredlyUsername } from '@/lib/consultantLinks';

interface CredlyBadge {
  id: string;
  name: string;
  issuer: string;
  image_url: string | null;
  issued_at: string | null;
  expires_at: string | null;
  badge_url: string;
  is_active: boolean;
}

interface Props {
  initialUsername?: string;
  consultantUserId?: string;
  /** When the platform team checked the profile (null: not checked yet). */
  checkedAt?: string | null;
  /** Called after the Credly name was saved (the name) or removed (null), so that the page around can show it at once. */
  onSaved?: (username: string | null) => void;
}

export default function CredlyBadgesSection({ initialUsername, consultantUserId, checkedAt, onSaved }: Props) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [username, setUsername] = useState(initialUsername || '');
  const [inputValue, setInputValue] = useState(initialUsername || '');
  const [badges, setBadges] = useState<CredlyBadge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(!!initialUsername);

  const fetchBadges = async (user: string) => {
    setLoading(true);
    setError(null);
    setBadges([]);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('credly-badges', {
        body: undefined,
        headers: { 'Content-Type': 'application/json' },
        method: 'GET',
      });

      // Since functions.invoke doesn't support query params well, use fetch directly
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/credly-badges?username=${encodeURIComponent(user)}`,
        {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await res.json();

      if (!res.ok) {
        setError(result.error || t('credly.error_fetch', 'Failed to fetch badges'));
        return;
      }

      setBadges(result.badges || []);
    } catch (err) {
      console.error('Credly fetch error:', err);
      setError(t('credly.error_fetch', 'Failed to fetch badges'));
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async () => {
    // The name or the address of the Credly profile, with the same rules as the database.
    const trimmed = normalizeCredlyUsername(inputValue);
    if (!trimmed) {
      setError(CREDLY_HINT);
      return;
    }

    // Save the username first: when the database does not accept it, nothing is shown as linked.
    if (!isGuest && consultantUserId) {
      const { error: saveError } = await supabase
        .from('consultants')
        .update({ credly_username: trimmed } as any)
        .eq('user_id', consultantUserId);
      if (saveError) {
        setError(saveError.code === '22023' && saveError.message ? saveError.message : t('credly.error_save', 'Could not save your Credly profile. Please try again.'));
        return;
      }
    }
    setError(null);
    setUsername(trimmed);
    setInputValue(trimmed);
    setLinked(true);
    onSaved?.(trimmed);
    await fetchBadges(trimmed);
  };

  const handleUnlink = async () => {
    setUsername('');
    setInputValue('');
    setBadges([]);
    setLinked(false);
    setError(null);

    if (!isGuest && consultantUserId) {
      await supabase
        .from('consultants')
        .update({ credly_username: null } as any)
        .eq('user_id', consultantUserId);
    }
    onSaved?.(null);
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Award className="w-4 h-4 text-accent" />
          {t('credly.title', 'Credly Badges')}
        </CardTitle>
        {linked && (
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleUnlink}>
            {t('credly.unlink', 'Unlink')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!linked ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Link your Credly profile to show your digital badges to clients. The platform team checks that the profile is yours; until then clients see it as "linked".
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={t('credly.placeholder', 'Enter your Credly username')}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleLink()}
              />
              <Button onClick={handleLink} disabled={!inputValue.trim() || loading} className="gradient-primary border-0 gap-1.5">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {t('credly.link', 'Link')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Link2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t('credly.linked_as', 'Linked as')}{' '}
                <a
                  href={credlyProfileUrl(username) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  @{username}
                  <ExternalLink className="w-3 h-3 inline ml-1" />
                </a>
              </span>
              <LinkStatus state={linkState(username, checkedAt)} label="Credly" />
            </div>

            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/30">
                    <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && badges.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {badges.map((badge) => (
                  <a
                    key={badge.id}
                    href={badge.badge_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/30 hover:bg-muted/40 transition-colors group"
                  >
                    {badge.image_url ? (
                      <img src={badge.image_url} alt={badge.name} className="w-12 h-12 rounded-lg object-contain shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <Award className="w-6 h-6 text-accent" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">
                        {badge.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{badge.issuer}</p>
                      {badge.issued_at && (
                        <p className="text-[10px] text-muted-foreground/70">
                          {new Date(badge.issued_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {badge.is_active ? (
                        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                          <CheckCircle className="w-2.5 h-2.5 me-0.5" /> {t('credly.active', 'Active')}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
                          {t('credly.expired', 'Expired')}
                        </Badge>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}

            {!loading && badges.length === 0 && !error && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchBadges(username)}
                className="text-xs"
              >
                {t('credly.refresh', 'Load badges')}
              </Button>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
