/**
 * Storage object keys: keep file names ASCII-safe (Arabic letters, spaces and symbols are replaced) and bounded,
 * so uploads are never rejected for an invalid key and paths stay predictable for the storage policies.
 */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const ext = hasExt ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase() : '';
  const stem = (hasExt ? name.slice(0, dot) : name)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|_+$/g, '')
    .slice(0, 80);
  const base = stem || 'file';
  return ext ? `${base}.${ext}` : base;
}
