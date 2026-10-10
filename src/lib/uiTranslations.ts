import { supabase } from '@/integrations/supabase/client';
import type { UiDictionary } from '@/lib/uiTranslator';

interface CacheEntry {
  version: string;
  entries: UiDictionary;
}

const cacheKey = (lang: string): string => `ui-translations:${lang}`;

function readCache(lang: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(lang));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    return parsed && typeof parsed.version === 'string' && parsed.entries && typeof parsed.entries === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(lang: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(cacheKey(lang), JSON.stringify(entry));
  } catch {
    // storage is full or blocked: the texts are downloaded again next time
  }
}

/** The copy of the texts that this browser kept from an earlier visit (null when there is none). */
export function cachedUiTranslations(lang: string): UiDictionary | null {
  return readCache(lang)?.entries ?? null;
}

/**
 * Compares the copy kept in the browser with the texts in the database and downloads them again only when they changed.
 * Returns the new texts, or null when nothing changed or the download failed (the screens then simply stay as they are).
 */
export async function refreshUiTranslations(lang: string): Promise<UiDictionary | null> {
  try {
    const { data: version, error } = await supabase.rpc('ui_translations_version', { _lang: lang });
    if (error || typeof version !== 'string') return null;
    if (readCache(lang)?.version === version) return null;
    const { data, error: loadError } = await supabase.rpc('ui_translations_get', { _lang: lang });
    if (loadError || !data || typeof data !== 'object' || Array.isArray(data)) return null;
    const entries = data as UiDictionary;
    writeCache(lang, { version, entries });
    return entries;
  } catch {
    return null;
  }
}
