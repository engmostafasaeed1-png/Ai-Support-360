// Saved directory searches, kept in this browser only (name + the URL query string). No personal data is stored.
export type SavedFilter = { name: string; query: string };

const KEY = 'aisupport360.directory.savedFilters';
export const MAX_SAVED = 10;

export function loadSaved(storage: Pick<Storage, 'getItem'> = localStorage): SavedFilter[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter((x) => x && typeof x.name === 'string' && typeof x.query === 'string').map((x) => ({ name: x.name.slice(0, 40), query: x.query.slice(0, 2000) })).slice(0, MAX_SAVED)
      : [];
  } catch {
    return [];
  }
}

/** Adds or replaces a saved search by name (newest first, at most MAX_SAVED). */
export function saveFilter(name: string, query: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): SavedFilter[] {
  const clean = name.trim().slice(0, 40);
  if (!clean) return loadSaved(storage);
  const next = [{ name: clean, query: query.slice(0, 2000) }, ...loadSaved(storage).filter((s) => s.name !== clean)].slice(0, MAX_SAVED);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  return next;
}

export function deleteSaved(name: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): SavedFilter[] {
  const next = loadSaved(storage).filter((s) => s.name !== name);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
