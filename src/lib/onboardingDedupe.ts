// Running the onboarding again must not add the same skill, certificate, job, study, project or time slot a second time.
// A row that the consultant already has is skipped, and so is an empty form row; nothing that is already saved is changed or removed.

const clean = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/** The rows of `wanted` that are not in `existing` yet, each one once. A row whose key is empty (an empty form row) is left out. */
export function onlyNew<W, E>(wanted: W[], existing: E[], wantedKey: (row: W) => string, existingKey: (row: E) => string): W[] {
  const seen = new Set(existing.map(existingKey));
  const fresh: W[] = [];
  for (const row of wanted) {
    const key = wantedKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(row);
  }
  return fresh;
}

type Text = string | null | undefined;

export const skillKey = (module: Text): string => clean(module);

export const projectKey = (name: Text): string => clean(name);

export const certificateKey = (name: Text, issuer: Text, issueDate: Text): string =>
  clean(name) ? [clean(name), clean(issuer), clean(issueDate)].join('|') : '';

export const jobKey = (company: Text, title: Text, startDate: Text): string =>
  clean(company) && clean(title) ? [clean(company), clean(title), clean(startDate)].join('|') : '';

export const studyKey = (institution: Text, degree: Text, field: Text, startYear: number | string | null | undefined): string =>
  clean(institution) ? [clean(institution), clean(degree), clean(field), clean(startYear)].join('|') : '';

/** "09:00:00" and "09:00" are the same time. */
export const slotKey = (day: number | string | null | undefined, start: Text, end: Text): string =>
  [clean(day), clean(start).slice(0, 5), clean(end).slice(0, 5)].join('|');
