// The consultant's experience lists for clients (read-only). Only the non-empty lists are shown. On-site countries are never shown to clients.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', ar: 'Arabic', de: 'German', fr: 'French', es: 'Spanish', hi: 'Hindi',
  ur: 'Urdu', zh: 'Chinese', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', tr: 'Turkish',
};

export interface ConsultantExperience {
  industries?: string[] | null;
  customer_segments?: string[] | null;
  vertical_solutions?: string[] | null;
  localization_countries?: string[] | null;
  localization_solutions?: string[] | null;
  project_types?: string[] | null;
  deployment_experience?: string[] | null;
  project_scale?: string | null;
  work_modes?: string[] | null;
  working_week?: string | null;
  languages?: string[] | null;
  language_levels?: Record<string, string> | null;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
const one = (v: unknown): string[] => (typeof v === 'string' && v.trim() ? [v] : []);

/** "English - Fluent (business)" for every language of the consultant that has a level (or just the name when there is no level). */
export function languageLines(languages: unknown, levels: unknown): string[] {
  const lv = levels && typeof levels === 'object' && !Array.isArray(levels) ? (levels as Record<string, unknown>) : {};
  const codes = Array.from(new Set([...list(languages), ...Object.keys(lv)]));
  return codes.map(code => {
    const name = LANGUAGE_NAMES[code] ?? code;
    const level = typeof lv[code] === 'string' && (lv[code] as string).trim() ? (lv[code] as string) : '';
    return level ? `${name} - ${level}` : name;
  });
}

export default function ConsultantExperienceCard({ data }: { data: ConsultantExperience }) {
  const rows: { label: string; items: string[] }[] = [
    { label: 'Industries', items: list(data.industries) },
    { label: 'Customer segments', items: list(data.customer_segments) },
    { label: 'Vertical solutions', items: list(data.vertical_solutions) },
    { label: 'Localization countries', items: list(data.localization_countries) },
    { label: 'Localization solutions', items: list(data.localization_solutions) },
    { label: 'Project types', items: list(data.project_types) },
    { label: 'Deployment experience', items: list(data.deployment_experience) },
    { label: 'Largest project', items: one(data.project_scale) },
    { label: 'Work mode', items: list(data.work_modes) },
    { label: 'Working week', items: one(data.working_week) },
    { label: 'Languages', items: languageLines(data.languages, data.language_levels) },
  ].filter(r => r.items.length > 0);

  if (rows.length === 0) return null;
  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Experience</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(r => (
          <div key={r.label}>
            <p className="text-xs font-medium text-muted-foreground mb-1">{r.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {r.items.map(item => {
                // Language lines "English - Fluent (business)": name and level in separate spans so each can be translated.
                const i = r.label === 'Languages' ? item.indexOf(' - ') : -1;
                return (
                  <Badge key={item} variant="outline" className="text-xs font-normal whitespace-normal">
                    {i >= 0 ? <><span>{item.slice(0, i)}</span>{' - '}<span>{item.slice(i + 3)}</span></> : item}
                  </Badge>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
