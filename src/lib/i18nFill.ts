/** Fills {{name}} placeholders that the translator left untouched (for example when no translation instance is loaded). */
export const fill = (s: string, vars: Record<string, string | number>): string =>
  String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
